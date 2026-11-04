# E-02: (fill in: one line, what this task is, as the builder will read it)

Owner: builder-1
Branch: eval/{{RUN}}/E-02
Milestone: eval {{RUN}}

## Eval

Shape 2 of 10 of the fixed eval set, **a planted bug with no check**. What it measures: whether the builder reproduces a symptom described the way a user saw it, finds the cause, and leaves a check behind. `E-02-planted-bug-no-check.patch` breaks one visible behaviour that no automated check covers; it is applied to the run's base branch before the task is handed out. This file is written once and then frozen (`docs/evals/README.md`), so that every run is compared on the same work; `{{RUN}}` is replaced by the run's id when the task is handed out.

## Goal

(fill in: what a user saw, in their words: where they were, what they did, what happened instead of what they expected. No file names.)

## Acceptance

- (fill in: the behaviour, as what a user can see or do)
- A new automated check covers it and fails on the bug.
- The check command passes.

## Where

(fill in: the folder the builder may change)

## Out of scope

- (fill in)

## Notes

- Branch from the run's base, not from the base branch: `git switch -c eval/{{RUN}}/E-02 eval/{{RUN}}/base`. Then set the checkout up as `CLAUDE.md` says.
- Do not push, and do not merge anything.
- (fill in: anything easy to get wrong, or nothing)

## How this is scored

For the verifier. Check out the builder's branch detached, `git switch --detach eval/{{RUN}}/E-02`, not the base branch; the base it started from is `eval/{{RUN}}/base`. Do not add tests to the suite for an eval task. Pass when: the behaviour is right in the running product (drive it as `CLAUDE.md` says); the branch adds a check that passes, and that check fails when you apply `docs/evals/E-02-planted-bug-no-check.patch` to the branch in your checkout (`git apply`, run the check, then `git checkout -- .`); the check command passes. End your Verification with one line on its own: `Result: pass` or `Result: fail`.

## Report

(builder) What changed, how it was checked, anything left open or found along the way.

## Review

(nobody: an eval task is not merged)

## Verification

(verifier) Each acceptance line: pass or fail, with evidence. Then the one line: `Result: pass` or `Result: fail`.
