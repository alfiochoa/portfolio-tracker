# E-05: (fill in: one line, what this task is, as the builder will read it)

Owner: builder-1
Branch: eval/{{RUN}}/E-05
Milestone: eval {{RUN}}

## Eval

Shape 5 of 10 of the fixed eval set, **every place a text appears**. What it measures: thoroughness: a change of wording that has to land everywhere it appears, in every language the product has. No patch. The task renames or rewords one thing the product says in several places. This file is written once and then frozen (`docs/evals/README.md`), so that every run is compared on the same work; `{{RUN}}` is replaced by the run's id when the task is handed out.

## Goal

(fill in: the old wording, the new wording, and why. Example: '"Sign up" becomes "Create account" everywhere a visitor reads it, in both languages'.)

## Acceptance

- No occurrence of the old wording remains where a user reads it (screens, messages, titles, emails).
- Every language the product has carries the new wording.
- The check command passes.

## Where

(fill in: where the product's texts live)

## Out of scope

- Rewording anything else.
- Changing identifiers, URLs or stored data that happen to contain the word.

## Notes

- Branch from the run's base, not from the base branch: `git switch -c eval/{{RUN}}/E-05 eval/{{RUN}}/base`. Then set the checkout up as `CLAUDE.md` says.
- Do not push, and do not merge anything.
- (fill in: anything easy to get wrong, or nothing)

## How this is scored

For the verifier. Check out the builder's branch detached, `git switch --detach eval/{{RUN}}/E-05`, not the base branch; the base it started from is `eval/{{RUN}}/base`. Do not add tests to the suite for an eval task. Pass when a search of the branch for the old wording (`git grep -i` over the texts, every language) finds nothing a user reads, the new wording appears in every language, the product shows it where the task names, and the check command passes. One missed occurrence is a fail; say where. End your Verification with one line on its own: `Result: pass` or `Result: fail`.

## Report

(builder) What changed, how it was checked, anything left open or found along the way.

## Review

(nobody: an eval task is not merged)

## Verification

(verifier) Each acceptance line: pass or fail, with evidence. Then the one line: `Result: pass` or `Result: fail`.
