# Planner

A calendar-first planner: **projects**, tasks scheduled onto days, meetings tied
to a **people directory**, and reusable **routines**.

Days are notebooks too: loose notes interleave with tasks.

Notes, task titles and descriptions all accept markdown, links and LaTeX.

## Run it

```sh
npm install
npm run seed     # optional: demo data to look at
npm run dev
```

Then open <http://localhost:5173>.

`npm run dev` starts two processes: the API on **8787** and the Vite dev server
on **5173**, which proxies `/api` to the former.

To run it as a single process (e.g. on a server):

```sh
npm run build
npm start        # serves the built app and the API together on 8787
```

## On your tailnet

The API listens on **loopback only** — `127.0.0.1` and `::1`, both, because
`localhost` resolves to the second one first on a modern Linux. Nothing reaches
it from another machine on its own; `tailscale serve` is what publishes it, and
it is also what supplies HTTPS, which a phone needs before it will install this
as an app.

```sh
npm run build
tailscale serve --bg 8787      # https://<this-machine>.<tailnet>.ts.net
tailscale serve status
```

That config persists across reboots by itself. To keep the app itself up:

```sh
cp scripts/planner.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now planner
loginctl enable-linger "$USER"   # so it survives logging out
```

**Pick the machine name before installing it on a phone.** An installed web app
is pinned to the address it was installed from, and that address follows the
*machine* name in MagicDNS. Naming the host `planner` now means moving the app
to another box later is: copy `data/`, install the unit there, rename that
machine `planner` — and every phone keeps working.

## Where things live

```
server/
  schema.sql        the whole data model, ~150 lines
  db.js             opens SQLite, applies the schema
  index.js          express app
  routes/           one file per entity
  seed.js           demo data
web/src/
  pages/            Day, Week, Month, Notes, AllTasks, Projects, People, Routines
  components/       TaskRow, Icon, shared UI
  lib/rich.jsx      markdown + LaTeX rendering and editors
  lib/dates.js      local-time date handling
bin/plan.js         terminal interface to the same database
data/planner.db     your data (SQLite, gitignored)
```

## Views

- **Today** — the day planner. Schedule, tasks, deadlines falling due, day
  notes, a backlog you can pull from, and one-click routines. Toggle
  between a flat list and **three-column boxes** with the buttons in the header.
- **Week** — seven columns. Drag a task between days to reschedule it, or onto
  another task to make it a subtask. Add tasks inline on any day.
- **Month** — the month grid, with milestones, meetings and tasks. Drag to move,
  drop onto a task to nest, and hover any day for a `+` to add a task there.
- **Notes** — day-by-day notes, viewable a day, a week or a month at a time.
  It is the same underlying note whichever calendar view you reach it from.
- **All tasks** — every task in the system, scheduled or not, with filters,
  grouping and drag reordering.
- **Projects** — progress, milestones with dates, tasks, and project notes.
  Milestone due dates show up automatically on the week and month views.
- **People** — directory with orgs, tags, notes and last-touch. Meetings link
  attendees, so a person's page shows every meeting they were in.
- **Routines** — a reusable group of tasks that becomes a *section* on a day.
  Pick which weekdays it repeats on (none selected = every day), give each item
  a default status, and hide a routine's chores from All tasks.
- **Images** — browse and delete everything uploaded into notes.

## Tasks

Each task carries a start and end time, a duration, a due date, a priority and a
project. Open the clock button on any row to set them.

**Subtasks:** drag one task onto another to nest it, or use the subtask button on
a row. A subtask follows its parent's day. "Move out of parent" in the row menu
un-nests it. Nesting is available from the day, week and month views.

**Three-column boxes:** the Day view can group each project's tasks into three
columns. A task's column follows its duration unless you drag it somewhere else.
Rename the columns by editing the `column_labels` setting:

```sh
curl -X PATCH localhost:8787/api/settings -H 'Content-Type: application/json' \
  -d '{"column_labels":"[\"Quick\",\"Focused\",\"Deep\"]"}'
```

## Appearance

Light, **Night** and Auto themes, set at the bottom of the sidebar; Auto follows
your OS. Four accent colours. Both persist across sessions.

## Writing: markdown, links and maths

Every notes field and task title accepts:

| You type | You get |
| --- | --- |
| `**bold**`, `*italic*`, `` `code` `` | formatting |
| `- item` on separate lines | a list |
| `[label](https://…)` | a link (opens in a new tab) |
| a bare URL | an automatic link |
| `$e^{i\pi} = -1$` | inline maths |
| `$$ \int_0^\infty e^{-x^2}dx $$` | a display equation |
| paste or drag an image, or hit **Add image** | an embedded image |
| `[[2026-08-10]]`, `[[project:Name]]`, `[[task:12]]` | a link to that day, project or task |
| `[[link:docs]]` | a URL you have nicknamed — opens in a new tab |

### Nicknames

A word for somewhere you keep going back to, kept in settings so it follows you
between browsers. Two kinds, one namespace:

| | |
| --- | --- |
| `:namepage thesis` | names the page you are on |
| `:nameurl docs https://…` | names a URL — **Settings → Link names** does the same |
| `:goto thesis` | goes there; a URL opens in a new tab |
| `:unname thesis` | forgets it |

A named URL can be written into any note or task title as `[[link:docs]]`, or
picked from the `[[` menu. The note holds the *name*, so re-pointing the
nickname re-points every link already written to it.

Images are stored under `data/uploads/` and referenced from the markdown as
`![alt](/uploads/…)`. They are content-addressed, so pasting the same image
twice costs one file.

Maths is rendered with KaTeX. Notes render when you click away and return to
plain markdown when you click back in. In a notes box, <kbd>Enter</kbd> makes a
newline and <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> saves;
<kbd>Esc</kbd> cancels.

Maths is extracted before the markdown is parsed, so `a_1` and `\\` inside an
expression survive intact instead of being read as emphasis and line breaks.

## Terminal use

`bin/plan.js` reads and writes the same database directly — no server needed.

```sh
node bin/plan.js              # today
node bin/plan.js week
node bin/plan.js add "Derive the bound" -p Research -e 90 -!
node bin/plan.js done 3
node bin/plan.js mv 7 tomorrow
node bin/plan.js note         # day notes in $EDITOR
node bin/plan.js edit 3       # task title + notes in $EDITOR
node bin/plan.js apply "Monday planning" tomorrow
node bin/plan.js help
```

Dates accept `2026-08-20`, `today`, `tomorrow`, `yesterday`, or `+3` / `-1`.

For a bare `plan` command, link it onto your `PATH`:

```sh
ln -s "$PWD/bin/plan.js" ~/.local/bin/plan
```

## Data

Everything is one SQLite file at `data/planner.db`. Copy it to back up, delete
it to start over — it is recreated on the next run.

```sh
npm run seed -- --reset   # wipe and reload demo data
sqlite3 data/planner.db   # poke at it directly
```

### Importing the old text planner

`server/import-pln.js` reads the retired `~/Documents/planner` text files and
loads their tasks into these days. It treats that directory as read-only.

```sh
node server/import-pln.js --dry-run   # report, write nothing
node server/import-pln.js             # import
```

It is safe to re-run: imported rows are tagged `source = 'pln'` and a second run
replaces only those, leaving anything you typed yourself untouched. Set
`PLN_SOURCE` to import from somewhere else.
