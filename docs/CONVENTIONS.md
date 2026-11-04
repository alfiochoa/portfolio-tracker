# Conventions: how to add a feature

The architect wrote this in M0; it indexes where the rules are rather than repeating them.

1. **Read the slice in `docs/SPEC.md`** (the screen section and, if numbers are involved, "Exact definitions") and the module layout in `docs/ARCHITECTURE.md`.
2. **Logic first, in `src/lib/`**, pure and tested with literal fixtures under `tests/`; `now` is an argument, never `Date.now()` inside the function. If the feature shows a number, `scripts/recompute.ts` must print it from the same function.
3. **Then the section in `src/ui/`**, one file per section, rendering from the computed values; every state the spec lists (no snapshot, ok, stale, partial, error) is rendered, not derived by accident.
4. **Styles with tokens**: variables from `src/styles.css` (`docs/DESIGN.md` names them once the direction is chosen); no literal colours or sizes in components.
5. **The design pass is yours** (`.claude/skills/design-pass`): look at 360 px and 1280 px, both themes, before reporting.
6. **Check it the way a user would** (`.claude/skills/verifying`): your own server on `$TEAM_PORT`, `npm run check`, and the Playwright smoke if you touched what it covers.
7. **Data files are generated**: never edit `data/portfolio.json` or `public/data/prices.json` by hand; change the script or the catalogue (`data/funds.json`) and regenerate.
8. **Record a real choice** between alternatives in `docs/DECISIONS.md`, newest first, one short entry.
