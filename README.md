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
node server/accounts.js add-owner <your-login>   # the first account
tailscale serve --bg 8789                        # NOT 8787 — see below
tailscale serve status
```

**8789, not 8787.** The app listens on two loopback ports and they are not the
same door. A request on **8787** with no session is treated as the owner, which
is what lets `bin/plan.js`, the MCP server and the tests work without a login.
A request on **8789** is whoever their cookie says they are, and nobody
without one. Serving the wrong port hands your planner to the whole tailnet.

It has to be the port rather than the address, because `tailscale serve` runs
on this same machine and forwards from `127.0.0.1` — so a visitor from the far
side of the tailnet looks exactly like a local tool if you ask who is calling.

## Accounts

Everyone gets their own login. New people ask from the login page, and the
owner approves them in **Settings → Account**.

```sh
node server/accounts.js add-owner <login>   # the first account; makes the owner
node server/accounts.js add <login>         # someone else, already approved
node server/accounts.js approve <login>
node server/accounts.js block <login>
node server/accounts.js passwd <login>
node server/accounts.js list
```

Sessions do not expire — signing in on a phone is meant to be something you do
once. A session ends when it is signed out, when the owner revokes that device
in Settings, or when the account is blocked. Passwords are scrypt-hashed and the
session cookie is stored only as its SHA-256, so a copy of `data/accounts.db`
lets nobody in.

That config persists across reboots by itself. To keep the app itself up:

```sh
bash scripts/install-service.sh      # writes the unit for THIS machine
systemctl --user enable --now planner
loginctl enable-linger "$USER"       # so it survives logging out
```

**The service and `npm run dev` want the same two ports.** Stop the service
before developing:

```sh
systemctl --user stop planner && npm run dev
```

`npm test` is fine either way — it drives whichever process holds 8787 — but it
swaps `web/dist` for a jsdom-runnable bundle while it runs, so anyone looking at
the served app during a test run sees the test build. It is put back afterwards.

## Running it on another machine

Nothing about this app is tied to the machine it was written on: it is a Node
process, a `data/` directory, and a `tailscale serve` line.

On the server:

```sh
sudo apt install -y nodejs npm build-essential python3   # better-sqlite3 is
                                                         # a native module and
                                                         # may compile
git clone <this repo> planner_v3 && cd planner_v3
npm ci
npm run build
```

Bring the data across — **with the service stopped on both ends**, so nothing is
mid-write. The `-wal` files are part of the database, not scratch:

```sh
# on the old machine
systemctl --user stop planner
rsync -a data/ user@planner:~/planner_v3/data/
```

Then, on the server:

```sh
sudo tailscale up --hostname=planner    # the URL follows the machine name
bash scripts/install-service.sh         # writes the unit for THIS machine
systemctl --user enable --now planner
loginctl enable-linger "$USER"
tailscale serve --bg 8789
```

and on the old machine, so two hosts are not both answering:

```sh
tailscale serve reset
systemctl --user disable --now planner
```

`data/accounts.db` travels with everything else, so every account, password and
signed-in phone comes across — nobody has to sign in again, as long as the URL
did not change. Which is the reason for the next paragraph.

### What changes for the command-line tools

`bin/plan.js` opens the SQLite file directly, so it only works where the file
is: on the server, over ssh. The copy left on your laptop is a snapshot from
the day you moved and will quietly drift.

The MCP server talks over HTTP, so it can stay where it is — but it now reaches
the planner across the tailnet, through the public port, which trusts nobody. It
needs a session of its own:

```sh
# on the server
node server/accounts.js token <login> mcp

# wherever the MCP server runs
PLANNER_API=https://planner.<tailnet>.ts.net PLANNER_TOKEN=<the token> …
```

That token is an ordinary session: it shows up in **Settings → Account** beside
that person's phones, says when it was last used, and is revoked with the same
button.

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
