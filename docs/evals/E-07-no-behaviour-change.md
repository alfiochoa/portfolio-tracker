# E-07: (fill in: one line, what this task is, as the builder will read it)

Owner: builder-1
Branch: eval/{{RUN}}/E-07
Milestone: eval {{RUN}}

## Eval

Shape 7 of 10 of the fixed eval set, **a change with no behaviour change**. What it measures: discipline: a refactor whose output is identical, proved rather than asserted. No patch. The task moves or restructures code without changing what the product does. This file is written once and then frozen (`docs/evals/README.md`), so that every run is compared on the same work; `{{RUN}}` is replaced by the run's id when the task is handed out.

## Goal

(fill in: what to restructure and why it is worth it. Example: 'the three copies of the date formatting become one function in lib/dates'.)

## Acceptance

- (fill in: the structural goal, checkable: e.g. 'one definition remains; the three call sites use it')
- The check command passes.
- (fill in: what proves nothing changed: 'the build output is byte-identical', 'the screenshot set matches', 'the API answers are identical for the sample data').

## Where

(fill in)

## Out of scope

- Fixing anything found on the way: report it instead.
- Renaming beyond what the restructuring needs.

## Notes

- Branch from the run's base, not from the base branch: `git switch -c eval/{{RUN}}/E-07 eval/{{RUN}}/base`. Then set the checkout up as `CLAUDE.md` says.
- Do not push, and do not merge anything.
- (fill in: anything easy to get wrong, or nothing)

## How this is scored

For the verifier. Check out the builder's branch detached, `git switch --detach eval/{{RUN}}/E-07`, not the base branch; the base it started from is `eval/{{RUN}}/base`. Do not add tests to the suite for an eval task. Pass when the structural goal holds, the check command passes, and the proof of no change holds when you make it yourself: (fill in: the exact comparison, e.g. 'build both eval/{{RUN}}/base and the branch and compare the output folders with `diff -r`', or 'run the screenshot suite on both and compare'). A refactor with a behaviour change, however small, is a fail. End your Verification with one line on its own: `Result: pass` or `Result: fail`.

## Report

(builder) What changed, how it was checked, anything left open or found along the way.

## Review

(nobody: an eval task is not merged)

## Verification

(verifier) Each acceptance line: pass or fail, with evidence. Then the one line: `Result: pass` or `Result: fail`.
