# portfolio-tracker

<!-- The architect keeps this file true. One paragraph: what the product is, for whom, and what version 1 is. -->
(What portfolio-tracker is. the owner's first message to the architect is the brief; the architect writes this paragraph and `docs/SPEC.md` from it.)

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

- The check command is `(fill in: e.g. pnpm check, make check, cargo test)`. It must pass before work is handed over.
- Never deploy or create remote resources (repositories, hosted databases, DNS records). Those are the owner's decisions and go through the architect.
- The base branch is `main`: every task branches from it and merges back into it, and it belongs to the architect. Pushing: only the architect pushes, and only `main` and tags to `origin`. Nobody force-pushes. (In a repository the owner does not own, nothing is pushed and no pull request is opened without their word; say so here.)
- Secrets live in `(fill in: e.g. .dev.vars or .env)`, which is gitignored. Never commit them or copy them into task files or reports.
- Work only in your own checkout. The worktrees under `/home/usuario/Repos/portfolio-tracker-worktrees/` belong to the agent they are named after. Nobody runs `git reset --hard` in the main checkout: it throws away whatever is uncommitted there, whoever's it is.
- Run dev servers on your assigned port, `$TEAM_PORT`, so agents do not collide. Stop yours by its port (`lsof -ti tcp:$TEAM_PORT | xargs kill`), never with `pkill` or `killall`: those match other agents' servers and the team's own coordination processes.
- Never drive the Mac's own apps or the desktop (`osascript`, System Events, `screencapture`, Accessibility, real Safari or any other installed browser) and never trigger a macOS permission prompt. They are the owner's own apps, sessions and permissions, like an account or a credential. What needs one is written as steps for the owner and goes to the architect. Browsers are Playwright's, on your own port, and only ever open the product: Chromium starts with its sandbox on (`chromiumSandbox: true` in the launch options or the config's `use.launchOptions`; Playwright turns it off unless told).

## Commands

<!-- The architect fills this table in M0 and keeps it current. One row per command an agent will run. -->

| Command | What it does |
|---|---|
| `(fill in)` | Fresh checkout to a running product. |
| `(fill in)` | The check command: typecheck, lint, unit tests. |
| `(fill in)` | The full test run (once per milestone, on the closing commit, the verifier's). |

## How the verifier checks

<!-- The architect writes this: what "the way a user would" means for this product. Examples: "In a browser driven by Playwright at 390 x 844, phone first, then 1280 wide; both themes." Or: "By running the command-line tool against the sample data in fixtures/ and reading its output." -->
(fill in)
