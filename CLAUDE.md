# portfolio-tracker

<!-- The architect keeps this file true. One paragraph: what the product is, for whom, and what version 1 is. -->
portfolio-tracker is a one-page static site that shows Alfredo how his investment portfolio (eight Vanguard index funds, exported from his robo-advisor as `distribucion_agregada_cartera.xlsx`) is doing: today's allocation, and the return of each fund and of the whole over 1 day, 5 days, 1 week, 1 month and 2 months. A sibling of market-desk: static, no backend, no key in the browser, and a visible badge on the data's source and age. A snapshot script fetches fund prices (NAVs) into `public/data/prices.json`; the browser only reads files. `docs/SPEC.md` has the exact definitions.

Alfredo is the product owner. Assume they are not a full-time developer: when something is written for them, lead with what they can see or do, and explain an infrastructure term the first time it appears.

## Where things are

- `docs/SPEC.md`: what we are building, and the milestones.
- `docs/ARCHITECTURE.md`: stack, structure, data model, conventions.
- `docs/DESIGN.md`: the design system, kept by the designer. Follow it for anything a person sees. It appears once the owner has chosen a direction.
- `docs/DECISIONS.md`: decisions made along the way, newest first. Add an entry whenever you choose between real alternatives.
- `docs/CONVENTIONS.md`: how to add a feature, written by the architect in M0, or an index of the skills that say it.
- `.claude/skills/`: the rules for one kind of work each, read when that work comes up: `task-workflow` (every task), `running-the-team` (the architect's loop), and the project's own (a `verifying` skill, one per feature area).
- `docs/evals/`: the fixed eval set, ten small tasks run again after every change to the team (`scripts/team.sh eval`; its README says how). Written once, then frozen.
- `docs/team/README.md`: how the agent team works. Read it if you were started with a role (`architect`, `builder`, `verifier`, `designer`).
- `.team/`: the team's live board, task files and reports. It is not in git. Its absolute path is `/home/usuario/Repos/portfolio-tracker/.team` (also in `$TEAM_DIR`); always use the absolute path, because each agent works in a different checkout. The owner's file, which the architect keeps for them (what needs them, where things stand, what was decided without them), is `/home/usuario/Repos/portfolio-tracker/.team/for-alfredo.md` (also in `$TEAM_NEEDS`).

## Rules for every agent

A guard (`scripts/team-guard.py`, a hook in every session the team starts) refuses the commands these rules forbid before they run, and says which rule. It is a net, not the rule: know the rules.

- The check command is `npm run check` (typecheck, lint, unit tests; no network). It must pass before work is handed over.
- Never deploy or create remote resources (repositories, hosted databases, DNS records). Those are the owner's decisions and go through the architect.
- The base branch is `main`: every task branches from it and merges back into it, and it belongs to the architect. Pushing: only the architect pushes, and only `main` and tags to `origin`. Nobody force-pushes. (In a repository the owner does not own, nothing is pushed and no pull request is opened without their word; say so here.)
- Secrets live in `.env` at the repo root (`TWELVE_DATA_API_KEY=...`), which is gitignored and read only by `scripts/build-snapshots.ts`. Never commit them or copy them into task files or reports; never ask the owner to paste a key to an agent.
- Work only in your own checkout. The worktrees under `/home/usuario/Repos/portfolio-tracker-worktrees/` belong to the agent they are named after. Nobody runs `git reset --hard` in the main checkout: it throws away whatever is uncommitted there, whoever's it is.
- Run dev servers on your assigned port, `$TEAM_PORT`, so agents do not collide. Stop yours by its port (`lsof -ti tcp:$TEAM_PORT | xargs kill`), never with `pkill` or `killall`: those match other agents' servers and the team's own coordination processes.
- Never drive the Mac's own apps or the desktop (`osascript`, System Events, `screencapture`, Accessibility, real Safari or any other installed browser) and never trigger a macOS permission prompt. They are the owner's own apps, sessions and permissions, like an account or a credential. What needs one is written as steps for the owner and goes to the architect. Browsers are Playwright's, on your own port, and only ever open the product: Chromium starts with its sandbox on (`chromiumSandbox: true` in the launch options or the config's `use.launchOptions`; Playwright turns it off unless told).

## Commands

<!-- The architect fills this table in M0 and keeps it current. One row per command an agent will run. -->

| Command | What it does |
|---|---|
| `npm ci && npm run dev -- --port $TEAM_PORT` | Fresh checkout to a running product, on your port. |
| `npm run check` | The check command: typecheck, lint, unit tests. |
| `npm run build && npm run e2e` | The full test run: the built site under Playwright (once per milestone, on the closing commit, the verifier's). |
| `npm run import -- distribucion_agregada_cartera.xlsx` | Regenerate `data/portfolio.json` from a new export. |
| `npm run snapshots` | Rebuild `public/data/prices.json` from the price sources (reads `.env` if present). |
| `node scripts/recompute.ts` | Print what the page should show, computed from the two data files (the verifier's oracle). |

## How the verifier checks

Build the site and drive it with Playwright (Chromium, `chromiumSandbox: true`) on your own port, at 360×740 (phone) and 1280×800 (laptop), in both themes; screenshots and outputs go to `$TEAM_DIR/evidence/<task-id>/` and are read, not just taken. Anything the spec calls exact (weights, window returns, the badge state) is checked against the data files, not only the screen: `node scripts/recompute.ts` prints the expected values, and for one window the verifier does the arithmetic by hand from `public/data/prices.json`. The `verifying` skill has the details.
