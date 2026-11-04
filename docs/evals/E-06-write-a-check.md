# E-06: (fill in: one line, what this task is, as the builder will read it)

Owner: builder-1
Branch: eval/{{RUN}}/E-06
Milestone: eval {{RUN}}

## Eval

Shape 6 of 10 of the fixed eval set, **a check for a behaviour that has none**. What it measures: whether the builder can write an automated check that proves a behaviour: one that passes on the product as it is and fails when the behaviour is broken. No patch. The task names an existing behaviour no check covers. This file is written once and then frozen (`docs/evals/README.md`), so that every run is compared on the same work; `{{RUN}}` is replaced by the run's id when the task is handed out.

## Goal

(fill in: the behaviour, as a user sees it, that must stay true. Example: 'a signed-out visitor who opens a private page is sent to sign in and comes back to that page afterwards'.)

## Acceptance

- A check covers the behaviour, in the feature's own check file.
- The check passes on the branch.
- The check fails when the behaviour is broken.

## Where

(fill in: the checks' folder, and the feature's check file)

## Out of scope

- Changing product code.
- (fill in)

## Notes

- Branch from the run's base, not from the base branch: `git switch -c eval/{{RUN}}/E-06 eval/{{RUN}}/base`. Then set the checkout up as `CLAUDE.md` says.
- Do not push, and do not merge anything.
- (fill in: anything easy to get wrong, or nothing)

## How this is scored

For the verifier. Check out the builder's branch detached, `git switch --detach eval/{{RUN}}/E-06`, not the base branch; the base it started from is `eval/{{RUN}}/base`. Do not add tests to the suite for an eval task. Pass when: the check runs and passes; it fails when you break the behaviour in your own checkout (`(fill in: the one-line change that breaks it, e.g. comment out the redirect in X)`, run the check, then restore); it lives in the feature's file, not in a file of its own; and the product code is untouched (`git diff eval/{{RUN}}/base...eval/{{RUN}}/E-06 -- (fill in: the product's folders)` is empty). End your Verification with one line on its own: `Result: pass` or `Result: fail`.

## Report

(builder) What changed, how it was checked, anything left open or found along the way.

## Review

(nobody: an eval task is not merged)

## Verification

(verifier) Each acceptance line: pass or fail, with evidence. Then the one line: `Result: pass` or `Result: fail`.
