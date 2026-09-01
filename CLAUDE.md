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

The API binds **loopback only**, and both spellings of it — `127.0.0.1` and
`::1`. `localhost` resolves to `::1` first here and Node's resolver order is
`verbatim`, so binding one address refuses every client that says `localhost`,
which is the Vite proxy, the MCP server and all but one of the test suites.
Publishing it to the tailnet is `tailscale serve`'s job, not the app's — see
the README.

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

### A new kind of `[[…]]` link

`[[day:…]]`, `[[project:…]]`, `[[task:…]]`, `[[note:…]]` and `[[link:…]]` are one
syntax spread over six files, and nothing fails loudly when one is missed —
the link just renders as prose, or reads as `link:repo` in a place with no
room to draw it. Adding a kind means all of:

| file | what |
|---|---|
| `web/src/lib/rich.jsx` | `wikiLink` — the prefix alternation and the `/go/` href |
| `web/src/lib/rich.jsx` | `suggestFor` — what the `[[` picker offers |
| `web/src/lib/rich.jsx` | `plainTitle` — the prefix list, or it shows in plain text |
| `web/src/lib/vim.jsx` | `asPlain` — the same list again, for what `yy` copies |
| `web/src/components/Resolver.jsx` | the lookup that turns it into an address |
| `web/src/styles/notes.css` | `.nt-wiki-<kind>::before` — its glyph |

Whether a link opens in a new tab is decided in ONE place: the
`afterSanitizeAttributes` hook in `rich.jsx`, from the href. DOMPurify strips a
`target` it did not add itself, so writing one into the anchor does not work.

## The keyboard, in one paragraph

The cursor is found in the DOM, not held by a page: anything drawing
`.task[data-task-id]`, `.panel.section[data-section-id]`, `[data-open]` (a card)
or `[data-act]` (a row whose point is its button) is a stop, and navigation
works there without the page knowing the mode exists. `lib/vim.jsx` owns
`STOPS` — read it, never write the selector out again. Actions go through the
page's own handlers, lent by `useVimActions`, so every keystroke is undoable
exactly like the click it replaces.

If `planner.service` is running it holds 8787 and 8789, and `npm run dev`
cannot start its API — `systemctl --user stop planner` first. `npm test` works
against whichever process holds the port.

## The phone

**Never write a layout value as an inline style.** An inline `width` or
`grid-template-columns` outranks every rule in the stylesheet, so a media query
cannot overrule it — which is how the responsive work already in this project
came to do nothing at all on a phone for months. A dragged width goes in as a
custom property (`--rail-w`, `--aside-w`) and CSS decides whether to use it.

**HTML5 drag-and-drop never fires on touch.** Anything reachable only by
dragging is unreachable on a phone, so reordering and nesting also live in the
row menu, calling the same handlers the keyboard does. A new drag gesture needs
a menu entry beside it.

`@media (hover: none)` asks the input device rather than the width, which is the
honest question for a control that only appears on hover: a narrow window on a
laptop still has a mouse.

The service worker is `web/public/sw.js`, hand-written and registered from
`main.jsx` in production only. `/api` is never served from its cache — a stale
answer there would have you ticking off a task that no longer exists.

## Two ports, and only one of them is trusted

`server/ports.js`. The app listens twice on loopback: `TRUSTED_PORT` (8787) is
what the CLI, the MCP server and the test suites talk to, and a request there
with no session is the owner. `PUBLIC_PORT` (8789) is what `tailscale serve` is
pointed at, and a request there is whoever its cookie says it is.

**Do not replace that with a check on the peer address.** `tailscale serve`
proxies from tailscaled on this same machine, so a visitor from the far side of
the tailnet arrives with `remoteAddress` 127.0.0.1 exactly like a local tool
does. The port a connection arrived on is the only thing here a client cannot
choose.

The dev proxy in `vite.config.js` points at the PUBLIC port on purpose, so that
developing exercises the login rather than walking past it.

## A planner per person

One SQLite file each. The owner keeps `data/planner.db`; everyone else gets
`data/users/<slug>.db`. `server/db.js` exports `db` as a **Proxy** that resolves
the current request's connection out of an `AsyncLocalStorage`, so all 234
`db.prepare(...)` sites and every line of their SQL are untouched — which is
only possible because none of them is hoisted to module scope.

Isolation is structural. There is no `WHERE user_id = ?` to forget, because the
other person's rows are in a file this connection never opened. Two people can
both own task id 1.

**Never hoist `db.transaction(...)` above a request.** It captures the
connection when it is CREATED, while the statements inside re-resolve when it is
CALLED — so a transaction built under one person and run under another executes
outside any transaction at all. Every route-layer site builds and calls in one
expression (`db.transaction(() => …)()`). Nothing checks that they still do.

Two more things that follow from the layout:

- **A new column has to reach every file.** `bootstrap()` runs the schema and the
  additive migrations on connection open, so a planner belonging to someone who
  has not signed in since the change gets it when they next do. That is why the
  migrations live in `openDb` and not at import.
- **One query runs at import**, before any request exists:
  `routes/people.js:23` does `PRAGMA table_info` in a top-level loop. The
  fallback connection is opened lazily for exactly this.

Attachments are on disk rather than in the database, so they need the same
split: `uploadDir(slug)` in `routes/uploads.js`, and the owner keeps
`data/uploads`.

## Data

`data/planner.db` is the user's real data — the dev server runs against it. Do
not seed, reset or migrate it to try something out; work on far-future dates and
clean up after yourself. A probe *person* is cheaper than probe rows: their whole
planner is one file you can delete, which is what `test/batch70.mjs` does.
