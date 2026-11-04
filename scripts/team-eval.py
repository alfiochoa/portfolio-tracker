#!/usr/bin/env python3
"""The fixed eval set: the same small tasks, run again after every change to the team.

Two milestones are never alike, so comparing one against the one before says little about a change to
the team (three agents or six, one model or another, a rewritten role file). The eval set is ten small
tasks the project writes once (docs/evals/E-01 to E-10, docs/evals/README.md says how) and never
changes afterwards. A run hands each to the builder with `team.sh assign`, then to the verifier, and
records what it cost (the ledger), how long it took, and the verifier's one-line result. Two runs are
then compared task by task. No model is called by this script itself; the agents do the work.

  team.sh eval check                          the set is complete and its patches apply to the base branch
  team.sh eval run [--label "..."] [--only E-01,E-04] [--repeat N] [--tiers E-03=light,E-09=heavy] [--dry-run] [--keep]
  team.sh eval list                           every run, with its result
  team.sh eval compare <run-a> <run-b>        task by task, with the flips
  team.sh eval clean <run>                    delete the run's branches (a worktree left on one is detached first)

A run writes .team/evals/<run>/ (run.json, report.md, log.txt, the task files as the agents left them)
and the branches eval/<run>/base (the base branch plus the planted bugs) and eval/<run>/E-NN (the builder's work).
"""
import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import teamlib  # noqa: E402

REPO, TEAM, WORKTREES = teamlib.REPO, teamlib.TEAM, teamlib.WORKTREES
EVALS = os.path.join(REPO, "docs", "evals")
RUNS = os.path.join(TEAM, "evals")
TEAM_SH = os.path.join(HERE, "team.sh")
COST_PY = os.path.join(HERE, "team-cost.py")
BASE_WT = os.path.join(WORKTREES, "eval-base")  # a throwaway worktree, only while patches are applied
FILL = "(fill in"
RESULT_RE = re.compile(r"^\s*\**Result:\**\s*\**(pass|fail)\b", re.I | re.M)
WRITTEN_BY_AGENTS = ("Report", "Review", "Verification", "Blocked")


def die(msg):
    print(f"team-eval: {msg}", file=sys.stderr)
    sys.exit(1)


def now():
    return datetime.datetime.now(datetime.timezone.utc)


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def git(*args, cwd=REPO, check=True):
    out = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True)
    if check and out.returncode != 0:
        die(f"git {' '.join(args)}: {(out.stderr or out.stdout).strip()}")
    return out.stdout.strip()


def herdr_agent(role):
    """The live agent's fields for a role (agent_status, pane_id, ...), or {} when it is not running."""
    try:
        out = subprocess.run(["herdr", "agent", "get", teamlib.herdr_name(role)], capture_output=True, text=True, timeout=15)
        if out.returncode == 0:
            return json.loads(out.stdout)["result"]["agent"]
    except (OSError, subprocess.SubprocessError, ValueError, KeyError):
        pass
    return {}


def tell(role, message):
    """A message to a live agent, without waiting; nothing if it is not running."""
    if herdr_agent(role):
        subprocess.run([TEAM_SH, "tell", role, message], capture_output=True, text=True)


# ---------------------------------------------------------------------------------------------------
# The set: docs/evals/E-NN-slug.md, with an optional E-NN-slug.patch planting what the task fixes.
# ---------------------------------------------------------------------------------------------------
def load_set(only=None):
    if not os.path.isdir(EVALS):
        die(f"no {EVALS}: this project has no eval set (install.sh writes the ten skeletons; docs/evals/README.md says how to fill them in)")
    items = []
    for name in sorted(os.listdir(EVALS)):
        m = re.match(r"^(E-\d{2})-([a-z0-9-]+)\.md$", name)
        if not m:
            continue
        tid, slug = m.groups()
        patches = sorted(p for p in os.listdir(EVALS) if p.startswith(tid) and p.endswith(".patch"))
        with open(os.path.join(EVALS, name), encoding="utf-8") as f:
            text = f.read()
        items.append({"id": tid, "slug": slug, "file": os.path.join(EVALS, name),
                      "patch": os.path.join(EVALS, patches[0]) if patches else None, "text": text})
    if only:
        want = [x.strip() for x in only.split(",") if x.strip()]
        have = {i["id"]: i for i in items}
        missing = [w for w in want if w not in have]
        if missing:
            die(f"no such eval task: {', '.join(missing)}")
        items = [have[w] for w in want]
    if not items:
        die(f"no E-NN-slug.md files in {EVALS}")
    return items


