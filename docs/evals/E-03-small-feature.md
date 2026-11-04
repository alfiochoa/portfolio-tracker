# E-03: (fill in: one line, what this task is, as the builder will read it)

Owner: builder-1
Branch: eval/{{RUN}}/E-03
Milestone: eval {{RUN}}

## Eval

Shape 3 of 10 of the fixed eval set, **a small feature, end to end**. What it measures: whether the builder can take one small slice from data to screen or command, following the patterns already in the codebase. No patch. The task adds something small that version 1 of the product could plausibly have. This file is written once and then frozen (`docs/evals/README.md`), so that every run is compared on the same work; `{{RUN}}` is replaced by the run's id when the task is handed out.

## Goal

(fill in: one small thing a user can do when this is done, and why it matters. Example: 'a visitor can sort the list by date, and the choice is kept when they come back'.)

## Acceptance

- (fill in: what a user can see or do, one line per part)
- The check command passes.
- (fill in: the new behaviour has a check)

## Where

(fill in: the folders the builder may change: the data, the logic, the screen or command, the checks)

## Out of scope

- (fill in: the obvious extension nobody asked for)

## Notes

- Branch from the run's base, not from the base branch: `git switch -c eval/{{RUN}}/E-03 eval/{{RUN}}/base`. Then set the checkout up as `CLAUDE.md` says.
- Do not push, and do not merge anything.
- (fill in: anything easy to get wrong, or nothing)

## How this is scored

For the verifier. Check out the builder's branch detached, `git switch --detach eval/{{RUN}}/E-03`, not the base branch; the base it started from is `eval/{{RUN}}/base`. Do not add tests to the suite for an eval task. Pass when every acceptance line holds in the running product, driven as `CLAUDE.md` says, and the check command passes. Also read the diff: a slice that works but ignores the patterns the rest of the codebase uses (`docs/ARCHITECTURE.md`, `docs/CONVENTIONS.md`) is a fail; say which pattern. End your Verification with one line on its own: `Result: pass` or `Result: fail`.

## Report

(builder) What changed, how it was checked, anything left open or found along the way.

## Review

(nobody: an eval task is not merged)

## Verification

(verifier) Each acceptance line: pass or fail, with evidence. Then the one line: `Result: pass` or `Result: fail`.
