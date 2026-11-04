# E-10: (fill in: one line, what this task is, as the builder will read it)

Owner: builder-1
Branch: eval/{{RUN}}/E-10
Milestone: eval {{RUN}}

## Eval

Shape 10 of 10 of the fixed eval set, **an addition within a budget**. What it measures: measuring: adding something while a size or time budget holds, which the builder has to measure, not assume. No patch. The task adds something to a part of the product that has a budget. This file is written once and then frozen (`docs/evals/README.md`), so that every run is compared on the same work; `{{RUN}}` is replaced by the run's id when the task is handed out.

## Goal

(fill in: what to add, and the budget it must stay within. Example: 'a third illustration on the landing page; the page's transferred size stays under 900 KB', or 'the import handles a 10,000-row file in under five seconds'.)

## Acceptance

- (fill in: the addition, as a user sees it)
- (fill in: the budget, with the number and how it is measured: 'measured by `scripts/budget.sh`')
- The report gives the measurement before and after.
- The check command passes.

## Where

(fill in)

## Out of scope

- Raising the budget.
- Removing something else to make room without saying so in the report.

## Notes

- Branch from the run's base, not from the base branch: `git switch -c eval/{{RUN}}/E-10 eval/{{RUN}}/base`. Then set the checkout up as `CLAUDE.md` says.
- Do not push, and do not merge anything.
- (fill in: anything easy to get wrong, or nothing)

## How this is scored

For the verifier. Check out the builder's branch detached, `git switch --detach eval/{{RUN}}/E-10`, not the base branch; the base it started from is `eval/{{RUN}}/base`. Do not add tests to the suite for an eval task. Pass when: the addition is there; your own measurement (`(fill in: the exact command)`) is within the budget; the report states the before and after numbers and they match yours within noise; the check command passes. A report with no numbers is a fail even when the budget holds. End your Verification with one line on its own: `Result: pass` or `Result: fail`.

## Report

(builder) What changed, how it was checked, anything left open or found along the way.

## Review

(nobody: an eval task is not merged)

## Verification

(verifier) Each acceptance line: pass or fail, with evidence. Then the one line: `Result: pass` or `Result: fail`.