def section(text, name):
    """The body under `## name` up to the next heading, without the template's placeholder lines."""
    m = re.search(rf"^## {re.escape(name)}[ \t]*\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    if not m:
        return ""
    lines = [ln for ln in m.group(1).strip().splitlines() if ln.strip()]
    return "\n".join(lines).strip()


def problems(items):
    """What stops a run before any model call: markers left, sections missing, no run placeholder."""
    out = []
    for i in items:
        t = i["text"]
        if FILL in t:
            out.append(f"{i['id']}: still has a '(fill in' marker")
        if "{{RUN}}" not in t:
            out.append(f"{i['id']}: no {{{{RUN}}}} in its branch names (the run id goes there)")
        for sec in ("Goal", "Acceptance", "How this is scored", "Report", "Verification"):
            if not re.search(rf"^## {sec}[ \t]*$", t, re.M):
                out.append(f"{i['id']}: no '## {sec}' section")
    return out


def make_worktree(ref, branch=False):
    """A throwaway worktree at ref (on the branch when branch=True, else detached)."""
    if os.path.exists(BASE_WT):
        drop_worktree()
    os.makedirs(WORKTREES, exist_ok=True)
    args = ["worktree", "add", "--quiet"] + ([] if branch else ["--detach"]) + [BASE_WT, ref]
    git(*args)
    return BASE_WT


def drop_worktree():
    subprocess.run(["git", "-C", REPO, "worktree", "remove", "--force", BASE_WT], capture_output=True)
    subprocess.run(["git", "-C", REPO, "worktree", "prune"], capture_output=True)
    if os.path.exists(BASE_WT):
        shutil.rmtree(BASE_WT, ignore_errors=True)


def apply_patches(items, wt, commit_as=None):
    """Each task's patch, in order, on the worktree; committed when commit_as names the run. The errors."""
    errs = []
    for i in items:
        if not i["patch"]:
            continue
        out = subprocess.run(["git", "-C", wt, "apply", "--whitespace=nowarn", i["patch"]], capture_output=True, text=True)
        if out.returncode != 0:
            last = (out.stderr.strip().splitlines() or ["git apply failed"])[-1]
            errs.append(f"{i['id']}: its patch no longer applies ({last}); remake it from {teamlib.BRANCH} (docs/evals/README.md)")
            break
        if commit_as:
            git("add", "-A", cwd=wt)
            git("commit", "--quiet", "--no-verify", "-m", f"eval {commit_as}: {i['id']} setup", cwd=wt)
    return errs


def check_set(items, verbose=True):
    errs = problems(items)
    if not errs and any(i["patch"] for i in items):
        wt = make_worktree(teamlib.BRANCH)
        try:
            errs += apply_patches(items, wt)
        finally:
            drop_worktree()
    if verbose:
        for i in items:
            print(f"  {i['id']}  {i['slug']}" + ("  (with a patch)" if i["patch"] else ""))
        if errs:
            print("\nNot ready:")
            for e in errs:
                print(f"  {e}")
        else:
            print(f"\nThe set is ready: {len(items)} tasks, {sum(1 for i in items if i['patch'])} with a patch, every patch applies to main.")
    return errs


# ---------------------------------------------------------------------------------------------------
# A run.
# ---------------------------------------------------------------------------------------------------
def roster_snapshot():
    rows = {}
    try:
        with open(os.path.join(HERE, "roster.conf"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    p = [x.strip() for x in line.split("|")]
                    if len(p) >= 4:
                        rows[p[0]] = f"{p[2]} {p[3]}"
    except OSError:
        pass
    return rows


def claude_version():
    try:
        out = subprocess.run(["claude", "--version"], capture_output=True, text=True, timeout=20)
        return out.stdout.strip().split()[0] if out.returncode == 0 and out.stdout.strip() else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def live_task(item, run_tag):
    """The task file the agents work on: the fixed file with the run's id in it and the agents' sections emptied."""
    os.makedirs(os.path.join(TEAM, "tasks"), exist_ok=True)
    dest = os.path.join(TEAM, "tasks", f"{item['id']}-{item['slug']}.md")
    text = item["text"].replace("{{RUN}}", run_tag)
    for sec in WRITTEN_BY_AGENTS:
        text = re.sub(rf"^(## {sec}[ \t]*\n).*?(?=^## |\Z)", r"\1\n", text, flags=re.S | re.M)
    if os.path.exists(dest):
        print(f"    note: {os.path.relpath(dest, REPO)} existed (a previous run's copy) and is replaced")
    with open(dest, "w", encoding="utf-8") as f:
        f.write(text.rstrip("\n") + "\n")
    return dest


def read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def outcome(path, want, blocked_counts=True):
    """'written' when one of the `want` sections is there, 'blocked' when a Blocked section is (and counts),
    else 'none'. A Blocked section the builder wrote does not count for the verifier: it was there before."""
    t = read(path)
    for sec in want:
        if section(t, sec):
            return "written"
    if blocked_counts and section(t, "Blocked"):
        return "blocked"
    return "none"


def background_shells(role):
    """How many background commands the agent's status bar shows (teamlib.background_commands); 0 when the screen
    cannot be read. An agent that stopped to wait for one is woken when it ends and may still write its section."""
    try:
        out = subprocess.run(["herdr", "agent", "read", teamlib.herdr_name(role), "--source", "visible", "--lines", "80"],
                             capture_output=True, text=True, timeout=15)
        return teamlib.background_commands(out.stdout) if out.returncode == 0 else 0
    except (OSError, subprocess.SubprocessError):
        return 0


def parse_tiers(text):
    """"E-03=light,E-09=heavy" as {"E-03": "light", "E-09": "heavy"}; the tasks not named run standard."""
    tiers = {}
    for part in (text or "").split(","):
        if not part.strip():
            continue
        tid, _, tier = part.partition("=")
        tid, tier = tid.strip().upper(), tier.strip().lower()
        if not re.fullmatch(r"E-\d{2}", tid) or tier not in ("light", "standard", "heavy"):
            die(f"--tiers takes E-NN=light|standard|heavy, comma-separated (got '{part.strip()}')")
        tiers[tid] = tier
    return tiers


def dispatch(role, tid, path, want, cap_s, log, tier=None):
    """`team.sh assign <role> <tid>`, then wait on the task file. Returns (outcome, seconds, note).

    assign returns when the agent stops, which can be before the work is done (its own long check run
    goes on), so after that the file is polled while the agent works, or while its screen shows a
    background command still running (background_shells): a stop that waits on one is not the task's
    end. The cap still ends the wait. An agent at a Claude Code prompt is the run's end: the prompt is
    the owner's to answer."""
    t0 = time.monotonic()
    blocked_counts = not section(read(path), "Blocked")  # a Blocked already there is the builder's, not this agent's
    log.write(f"\n--- {iso(now())} assign {role} {tid}" + (f" ({tier} tier)" if tier else "") + "\n")
    log.flush()
    try:
        p = subprocess.run([TEAM_SH, "assign", role, tid] + (["--tier", tier] if tier else []), capture_output=True, text=True, timeout=cap_s)
        log.write(p.stdout + p.stderr)
        if p.returncode != 0:
            return "failed", time.monotonic() - t0, (p.stderr.strip().splitlines() or ["assign failed"])[-1]
    except subprocess.TimeoutExpired as e:
        log.write((e.stdout or "") + (e.stderr or "") + f"\n{tid}: {role} ran past {cap_s // 60} min; restarted\n")
        subprocess.run([TEAM_SH, "restart", role], capture_output=True, text=True)
        return "timed out", time.monotonic() - t0, f"{role} restarted after {cap_s // 60} min"
    quiet = 0
    while True:
        out = outcome(path, want, blocked_counts)
        if out != "none":
            return out, time.monotonic() - t0, ""
        if time.monotonic() - t0 > cap_s:
            subprocess.run([TEAM_SH, "restart", role], capture_output=True, text=True)
            return "timed out", time.monotonic() - t0, f"{role} restarted after {cap_s // 60} min"
        status = herdr_agent(role).get("agent_status", "")
        if status == "blocked":
            return "prompt", time.monotonic() - t0, f"{role} is at a Claude Code prompt in pane {herdr_agent(role).get('pane_id', '?')}"
        if status == "working" or background_shells(role):
            quiet = 0
        else:
            quiet += 1
            if quiet >= 2:
                return "none", time.monotonic() - t0, f"{role} stopped without writing its section"
        time.sleep(30)


def ledger(start, end):
    """The cost ledger's tasks for a window: {task id: (cost, turns)}; {} when it cannot be read."""
    try:
        out = subprocess.run([sys.executable, COST_PY, "--from", iso(start), "--to", iso(end), "--json", "--repo", REPO],
                             capture_output=True, text=True, timeout=600)
        if out.returncode != 0:
            return {}
        data = json.loads(out.stdout)
        return {t: (row.get("cost"), row.get("turns")) for t, row in data.get("tasks", {}).items()}
    except (OSError, subprocess.SubprocessError, ValueError):
        return {}


def score(path):
    v = section(read(path), "Verification")
    found = RESULT_RE.findall(v)
    return found[-1].lower() if found else "unscored"


def save(run_dir, run):
    with open(os.path.join(run_dir, "run.json"), "w", encoding="utf-8") as f:
        json.dump(run, f, indent=2, sort_keys=True)
    with open(os.path.join(run_dir, "report.md"), "w", encoding="utf-8") as f:
        f.write(render(run))


def cmd_run(args):
    items = load_set(args.only)
    print(f"Eval set of {teamlib.PROJECT}: {len(items)} tasks")
    errs = check_set(items, verbose=False)
    if errs:
        die("the set is not ready:\n  " + "\n  ".join(errs))
    builder, verifier = args.builder, args.verifier
    if not args.dry_run:
        for role in (builder, verifier):
            a = herdr_agent(role)
            if not a:
                die(f"{role} is not running (scripts/team.sh office, or join it)")
            if a.get("agent_status") in ("working", "blocked"):
                die(f"{role} is {a['agent_status']} in pane {a.get('pane_id', '?')}; the run needs it idle")
    run_id = args.run_id or datetime.datetime.now().strftime("%Y%m%d-%H%M")
    run_dir = os.path.join(RUNS, run_id)
    if os.path.exists(run_dir):
        die(f"a run named {run_id} exists ({run_dir})")
    os.makedirs(os.path.join(run_dir, "tasks"))
    run = {
        "run": run_id, "label": args.label or "", "project": teamlib.PROJECT, "started": iso(now()), "ended": None,
        "main": git("rev-parse", "--short", teamlib.BRANCH), "branch": teamlib.BRANCH, "claude": claude_version(), "roster": roster_snapshot(),
        "builder": builder, "verifier": verifier, "repeats": args.repeat, "dry_run": args.dry_run,
        "caps_min": {"build": args.build_cap, "verify": args.verify_cap}, "tasks": [], "stopped": None,
        "tiers": parse_tiers(args.tiers),
    }
    log = open(os.path.join(run_dir, "log.txt"), "a", encoding="utf-8")
    print(f"Run {run_id}" + (f" ({args.label})" if args.label else "") + (" [dry run]" if args.dry_run else ""))
    bases = []
    try:
        for rep in range(1, args.repeat + 1):
            tag = run_id if rep == 1 else f"{run_id}-r{rep}"
            base = f"eval/{tag}/base"
            git("branch", base, teamlib.BRANCH)
            bases.append(base)
            wt = make_worktree(base, branch=True)
            try:
                errs = apply_patches(items, wt, commit_as=tag)
            finally:
                drop_worktree()
            if errs:
                die("the set is not ready:\n  " + "\n  ".join(errs))
            run["base"] = git("rev-parse", "--short", base)
            print(f"  base branch {base} at {run['base']}" + (" (patches applied)" if any(i["patch"] for i in items) else ""))
            if rep == 1 and not args.dry_run:
                tell("architect", f"An eval run ({run_id}) is using {builder} and {verifier} until it ends; do not assign them anything. It will tell you when they are free.")
            rep_start = now()
            for item in items:
                path = live_task(item, tag)
                tier = run["tiers"].get(item["id"])  # the task and its verification on that tier; standard without one
                row = {"id": item["id"], "slug": item["slug"], "repeat": rep, "build": None, "build_s": 0,
                       "verify": None, "verify_s": 0, "result": None, "cost": None, "turns": None, "note": "",
                       "tier": tier if tier != "standard" else None}
                run["tasks"].append(row)
                if args.dry_run:
                    row.update(build="dry", verify="dry", result="dry")
                    print(f"  {item['id']}  {item['slug']}: task file written, not assigned (dry run)")
                    save(run_dir, run)
                    continue
                print(f"  {item['id']}  {item['slug']}: building ({builder})", flush=True)
                out, secs, note = dispatch(builder, item["id"], path, ("Report",), args.build_cap * 60, log, row["tier"])
                row.update(build="report" if out == "written" else out, build_s=int(secs), note=note)
                if out == "prompt":
                    run["stopped"] = f"{item['id']}: {note}"
                    save(run_dir, run)
                    break
                if out in ("written", "blocked"):
                    print(f"           {row['build']} after {secs / 60:.0f} min; verifying ({verifier})", flush=True)
                    out, secs, note = dispatch(verifier, item["id"], path, ("Verification",), args.verify_cap * 60, log, row["tier"])
                    row.update(verify="written" if out == "written" else out, verify_s=int(secs))
                    if note:
                        row["note"] = (row["note"] + "; " + note).strip("; ")
                    if out == "prompt":
                        run["stopped"] = f"{item['id']}: {note}"
                        save(run_dir, run)
                        break
                    row["result"] = score(path) if out == "written" else "unscored"
                else:
                    row["verify"], row["result"] = "skipped", "no report"
                print(f"           {row['result']}" + (f"  ({row['note']})" if row["note"] else ""))
                save(run_dir, run)
            rep_end = now()
            if not args.dry_run:
                costs = ledger(rep_start, rep_end)
                for row in run["tasks"]:
                    if row["repeat"] == rep and row["id"] in costs:
                        row["cost"], row["turns"] = costs[row["id"]]
            for item in items:
                src = os.path.join(TEAM, "tasks", f"{item['id']}-{item['slug']}.md")
                if os.path.exists(src):
                    shutil.move(src, os.path.join(run_dir, "tasks", f"{item['id']}-{item['slug']}" + (f"-r{rep}" if rep > 1 else "") + ".md"))
            if run["stopped"]:
                break
    finally:
        run["ended"] = iso(now())
        save(run_dir, run)
        log.close()
        if not args.dry_run:
            tell("architect", f"Eval run {run_id} has ended; {builder} and {verifier} are free. The report is {os.path.join(run_dir, 'report.md')}.")
        if args.dry_run and not args.keep:
            for b in bases:
                subprocess.run(["git", "-C", REPO, "branch", "-D", b], capture_output=True)
    print()
    print(render(run))
    print(f"Saved in {run_dir}" + ("; the branches were deleted (--keep keeps them)" if args.dry_run and not args.keep else ""))
    if run["stopped"]:
        print(f"\nThe run stopped early: {run['stopped']}. Answer the prompt, then run the remaining tasks with --only.")


# ---------------------------------------------------------------------------------------------------
# Reports.
# ---------------------------------------------------------------------------------------------------
def minutes(s):
    return "-" if not s else (f"{s / 60:.0f} min" if s < 5400 else f"{s / 3600:.1f} h")


def money(c):
    return "-" if c is None else f"${c:.2f}"


def summary(run):
    rows = run["tasks"]
    scored = [r for r in rows if r["result"] not in (None, "dry")]
    passed = sum(1 for r in scored if r["result"] == "pass")
    priced = [r["cost"] for r in rows if r["cost"] is not None]
    cost = sum(priced) if priced else None
    secs = sum((r["build_s"] or 0) + (r["verify_s"] or 0) for r in rows)
    return passed, len(scored), cost, secs


def local(stamp):
    """An ISO time in UTC (run.json keeps those) as this machine's clock shows it, the clock the run's id is in."""
    try:
        t = datetime.datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).astimezone()
    except (TypeError, ValueError):
        return stamp
    return t.strftime("%Y-%m-%d %H:%M %Z")


def render(run):
    passed, total, cost, secs = summary(run)
    lines = [f"# Eval run {run['run']}" + (f": {run['label']}" if run["label"] else ""), ""]
    lines.append(f"{run['project']}, started {local(run['started'])}" + (f", ended {local(run['ended'])}" if run["ended"] else "") +
                 f"; {run.get('branch', 'main')} at {run['main']}" + (f", base at {run['base']}" if run.get("base") else "") +
                 (f"; Claude Code {run['claude']}" if run["claude"] else "") + ".")
    roster = ", ".join(f"{k}: {v}" for k, v in run["roster"].items())
    if roster:
        lines.append(f"Roster: {roster}.")
    if run["dry_run"]:
        lines.append("A dry run: the task files were written and the base branch made; nothing was assigned.")
    lines += ["", "| task | repeat | build | verify | result | time | cost |", "|---|---|---|---|---|---|---|"]
    if run.get("tiers"):
        lines.append("Tiers: " + ", ".join(f"{t} {v}" for t, v in sorted(run["tiers"].items())) + "; every other task standard (the roster).")
    for r in run["tasks"]:
        lines.append(f"| {r['id']} {r['slug']}{' (' + r['tier'] + ')' if r.get('tier') else ''} | {r['repeat']} | {r['build'] or '-'} ({minutes(r['build_s'])}) | "
                     f"{r['verify'] or '-'} ({minutes(r['verify_s'])}) | **{r['result'] or '-'}** | "
                     f"{minutes((r['build_s'] or 0) + (r['verify_s'] or 0))} | {money(r['cost'])}"
                     + (f" | {r['note']}" if r["note"] else "") + " |")
    lines.append("")
    if run["dry_run"]:
        lines.append("Dry run: no result.")
    else:
        lines.append(f"**{passed} of {total} passed**; {minutes(secs)} of the team's time; {money(cost)} at API prices "
                     f"(the ledger, by task; the architect's turns are not in it).")
    if run.get("stopped"):
        lines.append(f"\nStopped early: {run['stopped']}.")
    return "\n".join(lines) + "\n"


def load_run(name):
    path = os.path.join(RUNS, name, "run.json")
    if not os.path.exists(path):
        die(f"no run named {name} in {RUNS} (team.sh eval list)")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def per_task(run):
    """{task id: {'results': [...], 'cost': mean or None, 'secs': mean, 'slug': ...}} over the run's repeats."""
    out = {}
    for r in run["tasks"]:
        d = out.setdefault(r["id"], {"slug": r["slug"], "results": [], "costs": [], "secs": []})
        d["results"].append(r["result"] or "-")
        if r["cost"] is not None:
            d["costs"].append(r["cost"])
        d["secs"].append((r["build_s"] or 0) + (r["verify_s"] or 0))
    for d in out.values():
        d["cost"] = sum(d["costs"]) / len(d["costs"]) if d["costs"] else None
        d["sec"] = sum(d["secs"]) / len(d["secs"]) if d["secs"] else 0
        n = len(d["results"])
        p = d["results"].count("pass")
        d["text"] = d["results"][0] if n == 1 else f"{p}/{n} pass"
        d["pass_rate"] = p / n if n else 0
    return out


def cmd_compare(args):
    a, b = load_run(args.a), load_run(args.b)
    ta, tb = per_task(a), per_task(b)
    ids = sorted(set(ta) | set(tb))
    head = lambda r: f"{r['run']}" + (f" ({r['label']})" if r["label"] else "")  # noqa: E731
    lines = [f"# Eval: {head(a)} against {head(b)}", ""]
    for r in (a, b):
        roster = ", ".join(f"{k}: {v}" for k, v in r["roster"].items())
        lines.append(f"- **{head(r)}**: {r['started'][:10]}, {r.get('branch', 'main')} at {r['main']}" + (f", Claude Code {r['claude']}" if r["claude"] else "") + (f"; {roster}" if roster else "") + ".")
    lines += ["", "| task | A | B | A cost | B cost | A time | B time | |", "|---|---|---|---|---|---|---|---|"]
    flips = 0
    for i in ids:
        x, y = ta.get(i), tb.get(i)
        mark = ""
        if x and y and x["text"] != y["text"]:
            flips += 1
            mark = "better in B" if y["pass_rate"] > x["pass_rate"] else ("worse in B" if y["pass_rate"] < x["pass_rate"] else "changed")
        slug = (x or y)["slug"]
        lines.append(f"| {i} {slug} | {x['text'] if x else '-'} | {y['text'] if y else '-'} | {money(x['cost']) if x else '-'} | "
                     f"{money(y['cost']) if y else '-'} | {minutes(x['sec']) if x else '-'} | {minutes(y['sec']) if y else '-'} | {mark} |")
    pa, na, ca, sa = summary(a)
    pb, nb, cb, sb = summary(b)
    lines += ["", f"A: {pa} of {na} passed, {money(ca)}, {minutes(sa)}. B: {pb} of {nb} passed, {money(cb)}, {minutes(sb)}. "
              f"{flips} task{'s' if flips != 1 else ''} changed result.",
              "", "The article's reading: look at which tasks flipped, not only at the totals, and run each task more than once before trusting a flip (`--repeat`)."]
    print("\n".join(lines))


def cmd_list(args):
    if not os.path.isdir(RUNS):
        print("No runs yet.")
        return
    names = sorted(n for n in os.listdir(RUNS) if os.path.exists(os.path.join(RUNS, n, "run.json")))
    if not names:
        print("No runs yet.")
        return
    print(f"{'run':16} {'date':10} {'passed':8} {'cost':>8} {'time':>8}  label")
    for n in names:
        r = load_run(n)
        p, t, c, s = summary(r)
        res = "dry run" if r["dry_run"] else f"{p}/{t}"
        print(f"{r['run']:16} {r['started'][:10]:10} {res:8} {money(c):>8} {minutes(s):>8}  {r['label']}" + ("  (stopped early)" if r.get("stopped") else ""))


def cmd_clean(args):
    refs = git("for-each-ref", "--format=%(refname:short)", f"refs/heads/eval/{args.run}", f"refs/heads/eval/{args.run}-r*").split()
    if not refs:
        print(f"no branches for run {args.run}")
    # A worktree left on one of the run's branches (the builder's, after the last task) would keep it: detach it
    # there first, at the same commit, when it has nothing uncommitted.
    wt = None
    for line in git("worktree", "list", "--porcelain").splitlines():
        if line.startswith("worktree "):
            wt = line[len("worktree "):]
        elif line.startswith("branch refs/heads/") and line[len("branch refs/heads/"):] in refs and wt != REPO:
            dirty = subprocess.run(["git", "-C", wt, "status", "--porcelain"], capture_output=True, text=True).stdout.strip()
            if dirty:
                print(f"  {wt} is on {line[len('branch refs/heads/'):]} with uncommitted changes; left as it is")
            elif subprocess.run(["git", "-C", wt, "switch", "--detach", "--quiet"], capture_output=True).returncode == 0:
                print(f"  detached {wt} from {line[len('branch refs/heads/'):]}")
    for b in refs:
        out = subprocess.run(["git", "-C", REPO, "branch", "-D", b], capture_output=True, text=True)
        if out.returncode == 0:
            print(f"  deleted {b}")
        else:
            print(f"  kept {b}: {(out.stderr or out.stdout).strip().splitlines()[-1]}")
    if os.path.exists(BASE_WT):
        drop_worktree()
        print(f"  removed {BASE_WT}")
    print(f"The run's record stays in {os.path.join(RUNS, args.run)}.")


def cmd_check(args):
    items = load_set(args.only)
    errs = check_set(items)
    sys.exit(1 if errs else 0)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="team.sh eval", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check", help="the set is complete and its patches apply to the base branch")
    c.add_argument("--only", metavar="E-01,E-04", help="these tasks only")
    c.set_defaults(fn=cmd_check)
    r = sub.add_parser("run", help="run the set: build, verify, record")
    r.add_argument("--label", help="what this run is a run of: 'three agents, Opus builder'")
    r.add_argument("--only", metavar="E-01,E-04", help="these tasks only (a quick check, or the rest after a stop)")
    r.add_argument("--repeat", type=int, default=1, metavar="N", help="run the whole set N times (default 1)")
    r.add_argument("--builder", default="builder-1", help="the role that builds (default builder-1)")
    r.add_argument("--verifier", default="verifier", help="the role that verifies (default verifier)")
    r.add_argument("--build-cap", type=int, default=90, metavar="MIN", help="minutes a build may take before the builder is restarted (default 90)")
    r.add_argument("--verify-cap", type=int, default=45, metavar="MIN", help="the same for a verification (default 45)")
    r.add_argument("--tiers", metavar="E-03=light,E-09=heavy", help="run these tasks, and their verification, on a tier (team.sh assign --tier); the rest standard")
    r.add_argument("--dry-run", action="store_true", help="write the task files and the base branch; assign nothing")
    r.add_argument("--keep", action="store_true", help="with --dry-run, keep the branches")
    r.add_argument("--run-id", help=argparse.SUPPRESS)
    r.set_defaults(fn=cmd_run)
    ls = sub.add_parser("list", help="every run, with its result")
    ls.set_defaults(fn=cmd_list)
    cp = sub.add_parser("compare", help="two runs, task by task")
    cp.add_argument("a")
    cp.add_argument("b")
    cp.set_defaults(fn=cmd_compare)
    cl = sub.add_parser("clean", help="delete a run's branches (its record stays)")
    cl.add_argument("run")
    cl.set_defaults(fn=cmd_clean)
    args = ap.parse_args(argv)
    if getattr(args, "repeat", 1) < 1:
        ap.error("--repeat takes 1 or more")
    args.fn(args)


if __name__ == "__main__":
    main()
