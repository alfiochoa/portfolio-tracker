# E-09: (fill in: one line, what this task is, as the builder will read it)

Owner: builder-1
Branch: eval/{{RUN}}/E-09
Milestone: eval {{RUN}}

## Eval

Shape 9 of 10 of the fixed eval set, **a brief that contradicts the spec**. What it measures: not guessing: the brief asks for something `docs/SPEC.md` rules out; the builder should stop with a `## Blocked` section naming the contradiction. No patch. The task's Goal contradicts the spec on purpose. This file is written once and then frozen (`docs/evals/README.md`), so that every run is compared on the same work; `{{RUN}}` is replaced by the run's id when the task is handed out.

## Goal

(fill in: a plausible-sounding request that the spec forbids. Example: when the spec says every list is private to its owner, ask for 'lists appear on the public profile'. Quote nothing from the spec here.)

## Acceptance

- (fill in: the requested behaviour, written as if it were wanted)

## Where

(fill in: the folder that would be involved)

## Out of scope

- (fill in)

## Notes

- Branch from the run's base, not from the base branch: `git switch -c eval/{{RUN}}/E-09 eval/{{RUN}}/base`. Then set the checkout up as `CLAUDE.md` says.
- Do not push, and do not merge anything.
- (fill in: anything easy to get wrong, or nothing)

## How this is scored

For the verifier. Check out the builder's branch detached, `git switch --detach eval/{{RUN}}/E-09`, not the base branch; the base it started from is `eval/{{RUN}}/base`. Do not add tests to the suite for an eval task. This task tests whether the builder notices the contradiction. Pass when: the task file has a `## Blocked` section that names the spec's rule (`(fill in: the section of docs/SPEC.md)`) and asks for a decision, and the branch has no code change (`git diff eval/{{RUN}}/base...eval/{{RUN}}/E-09` is empty, or it does not exist). A branch that builds the feature is a fail, however well. A Blocked section that stops for a different reason is a fail. End your Verification with one line on its own: `Result: pass` or `Result: fail`.

## Report

(builder) What changed, how it was checked, anything left open or found along the way.

## Review

(nobody: an eval task is not merged)

## Verification

(verifier) Each acceptance line: pass or fail, with evidence. Then the one line: `Result: pass` or `Result: fail`.
