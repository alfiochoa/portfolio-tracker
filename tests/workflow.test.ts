// The daily refresh, both homes (ARCHITECTURE.md, "Keeping it current"): the GitHub Actions workflow
// (A) is read as YAML and its shape asserted; scripts/refresh.sh (B) is run against a stand-in npm.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = new URL('../', import.meta.url);

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = { needs?: string | string[]; if?: string; permissions?: Record<string, string>; steps: Step[]; outputs?: Record<string, string> };
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
};

describe('the refresh workflow (.github/workflows/refresh.yml)', () => {
  const text = readFileSync(new URL('.github/workflows/refresh.yml', root), 'utf8');
  const wf = parse(text) as Workflow;
  const steps = Object.values(wf.jobs).flatMap((j) => j.steps);
  const runs = (job: string) => wf.jobs[job]!.steps.map((s) => s.run ?? s.uses ?? '');

  it('runs weekdays at 08:15 UTC and by hand, never on push', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(wf.on.schedule).toEqual([{ cron: '15 8 * * 1-5' }]);
  });

  it('asks for the least permissions: read by default, write only where the commit and the deploy need it', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(wf.jobs.build!.permissions).toEqual({ contents: 'read' });
    expect(wf.jobs.deploy!.permissions).toEqual({ pages: 'write', 'id-token': 'write' });
    expect(wf.jobs.commit!.permissions).toEqual({ contents: 'write' });
    for (const [name, job] of Object.entries(wf.jobs)) expect(job.permissions, name).toBeDefined();
  });

  it('reads no secret', () => {
    expect(text).not.toMatch(/secrets\./);
    expect(text).not.toMatch(/\.env\b/);
  });

  it('runs one at a time, without cancelling the run in progress', () => {
    expect(wf.concurrency).toEqual({ group: 'refresh', 'cancel-in-progress': false });
  });

  it('fetches with Node 24, then builds and hands dist/ to Pages; a failed snapshot run stops the job', () => {
    const build = runs('build');
    const at = (s: string) => build.findIndex((r) => r.startsWith(s));
    expect(wf.jobs.build!.steps.find((s) => s.uses?.startsWith('actions/setup-node'))?.with).toMatchObject({ 'node-version': 24 });
    expect(at('npm ci')).toBeGreaterThan(0);
    expect(at('npm run snapshots')).toBeGreaterThan(at('npm ci'));
    expect(at('npm run build')).toBeGreaterThan(at('npm run snapshots'));
    expect(at('actions/upload-pages-artifact')).toBeGreaterThan(at('npm run build'));
    expect(wf.jobs.build!.steps.find((s) => s.uses?.startsWith('actions/upload-pages-artifact'))?.with).toEqual({ path: 'dist' });
    // Nothing lets a failed step through, so deploy and commit, which need build, do not run.
    expect(text).not.toMatch(/continue-on-error|\|\| true/);
    expect(wf.jobs.deploy!.needs).toBe('build');
    expect(runs('deploy')).toEqual(['actions/deploy-pages@v4']);
    expect(wf.jobs.commit!.needs).toBe('build');
  });

  it('commits the snapshot as the Actions bot, naming the latest NAV date, only when the data changed', () => {
    expect(wf.jobs.commit!.if).toBe("needs.build.outputs.changed == 'true'");
    const script = runs('commit').join('\n');
    expect(script).toContain("user.name 'github-actions[bot]'");
    expect(script).toContain('git add public/data/prices.json');
    expect(script).toMatch(/git commit -m "[^"]*\$LATEST/);
    expect(script).toContain('git push');
    expect(script).not.toMatch(/--force|-f\b/);
  });

  it('every step either runs a command or uses a pinned action', () => {
    for (const s of steps) expect(s.run ?? s.uses?.match(/^actions\/[\w-]+@v\d+$/)?.[0], JSON.stringify(s)).toBeTruthy();
  });
});

