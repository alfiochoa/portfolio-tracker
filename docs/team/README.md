# How the team works

Claude Code sessions run in Herdr panes and build this product together. The owner, the product owner, talks to the architect and can watch any pane. This file says who is on the team and how the owner works with it. The protocol an agent follows is the `running-the-team` skill (`.claude/skills/running-the-team/SKILL.md`); `scripts/team.sh` is the tool; `CLAUDE.md` says what the product is.

## Who does what

The team runs with three agents, after Anthropic's article on folding subagents into one loop: the agent that plans is the one that sees every result, so nothing is summarised twice, and the rulebook is read in parts, when it applies, instead of in full by every session. The shape is measured milestone by milestone (below); the other three roles are one `join` away.

| Role | Checkout | Job | Default |
|---|---|---|---|
| `architect` | the main checkout (owns the base branch: `main`, or the one `scripts/team.conf` names) | Spec and architecture. Plans each milestone into tasks, dispatches, reviews, merges, closes. Talks to the owner. | on |
| `builder-1` | `<repo>-worktrees/builder-1` | Builds each task end to end, the design pass included. | on |
| `verifier` | `<repo>-worktrees/verifier` | Runs merged work the way a visitor would and reports what breaks; the milestone's closing run. | on |
| `designer` | `<repo>-worktrees/designer` | Direction options for the owner to choose between. | off |
| `builder-2` | `<repo>-worktrees/builder-2` | A second pair of hands for tasks that run in parallel. | off |

A role that is off has its line in `scripts/roster.conf` commented out, so `recover`, `status` and the views leave it alone. `scripts/team.sh bench <role>` takes a role off that way: its conversation kept, its line commented out, its pane closed. `scripts/team.sh join <role> <pane-to-split> right|down` brings one in: it uncomments the line and resumes the kept conversation when there is one. `scripts/team.sh pause` stops a role that stays on the team, and leaves its pane for `recover`.

**Task tiers** (off unless `TASK_TIERS="yes"` in `scripts/team.conf`): the architect gives each task a tier in its brief, `Tier: light|standard|heavy`. `scripts/team.sh assign` runs that task, and its verification, on the tier's model and effort for that task only: light is Sonnet 5.5 at high (`TIER_LIGHT`), heavy is Opus 5.5 at xhigh (`TIER_HEAVY`), standard is the roster. The cost ledger sums the tasks by tier, and `scripts/team.sh eval run --tiers E-03=light,E-09=heavy` measures a choice against a run without tiers. The designer comes in whenever the owner wants direction options.

Models, effort levels and dev ports are in `scripts/roster.conf`. The agents run in the Office tab of the project's workspace in Herdr. Roles are defined in `.claude/agents/`; each session is started with its role, so the role survives a cleared or compacted conversation. Herdr knows each agent by its role with the team's prefix in front (`scripts/team.conf`), so that two teams can run on one machine; `scripts/team.sh` takes plain roles.

Every agent's shell has `TEAM_AGENT` (its role), `TEAM_REPO` (the main checkout), `TEAM_DIR` (the absolute path of `.team/`) and, for workers, `TEAM_PORT` (its dev server port).

## The live board: `.team/`

Everything the team needs to know about work in flight is in `.team/` of the main checkout; `$TEAM_DIR` is its absolute path and `CLAUDE.md` repeats it. It is outside git, so every agent sees the same files whatever branch it is on. Use the absolute path.

```
.team/
  board.md                 the open milestone's tasks, their owners, their states
  board-archive.md         the tables and notes of closed milestones, moved off the board
  for-<owner>.md           what the owner reads when they come back: one screen (named after OWNER in scripts/team.conf)
  for-<owner>-archive.md   older "Decided without you" entries
  architect-notes.md       the architect's own notes, read at each of its starts
  milestones/M1.md         the architect's brief opening a milestone
  milestones/M1-report.md  the architect's report closing it
  milestones/M1-cost.md    what the milestone cost (scripts/team-cost.py)
  tasks/T-012-slug.md      one file per task: brief, report, review, verification
  tasks/D-001-slug.md      direction work the architect gives the designer
  notes.md                 one-line warnings about traps, read at the start of every task
  notes-removed.md         every note that was removed, with the reason
  evidence/T-012/          screenshots and outputs from the verifier and the builders
  design/                  the designer's direction options for the owner
  paused/<role>            the conversation id of a paused (benched) role
  status/                  what the status line, the views and the cost ledger write; nothing to read by hand
```

Task states on the board: `ready`, `building`, `review`, `changes requested`, `merged`, `verifying`, `done`, `blocked`.

## The loop, in short

1. The architect opens a milestone (`.team/milestones/M<n>.md`), writes the task files and the board.
2. It assigns a task (`scripts/team.sh assign builder-1 T-###`, in the background). The builder builds in its worktree on a branch from the base branch, checks its work in the running product, commits, writes its report and stops; that wakes the architect.
3. The architect reviews the diff and merges, or sends the task back with what must change.
4. The verifier checks the merged result the way a user would (`assign verifier T-###`); failures become tasks.
5. The milestone closes with the verifier's one full run on the closing commit, the architect's report, the tag, and the cost ledger. The owner is told what they can try.

 The details, the messages, who decides what and what to do when something goes wrong: the `running-the-team` skill. The task-file template: the `task-workflow` skill.

