# E-04: (fill in: one line, what this task is, as the builder will read it)

Owner: builder-1
Branch: eval/{{RUN}}/E-04
Milestone: eval {{RUN}}

## Eval

Shape 4 of 10 of the fixed eval set, **a change under the design rules**. What it measures: whether the builder's own design pass holds: a visible change that follows `docs/DESIGN.md` and the shared components instead of hard-coded values. No patch. The task changes something a person sees, where the design system already says how. This file is written once and then frozen (`docs/evals/README.md`), so that every run is compared on the same work; `{{RUN}}` is replaced by the run's id when the task is handed out.

## Goal

(fill in: a visible change a user would notice, described as what it looks like. Example: 'the empty state of the list says what to do next, in the product's voice'.)

## Acceptance

- (fill in: what it looks like, at the sizes and in the themes `CLAUDE.md` names)
- It uses the design tokens and shared components; no hard-coded colour, size or font.
- The check command passes.

## Where

(fill in: the screen's folder and the shared components it may use)

## Out of scope

- Changing the design system itself (`docs/DESIGN.md`, the tokens).
- (fill in)

## Notes

- Branch from the run's base, not from the base branch: `git switch -c eval/{{RUN}}/E-04 eval/{{RUN}}/base`. Then set the checkout up as `CLAUDE.md` says.
- Do not push, and do not merge anything.
- (fill in: anything easy to get wrong, or nothing)

## How this is scored

For the verifier. Check out the builder's branch detached, `git switch --detach eval/{{RUN}}/E-04`, not the base branch; the base it started from is `eval/{{RUN}}/base`. Do not add tests to the suite for an eval task. Pass when: screenshots at the named sizes and themes (saved under `$TEAM_DIR/evidence/E-04/`) show the change as described, nothing clipped or overlapping; `grep` of the diff finds no literal colour, pixel size or font name outside the token files; the check command passes. A change that looks right but hard-codes a value is a fail. End your Verification with one line on its own: `Result: pass` or `Result: fail`.

## Report

(builder) What changed, how it was checked, anything left open or found along the way.

## Review

(nobody: an eval task is not merged)

## Verification

(verifier) Each acceptance line: pass or fail, with evidence. Then the one line: `Result: pass` or `Result: fail`.
