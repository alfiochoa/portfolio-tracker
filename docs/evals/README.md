# The fixed eval set

Ten small tasks, written once for this project and never changed afterwards, that the team runs again after every change to how the team is set up: three agents instead of six, another model in a seat, a rewritten role file, a new Claude Code version. Two real milestones are never alike, so comparing them says little about such a change; the same ten tasks, run before and after, say more. The idea is the article's the team's shape comes from (`docs/principles.md` in the kit: "even a set of 10 golden examples is enough to start"; look at which tasks flipped, not only at the score; run each task more than once).

What a run measures: for each task, whether the verifier passed it, how long the builder and the verifier took, and what it cost (the ledger, `scripts/team-cost.py`, at API prices). What it does not measure: the architect's planning and its decisions on the owner's behalf, which only a real milestone shows. The set judges the workers and the loop's mechanics.

## The ten shapes

Each task file in this folder is one shape, with `(fill in` markers where this project's own content goes. A run refuses to start while a marker remains.

| | shape | what it measures | setup |
|---|---|---|---|
| E-01 | a planted bug with a failing check | from a failing check to the cause, check untouched | a patch |
| E-02 | a planted bug with no check | reproducing a user's symptom; leaving a check behind | a patch |
| E-03 | a small feature, end to end | one slice data to screen, on the codebase's patterns | |
| E-04 | a change under the design rules | the builder's own design pass; tokens, not literals | |
| E-05 | every place a text appears | thoroughness, every language | |
| E-06 | a check for a behaviour that has none | a check that passes, and fails when it should | |
| E-07 | a change with no behaviour change | a refactor proved identical, not asserted | |
| E-08 | the fix is outside the task | boundaries: report it, do not widen | a patch |
| E-09 | a brief that contradicts the spec | not guessing: a `## Blocked` naming the rule | |
| E-10 | an addition within a budget | measuring before and after | |

For E-08 and E-09 the expected pass is a report or a Blocked section, not a built feature. The verifier's instructions in each file ("How this is scored") say exactly what counts, so that the result does not depend on who verifies.

## Writing the set

Once, by the architect (the owner can ask for it at any milestone boundary: "write the eval set"), from the product as it stands, in a task of its own. The rules:

- **Small.** Each task is one sitting for a builder, under an hour. The set is run twice per change, so ten big tasks would cost more than the change they measure.
- **Real.** Each is something the product could really need, so that the result says something about real work. A planted bug is a real bug of a kind the project has had.
- **Checkable without judgment.** "How this is scored" tells the verifier what to look at and when it is a pass; a line it could read two ways is a line to rewrite.
- **Frozen after the first run.** Once a run exists, a task file is not edited, or the runs stop being comparable. A task that turns out to be wrong is retired (moved to `docs/evals/retired/`) and replaced by a new number, with a line in `docs/DECISIONS.md`.
- **A planted bug is a patch file beside the task**, `E-01-planted-bug-with-check.patch`: on a branch from the base branch, break the behaviour, then `git diff "$TEAM_BRANCH" > docs/evals/E-01-planted-bug-with-check.patch`, and delete the branch. The run applies the set's patches, in order, on a branch `eval/<run>/base` made from the base branch, and the builder works from that. As the base branch moves, a patch can stop applying; `scripts/team.sh eval check` says so, and the patch is remade (the task file stays).
- **A planted bug's own check stays out of the check command.** The run applies every task's patch to one base, so a check the check command runs (a unit test, a type check) that the planted bug breaks would fail on that base for every other task too, and each of their "the check command passes" with it. Plant a bug whose check is a test the check command does not run (an end-to-end spec, a script), or one the check command does not yet cover.
- **Every task says where to branch from** (`eval/{{RUN}}/base`, the placeholder filled in at the run) and tells the verifier to check out the builder's branch, not `main`. The skeletons have both.

## Running it

When the team is idle between milestones, or whenever the owner says. The run uses builder-1 and the verifier for a few hours; it tells the architect at the start and the end, so the architect assigns them nothing meanwhile.

```
scripts/team.sh eval check                                      # the set is complete, every patch applies
scripts/team.sh eval run --label "three agents, Opus builder"   # the whole set, once
scripts/team.sh eval run --only E-01,E-09                       # a quick look at two tasks
scripts/team.sh eval run --repeat 3 --label "..."               # three times over, for the flaky ones
scripts/team.sh eval list                                       # every run so far
scripts/team.sh eval compare 20261027-0900 20261029-2100        # task by task, with the flips
scripts/team.sh eval clean 20261027-0900                        # delete that run's branches (the record stays)
```

`run` makes `eval/<run>/base` from the base branch with the patches applied, copies each task into `.team/tasks/` with the run's id filled in, assigns it to the builder, waits, assigns it to the verifier, waits, reads the verifier's `Result:` line, and goes on to the next. Each task gets a cap (90 minutes to build, 45 to verify; `--build-cap`, `--verify-cap`); past it the agent is restarted and the task counts as timed out. An agent stopped at a Claude Code prompt ends the run, since the prompt is the owner's to answer; the record says where it stopped and `--only` runs the rest. `--dry-run` does everything but assign, to check the set and the branches.

Everything a run writes is in `.team/evals/<run>/`: `run.json` (the numbers), `report.md` (the table), `log.txt` (what `assign` printed), and `tasks/` (the task files as the agents left them, with their reports and verifications). The branches `eval/<run>/E-NN` keep the builder's work until `clean`.

## Reading the result

`report.md` is one table: for each task the build's outcome (a report, a Blocked section, nothing, timed out), the verify's, the result (`pass`, `fail`, `unscored` when the verifier wrote no `Result:` line, `no report` when the builder wrote nothing), the time and the cost. The last line counts the passes.

`compare A B` puts two runs side by side and marks each task whose result changed: *better in B*, *worse in B*. A change to the team is kept when B is not worse: no task went from pass to fail that did not come back on a repeat, the cost did not rise, the time did not grow. One flip on one run is a reason to `--repeat`, not a verdict; some failures show only sometimes.

## What it costs

About what a small milestone costs: ten tasks of under an hour each, each built once and verified once, is in the region of a small milestone (about $20 at API prices and three hours of the team's time). Twice per change, before and after. It is not run on a schedule; only when the team changes.