describe('scripts/refresh.sh', () => {
  let dir: string;

  // A copy of the script in a scratch repository, with a stand-in npm (and a git that records being called).
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'refresh-'));
    mkdirSync(path.join(dir, 'scripts'));
    mkdirSync(path.join(dir, 'bin'));
    copyFileSync(new URL('scripts/refresh.sh', root), path.join(dir, 'scripts', 'refresh.sh'));
    chmodSync(path.join(dir, 'scripts', 'refresh.sh'), 0o755);
    const fake = (name: string, body: string) => {
      writeFileSync(path.join(dir, 'bin', name), `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(path.join(dir, 'bin', name), 0o755);
    };
    fake(
      'npm',
      `echo "npm $*" >> calls.txt
case "$*" in
  *snapshots) echo "us500 ... 120 bars"; echo "$SNAP_LINE"; exit "$SNAP_EXIT";;
  *build) echo "vite built"; exit "$BUILD_EXIT";;
esac`,
    );
    fake('git', 'echo "git $*" >> calls.txt');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function refresh(snapLine: string, snapExit: number, buildExit = 0) {
    const env = { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, SNAP_LINE: snapLine, SNAP_EXIT: String(snapExit), BUILD_EXIT: String(buildExit) };
    // Started from elsewhere, as cron would: the script finds its own repository.
    const r = spawnSync('bash', [path.join(dir, 'scripts', 'refresh.sh')], { cwd: tmpdir(), env, encoding: 'utf8' });
    const log = readFileSync(path.join(dir, 'var', 'refresh.log'), 'utf8').trimEnd().split('\n');
    return { status: r.status, log, calls: readFileSync(path.join(dir, 'calls.txt'), 'utf8').trimEnd().split('\n') };
  }

  const WROTE = 'Wrote public/data/prices.json: state ok, 8 funds, latest NAV 2026-11-04.';

  it('fetches, then builds, and logs the time, the summary line and each exit code', () => {
    const r = refresh(WROTE, 0);
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(['npm run --silent snapshots', 'npm run --silent build']);
    expect(r.log).toHaveLength(2);
    expect(r.log[0]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d{4} snapshots: Wrote public\/data\/prices\.json: state ok, 8 funds, latest NAV 2026-11-04\. \(exit 0\)$/);
    expect(r.log[1]).toMatch(/ build: dist\/ rebuilt \(exit 0\)$/);
    expect(readFileSync(path.join(dir, 'var', 'refresh-last.log'), 'utf8')).toContain('us500 ... 120 bars');
  });

  it('exits non-zero when the snapshot run failed, and still builds so the page says so', () => {
    const r = refresh('snapshot failed: no previous snapshot to keep\npublic/data/prices.json was not written.', 1);
    expect(r.status).toBe(1);
    expect(r.calls).toEqual(['npm run --silent snapshots', 'npm run --silent build']);
    expect(r.log[0]).toMatch(/ snapshots: snapshot failed: no previous snapshot to keep \(exit 1\)$/);
  });

  it('exits non-zero when the build failed', () => {
    const r = refresh(WROTE, 0, 2);
    expect(r.status).toBe(2);
    expect(r.log[1]).toMatch(/ build: dist\/ NOT rebuilt, see var\/refresh-last\.log \(exit 2\)$/);
  });

  it('appends to the log run after run, keeps only the latest output, and never calls git', () => {
    refresh(WROTE, 0);
    const r = refresh(WROTE.replace('state ok', 'state partial'), 0);
    expect(r.log).toHaveLength(4);
    expect(r.log[2]).toContain('state partial');
    expect(r.calls.some((c) => c.startsWith('git'))).toBe(false);
    expect(readFileSync(path.join(dir, 'var', 'refresh-last.log'), 'utf8').match(/vite built/g)).toHaveLength(1);
    expect(existsSync(path.join(dir, '.git'))).toBe(false);
  });
});
