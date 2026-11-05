# Fonts

Self-hosted so the page makes no third-party request (`docs/DESIGN.md`, "Type › Fonts"). Latin subsets (Google Fonts' `latin` range), woff2, declared with `font-display: swap` at the top of `src/styles.css`.

| File | Family | Used by | Licence |
|---|---|---|---|
| `manrope-latin.woff2` | Manrope 4.505, variable, weights 200–800 | Glance | SIL OFL 1.1, `OFL-Manrope.txt` |
| `ibm-plex-sans-latin.woff2` | IBM Plex Sans 3.201, variable, weights 100–700 | Desk | SIL OFL 1.1, `OFL-IBM-Plex.txt` |
| `ibm-plex-mono-latin-400.woff2`, `-500`, `-600` | IBM Plex Mono 2.3 | Desk | SIL OFL 1.1, `OFL-IBM-Plex.txt` |

`manrope-latin.woff2` is a Modified Version under the OFL: one cmap entry was added, mapping U+202F (narrow no-break space, the euro amounts' thousands separator) to the font's existing space glyph, because the subset has no glyph for it. Nothing else differs from the subset Google Fonts serves. Manrope has no Reserved Font Name. The IBM Plex files are unmodified.
