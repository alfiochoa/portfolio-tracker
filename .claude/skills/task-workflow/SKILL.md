---
name: task-workflow
description: A worker's routine for one task: the branch from the base branch, commits, the task file and its Report or Blocked section, the shell traps on this Mac, when to leave a shared note, and the task-file template. Read at the start of every task you are assigned.
---

# Doing a task: branch, commits, report

Your role file says what your job is; this is the routine around it.

- **Branch** from the current base branch (`$TEAM_BRANCH` in your shell: `main`, or the branch `CLAUDE.md` names), named for the task: `git switch -c task/T-012-short-slug "$TEAM_BRANCH"` (`design/…` for the designer, `verify/T-012` for the verifier). One task, one branch. Never commit to the base branch; whoever assigned the task merges with `--no-ff`.
- **Commits**: small, in the imperative, saying what changed for a visitor or a developer, not which file: `Follow the language toggle in <html lang> and the meta description`. The body says why when it is not obvious. Attribution lines as `CLAUDE.md` says: some repositories forbid any mark of AI authorship, and then there is none. No generated files.
- **Don't push.** Pushing is the architect's, within `CLAUDE.md`'s rule for this repository.
- **The task file** (`$TEAM_DIR/tasks/T-###-slug.md`) is the record. The template is below. Whoever assigns the task writes Goal to Notes; you write **Report**: what changed and where, how you checked it (which commands, which screenshots you opened, which viewports and languages), and anything you found and did not fix. If you are stuck, write **Blocked** with what you need, and stop. Don't guess. When a script edits a section of a task file, match the whole heading line (`'\n## Report\n'`), never words that also appear elsewhere: a replace of `## Blocked` once matched the Notes and deleted the rest of the file.
- **Your stop ends the task.** Whoever assigned it is woken the moment you stop, reads the task file then, and waits for nothing of yours still running: a background command that ends later brings nothing back, and the next task's fresh conversation swallows its notification. Never end a turn waiting for anything (a background Bash command, a `Monitor`, "the notification" of a run). Wait for a long check in the foreground (one Bash call with a `timeout` of up to ten minutes; a longer run in bounded pieces, or an `until` loop with a deadline that polls its pid or log), write the Report or Verification section, then stop.
- **Shell traps on this Mac.** `rm` on a variable path (`rm -f $E/*.png`) stops you at a permission prompt that is denied after two minutes, and ends the wait on you of whoever assigned the task: write `"${E:?}"/*.png`, a literal path, or `find … -delete`. `ls` and `cat` are aliased in the owner's shell (`eza`, `bat`): scripts use `/bin/ls` and `/bin/cat`.
- **Playwright's Chromium runs sandboxed.** Playwright starts Chromium with `--no-sandbox` unless `chromiumSandbox: true` is in the launch options (or in the config's `use.launchOptions`). Without the sandbox, a bug in that browser runs code as the owner, with the secrets file and the logins in reach. Every config or script you write that launches Chromium sets it. Point the browser only at the product on your own port, never at an outside site.
- **A refused command.** A command that stops with `team guard: …` was refused by the guard for the rule it names (`CLAUDE.md`): do not look for another way to do the same thing. What needed it goes as steps for the owner under Blocked in the task file, and the architect hears of it in your report.
- **Shared notes**: a trap that cost you real time and will cost the next person too goes in one line with `scripts/team.sh note "…"`. What you built does not.

## The task file

Whoever assigns a task writes the brief (the architect). The person receiving it starts with an empty conversation, so the brief has to stand on its own.

```markdown
# T-012: change an item's status in the list

Owner: builder-2
Tier: standard (only with tiers on: light, standard or heavy, and why)
Branch: task/T-012-item-status
Milestone: M1

## Goal
What should be true when this is done, and why it matters to the person using the product.

## Acceptance
- Checkable statements, written as what a user can do or see.

## Where
Files and folders this task owns. Shared files it may touch, named one by one.

## Out of scope
What a reasonable builder might be tempted to add and should not.

## Notes
Decisions already made, pointers into the spec, anything that is easy to get wrong.

## Report
(builder) What changed, how it was checked, anything left open or found along the way.

## Review
(whoever assigned it) Merged, or the specific changes requested.

## Verification
(verifier) Each acceptance line: pass or fail, with evidence. Bugs with steps to reproduce.
```
