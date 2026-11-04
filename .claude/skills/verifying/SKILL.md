---
name: verifying
description: How a change to (fill in: the product) is checked: your own server on your port, the check command, the sizes or inputs that matter, which outputs to open and what to look for. Read before reporting a change and before verifying a task.
---

<!-- A skeleton from the agent team kit. The architect fills it in during M0 (and keeps it true); a run of the team does not need it filled in, but every builder and the verifier read it, so what is here decides what "checked" means. Remove this comment when done. -->

# Verifying a change

Look at the result; a green run is not enough on its own.

## What matters

(fill in: for a web app, the viewports, as a table with the device each stands for, smallest first, and the themes and languages; for a tool, the sample inputs and the outputs that must match; for a service, the requests and the data they must leave behind.)

## The commands, each in your own checkout

- Your own server (if the product has one): `(fill in: the command, on $TEAM_PORT)`. Stop it by its port (`lsof -ti tcp:$TEAM_PORT | xargs kill`), never with `pkill` or `killall`.
- **The check command**: `(fill in: typecheck, lint, unit tests, as CLAUDE.md names it)`. It must pass before any report.
- The quick check while you work: `(fill in: the fastest subset, e.g. one spec file, one module)`.
- The full run, once per milestone on the closing commit, the verifier's: `(fill in)`.

## How to verify a change

1. Run the product the way a user would: `(fill in: a browser driven by Playwright at the sizes above; the command-line tool against the sample data; ...)`.
2. Walk each acceptance line of the task, then what a user would get wrong: empty input, going back, the same action twice, a long name, a signed-out visit.
3. Save the evidence in `$TEAM_DIR/evidence/<task-id>/` and read it: `(fill in: which screenshots or outputs, and what a failure looks like in them: overlapping text, a hidden control, a wrong count, an empty state missing)`.
4. For anything about permissions or anything the spec calls exact, check the data or the API directly, not only the screen.

## Traps

(fill in, or remove: the one-line traps of this product's tooling that the shared notes have proven true, moved here at a milestone close.)
