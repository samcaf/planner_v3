# Working on this planner

A calendar-first planner. `README.md` says what it does and where the files
live; `DESIGN.md` says how the look is put together and what will fight you.
This file is for the agent: how to go about a change here, and the few rules
that nothing in the code can enforce for you.

## Running it

```bash
npm run dev
```

Two processes: the API on **8787** and Vite on **5173**, which proxies `/api`
to it. `npm start` serves the built app and the API together on 8787.

## Testing

```bash
npm test
```

End-to-end suites that drive the real built app in jsdom against the real
server. They need `npm run dev` up. **Do not rebuild `web/dist` while a run is
in flight** — the asset filename is hashed, and a page that fetched
`index.html` before the rebuild 404s on its script after it.

Rows are created on far-future dates and deleted by id at the end of each
suite, so nothing of the user's is touched. A suite killed part-way leaves its
probe rows behind; stop runs cleanly.

New behaviour gets a new `test/batchNN.mjs`, numbered after the last one.

## House style

The comments here explain **why**, not what. A comment that restates the line
below it is noise; a comment saying which of two plausible designs this is and
what went wrong with the other one is the reason the file is readable a year
later. Match that density — it is higher than most codebases and deliberately
so.

Prefer the smallest change that is honest. If a fix needs a mechanism, say in
a comment why the simpler thing did not work.

## Things that must be updated together

Nothing checks these. They are the places where a change in one file silently
makes another file a lie.

### Keyboard shortcuts → the Settings page

Settings has a **Keyboard** tab. It does not hold a copy of anything: it
renders the same tables the bindings are declared in. Keep it that way.

| bind a key in | document it in |
|---|---|
| `web/src/App.jsx` (`Shortcuts`) or `web/src/lib/nav.js` | `web/src/lib/shortcuts.js` — `GENERAL` |
| `web/src/components/Selection.jsx` (`KEYS`, `STEPS`) | the same — it is live whenever tasks are picked |
| `web/src/components/VimLayer.jsx` (the key handler or `runCommand`) | `HELP`, at the top of that same file |

`GENERAL` is drawn by the `?` sheet and by the Keyboard tab. `HELP` is drawn by
the keyboard-control sheet and by the Keyboard tab. Adding a binding without
adding its row is the whole of the bug — there is no third place to update.

**The `g` table is shared on purpose.** `lib/nav.js` is the one answer to "where
does `g` then a letter go", read by both the plain layer and keyboard control,
so a destination cannot mean two things depending on a mode you cannot see.
Every destination lives under `g`; a bare letter must not become a shortcut.

### The AI suite → the Settings page

Settings has an **AI suite** tab. Same rule, one source each:

| change | update |
|---|---|
| a switch, its values, or what one means | `web/src/lib/aiSwitches.js` — the tab generates its tables from `ENFORCED` and `DECLARED`, including each value's `about` text |
| how conversations, layering, or the ceiling work | `ABOUT` in `web/src/lib/aiGuide.js` |
| an MCP tool added, renamed or moved between scopes | `MOVES` / `SCOPES` in `web/src/lib/aiGuide.js`, **and** `mcp/README.md` |
| the query language | `QUERY` in `web/src/lib/aiGuide.js`, and `mcp/README.md` |

The switch tables need nothing: adding a switch to `aiSwitches.js` makes it
appear on the page with its own explanation, because `hint` and `about` are what
the page prints. Give every new switch both.

`aiGuide.js` is the part nothing can check — it mirrors `mcp/server.js` in
prose. Treat a change to the tool list as a change to that file too.

## The keyboard, in one paragraph

The cursor is found in the DOM, not held by a page: anything drawing
`.task[data-task-id]`, `.panel.section[data-section-id]`, `[data-open]` (a card)
or `[data-act]` (a row whose point is its button) is a stop, and navigation
works there without the page knowing the mode exists. `lib/vim.jsx` owns
`STOPS` — read it, never write the selector out again. Actions go through the
page's own handlers, lent by `useVimActions`, so every keystroke is undoable
exactly like the click it replaces.

## Data

One SQLite file at `data/planner.db`. It is the user's real data — the dev
server runs against it. Do not seed, reset or migrate it to try something out;
work on far-future dates and clean up after yourself.
