# The look of the thing

Where the visual design lives, what is already a lever you can pull, and what
will fight you. Written to make an aesthetic overhaul a matter of changing
values rather than hunting literals.

## Where things are

| | |
|---|---|
| Tokens | `web/src/styles.css`, the `:root` block at the top |
| Dark theme | `[data-theme="dark"]`, same file |
| Accents | `[data-accent="…"]`, six of them, light and dark variants |
| Everything else | `styles.css` (1.9k lines) + 13 files in `web/src/styles/` |

Themes and accents are set as attributes on `<html>` from Settings. Nothing
reads a theme in JavaScript — a component that needs to look different in dark
mode does it by using a token that flips.

## The levers that already work

**Colour.** 31 tokens, ~580 uses. Change `--accent` and the whole app follows.
The palette (`--green`, `--amber`, `--red`, `--blue`, `--purple`, `--teal`,
`--gray`, each with a `-soft` companion) is what project and section colours
resolve to.

**Density.** `--space-1` … `--space-12`, a two-pixel scale, 265 uses. Tightening
or opening up the whole interface is editing ten numbers. The scale was derived
from what the app already did — its four commonest gaps are 6, 8, 4 and 10px —
rather than imposed, so adopting it needed no visual change at all.

Odd values (1, 3, 5, 7, 9, 11px) are deliberately **not** on the scale. Those
are optical nudges on individual controls — centring a glyph, kissing a border —
and a density change should not move them. They are still literals, on purpose.

**Surfaces.** `--hover`, `--hover-soft`, `--sunken` for rows that react to the
pointer and days outside the current month. These used to be written twice: a
light value at the rule and a dark one in a block of duplicated selectors, so
every new hoverable thing had to be remembered in both places or it glowed white
in dark mode.

**Shape.** `--radius`, `--radius-sm`, `--shadow`, `--shadow-pop`.

## What will fight you

### 1. Type has no scale — 137 declarations across 17 sizes

```
 9.5×1   10×7   10.5×13   11×14   11.5×22   12×25   12.5×16   13×18
13.5×6   14×2   14.5×4    15×2    16.5×1    17×1    19×1      20×3   22×1
```

Seventeen steps where a scale wants five or six, and the half-pixel sizes are
doing real work — this interface is tuned tight and 11.5px is genuinely not
12px. That is why they were left alone: collapsing them **changes how the app
looks**, which is the overhaul's decision to make, not a preparation step.

Suggested collapse, to be argued with:

| Step | Take | Now |
|---|---|---|
| `--text-2xs` | 10px | 9.5, 10 |
| `--text-xs` | 11px | 10.5, 11 |
| `--text-sm` | 12px | 11.5, 12 |
| `--text-base` | 13px | 12.5, 13 |
| `--text-lg` | 14px | 13.5, 14, 14.5 |
| `--text-xl` | 17px | 15, 16.5, 17 |
| `--text-2xl` | 20px | 19, 20, 22 |

Do this first. It is the single change that will most alter the app's character,
and every later decision depends on the resulting rhythm.

### 2. 118 inline `style={{…}}` blocks across 25 files

These bypass the stylesheet entirely, so a redesign cannot reach them.

```
21  pages/Day.jsx      15  pages/ProjectDetail.jsx   15  pages/PersonDetail.jsx
13  pages/People.jsx    7  pages/Week.jsx             6  pages/Projects.jsx
```

Not all are wrong. Three kinds live in here and only one is a problem:

- **Computed** — `style={{ marginLeft: depth * 22 }}`, `background: project.color`,
  the day column's grid template. These *belong* inline; a stylesheet cannot
  know the depth of a row. Leave them, but pull their constants into tokens
  (`22` above is an indent step nothing names).
- **Layout one-offs** — `style={{ gap: 16 }}`, `style={{ padding: 6 }}`. These
  are the problem. Roughly two-thirds of the count. They should be classes, or
  at minimum `var(--space-*)`.
- **Visibility** — `style={{ display: none }}` for folded panels. Fine.

### 3. The sidebar is its own palette

`--sb-bg`, `--sb-hi`, `--sb-act`, `--sb-ink`, `--sb-accent` — the rail is dark in
both themes by design, so it does not use `--panel` or `--ink`. That is
deliberate, but it means the rail will not follow a light-theme redesign unless
you decide it should. Around a dozen literal colours in the rail's rules
(`#fff`, `#7b85a6`, `#8b95b5`, `rgba(255,255,255,.09)`) belong to this palette
and are not strays.

### 4. `--hover-soft` is accidental

It exists because `.rich-view:hover` was written as `#fcfcfd` while everything
else used `#fafbfc` — a two-unit difference nobody intended and nobody can see.
Collapse it into `--hover` the moment you touch that rule.

### 5. `styles.css` is 1.9k lines

Thirteen page stylesheets were split out; the core never was. It holds the
tokens, the reset, the rail, buttons, panels, task rows, the day grid, the
calendar and the tables. Splitting it is not urgent, but the token block should
move to its own file the moment a second thing needs to import it.

## Ground rules

**Nothing renders differently unless that is the change.** The spacing scale was
adopted by converting 337 literals to tokens and then verifying that expanding
every token back gave byte-identical CSS. Any mechanical refactor here should be
able to make the same claim.

**Test before and after.** `npm test` drives the built app in jsdom against the
real API — 24 suites. It will not catch a colour, but it will catch a layout
change that breaks a drag target or hides a control, which is how visual
refactors usually break things.

```bash
npm test
```

**Check both themes and a couple of accents.** Most regressions are a token that
only got a light value.
