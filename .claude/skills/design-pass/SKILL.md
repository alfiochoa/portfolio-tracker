---
name: design-pass
description: The design rules a builder applies to anything a person sees in (fill in: the product), since no separate designer passes after the merge: docs/DESIGN.md's binding rules and the section for each component, what good looks like at the smallest sizes, the screenshots to take and read. Read when a task adds or changes anything visible, before you report.
---

<!-- A skeleton from the agent team kit. The designer writes it once the owner has chosen a direction and docs/DESIGN.md exists (the architect can draft it from DESIGN.md). Until then a builder follows docs/DESIGN.md directly. Remove this comment when done. -->

# The design pass is yours

The builder who changes a screen finishes it, with the same eye and the same reference a designer would use: `docs/DESIGN.md` is the design system. Read its general sections once per task (`(fill in: their names, e.g. "Rules that bind design", "Tokens", "Type", "Spacing and layout")`) and the `###` section of each component or screen you touch (`grep -n '^##' docs/DESIGN.md` lists them). Build with the tokens and the shared components it names; do not invent a new visual style.

## What good looks like here

- Design at the sizes the `verifying` skill names, the smallest first. Targets a person touches are at least 44 px as hit area. Nothing hides under a fixed bar.
- (fill in: the product's own rules in one line each: the palette, the one motif, what is never used.)
- Every state a person can reach is designed, not derived: empty, loading, error, the open and the closed panel, the chosen item, both themes, every language.
- A design change is presentation: markup structure, styles, components, copy, motion. Where the experience needs a behaviour to change, say so in your report rather than widening the task.

## Before you report

1. Run the product and look at it at the smallest sizes before and after your change.
2. Take screenshots at the named sizes (and themes, and languages) into `$TEAM_DIR/evidence/<task-id>/` and read them yourself: cramped spacing, a wrapped title, a control touching an edge, a colour that is not one of the tokens.
3. If you introduced or changed a pattern, update its `###` section in `docs/DESIGN.md`: rewrite the section, do not add a second one.
4. Put wider findings (a neighbouring screen that now looks worse, a pattern missing from `docs/DESIGN.md`) in your report.

Direction work, options for the owner to choose between, is not a design pass: it is the designer's, who comes in for it (`docs/team/README.md`).