## Measuring the shape

What is compared, milestone by milestone, against the milestone before:

- the cost ledger, `python3 scripts/team-cost.py --milestone M<n>` (saved as `.team/milestones/M<n>-cost.md`): the total, and the share spent on direction and coordination against production;
- the time from opening the milestone to its tag (`for-<owner>.md` keeps the list);
- the defects the verifier finds after a merge, and the ones the owner finds after the close.

The article's closing rule applies: if a change to the team scores worse, it is reverted, and the trial cost one milestone.

Two milestones are never alike, so the project also keeps a **fixed eval set**: ten small tasks in `docs/evals/`, written once and frozen, that `scripts/team.sh eval run` hands to the builder and the verifier and scores (pass or fail, time, cost per task). Run it before and after a change to the team and `eval compare` shows which tasks flipped. `docs/evals/README.md` says how to write the ten and what a run costs (about a small milestone).

## Giving the team a task (for the owner)

Tell the architect the outcome you want and let it work out the steps. Three things make a task run without you:

1. **What you want to be able to do when it is finished.** "I can import my data from a file and see it on the main screen."
2. **How far to take it.** "Through M2", "working locally, not deployed", "good enough to show two friends".
3. **Anything you want to be asked about**, beyond the standing list the architect has. If you say nothing, the architect decides and tells you afterwards.

Then read `.team/for-<owner>.md` when you come back.

## Working without the owner

The team is meant to run for long stretches with nobody watching. An open question for the owner blocks only the work that depends on it; everything else continues. When something is theirs to decide but work can go on, the architect picks a sensible default, keeps going, and lists it in `.team/for-<owner>.md` under "Decided without you", with how to reverse it. Open questions that are their alone sit under "Needs you" in the same file. That file and `docs/DECISIONS.md` are how they checks afterwards what was decided and why.

## The guard

Every session `scripts/team.sh` starts carries a hook, `scripts/team-guard.py`, that refuses before it runs a command no agent may run: the Mac's own apps and permissions, `sudo`, `pkill`, a force-push, a login, deleting outside the repository and its worktrees, `git reset --hard` in the main checkout (and, on a partner team's machine, merging a pull request or pushing the base branch). The agent sees the rule as the reason and writes what it needed as steps for the owner. Denials are in `.team/status/guard.log`. A project adds its own patterns with `GUARD_DENY` in `scripts/team.conf`. It reads what a command runs, not what it says: a document written with `cat`, a `grep` pattern, a commit message or a message to a teammate may name the rules.

## A partner team

When another person's team helps on this repository from its own machine, `scripts/team.conf` names them (`PARTNER`, set by `install.sh --partner "<name>"`). The two teams talk through GitHub only: issues for requests and questions, pull requests for work, none of the owner's credentials on their machine, no live link between the machines. Their roster and the rules both teams follow are in the partner folder (`partner-team/` unless `PARTNER_DIR` says otherwise); the architect's side of it, on either machine, is in the `running-the-team` skill. Their machine runs these same scripts after `scripts/team.sh init --side partner`. On each machine a listener in the Awake tab (`scripts/github-activity.py`, no model calls) asks GitHub once a minute what the other team did and wakes the architect; the dashboard lists what is open between the teams, and the office shows the architect on a call while it reads or answers them.

## Watching the team

`python3 scripts/team-dash.py` is a dashboard for the owner. It refreshes every few seconds and shows each agent's state and what its screen says it is doing, the task branch each checkout is on, what needs them, the board, and the latest commits. It also shows each agent's context use, what is left of the plan's usage limits, what the open milestone has cost so far, and whether the architect's watchdog is alive (`scripts/team-watch.sh`, which the architect runs while work is in flight; its heartbeat is `.team/status/watch.json`). It reads Herdr, git, the session transcripts and the files in `.team/` and makes no model calls, so it costs nothing to leave running.

`python3 scripts/team-office.py` is the same information as a picture: each agent is a small Clawd at a desk, typing when it is working, asleep when it is idle, looking around when the architect is waiting on someone, and arms up when it is blocked on a prompt. It makes no model calls either.

`scripts/team.sh monitor` puts both, and the shared notes, beside the pane it runs in. `scripts/team.sh awake` opens an Awake tab that keeps the machine from sleeping while the team works, and, when `scripts/team.conf` turns it on, a memory guard that kills a Playwright browser helper that grows past 6 GB before it takes the screen down (kills are listed in `.team/status/memory-guard.log`). Running `awake` again reuses the open Awake tab and starts only what is missing in it.

When the account runs out of one model's usage, the Awake tab's model fallback (`scripts/team-fallback.py`, no model calls) restarts each agent that stopped on it on Opus 5.5 at xhigh, with its conversation, and puts it back on its own model when the limit resets; the dashboard marks such an agent with a `*` and says until when. `FALLBACK_MODEL` and `FALLBACK_EFFORT` in `scripts/team.conf` choose the model, and an empty `FALLBACK_MODEL` turns it off.

After the machine or Herdr restarts, `scripts/team.sh recover` puts the agents and the views back (`recover --check` only says what it would do). `scripts/team.sh pause <role>...` stops a role for days with its conversation kept.
