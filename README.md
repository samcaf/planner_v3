# Planner

A planner built around the day rather than the list. Tasks get scheduled onto
days, grouped into projects, and repeated by routines. Days hold loose notes
between the tasks, so the same page is both a plan and a notebook. Everything
you type accepts markdown, links and LaTeX.

It runs on your own machine and keeps everything in one SQLite file. There is no
account to make, nothing to sync, and no server involved until you decide to put
one in front of it.

This is a personal tool, published in case it is useful to someone else. It is
opinionated about how a day should work, and the fastest way to find out whether
you agree is to seed the demo data and click around for ten minutes.

## Quick start

Needs Node 18 or newer.

```sh
npm install
npm run seed     # optional: demo data to look at
npm run dev
```

Open <http://localhost:5173>.

`npm run dev` runs two processes: the API on 8787 and the Vite dev server on
5173, which proxies `/api` to it. To run the whole thing as one process:

```sh
npm run build
npm start
```

`better-sqlite3` is a native module. If npm cannot find a prebuilt binary for
your platform it will compile one, which needs a C toolchain (`build-essential`
and `python3` on Debian or Ubuntu).

## What is in it

### Views

**Today** is the day planner: a schedule, the day's tasks, deadlines falling
due, day notes, a backlog to pull from, and routines you can add with one click.
Tasks can be laid out as a flat list or as three columns per project, where a
task's column follows its duration until you drag it somewhere else.

**Week** gives seven columns. Drag a task between days to reschedule it, or onto
another task to make it a subtask.

**Month** is the month grid with milestones, meetings and tasks on it. Hover any
day for a `+`.

**Notes** shows day notes a day, a week or a month at a time. It is the same
note whichever calendar view you reach it from.

**All tasks** is every task in the system, scheduled or not, with filters,
grouping and drag reordering.

**Projects** carry progress, milestones with dates, tasks and notes. Milestone
due dates appear on the week and month views by themselves.

**People** is a directory with organisations, tags, notes and last-touch dates.
Meetings link attendees, so a person's page lists every meeting they were in.

**Routines** are reusable groups of tasks that become a section on a day. Pick
the weekdays each one repeats on, give the items default statuses, and hide a
routine's chores from All tasks if they are noise there.

### Tasks

Every task has a start and end time, a duration, a due date, a priority and a
project. The clock button on any row opens all of it.

Drag one task onto another to nest it, or use the subtask button. A subtask
follows its parent's day, and "move out of parent" in the row menu un-nests it.
Nesting works on the day, week and month views.

The three-column layout is renameable:

```sh
curl -X PATCH localhost:8787/api/settings -H 'Content-Type: application/json' \
  -d '{"column_labels":"[\"Quick\",\"Focused\",\"Deep\"]"}'
```

### Writing

Every note, task title and description takes the same syntax.

| You type | You get |
| --- | --- |
| `**bold**`, `*italic*`, `` `code` `` | formatting |
| `- item` on separate lines | a list |
| `[label](https://…)` | a link, opened in a new tab |
| a bare URL | an automatic link |
| `$e^{i\pi} = -1$` | inline maths |
| `$$ \int_0^\infty e^{-x^2}dx $$` | a display equation |
| paste or drag an image | an embedded image |
| `[[2026-08-10]]`, `[[project:Name]]`, `[[task:12]]` | a link to that day, project or task |
| `[[link:docs]]` | a URL you have nicknamed |

Type `[[` anywhere and a menu offers days, projects, tasks, notebook entries and
nicknamed URLs.

Maths renders with KaTeX, and is pulled out of the text before markdown runs, so
`a_1` and `\\` inside an expression survive instead of being read as emphasis
and line breaks. Notes render when you click away and go back to plain markdown
when you click into them. <kbd>Enter</kbd> makes a newline;
<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> saves; <kbd>Esc</kbd> cancels.

Images are stored under `data/uploads/` and referenced as `![alt](/uploads/…)`.
They are content-addressed, so pasting the same image twice costs one file.

### Nicknames

A word for somewhere you keep going back to, stored server-side so it follows
you between browsers.

| | |
| --- | --- |
| `:namepage thesis` | names the page you are on |
| `:nameurl docs https://…` | names a URL. **Settings → Link names** does the same |
| `:goto thesis` | goes there. A nicknamed URL opens in a new tab |
| `:unname thesis` | forgets it |

Write a nicknamed URL into any note as `[[link:docs]]`. The note holds the name
rather than the address, so re-pointing the nickname re-points every link
already written to it.

### Keyboard control

<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd> turns on a vim-style mode that
covers most of the app. `hjkl` moves between tasks and across the day's columns,
<kbd>Tab</kbd> steps into the side column where the backlog and routines live,
`o` makes a task, `i` edits one, <kbd>Enter</kbd> ticks it off, `yy` and `p`
copy and paste tasks, `>` and `<` grade priority, and `:` opens a command line
with `:mv tomorrow`, `:day 14`, `:pri high`, `:t 90` and the rest.

Press `?` for the full sheet, which has a search of its own. `/` filters the
list of keys and `j`/`k` scroll it.

With the mode off, everywhere you can go is under `g`: `gt` for today, `gd` `gw`
`gm` `gn` for the dated views, `ga` `gp` `ge` for all-tasks, projects and
people. Those mean the same thing whether the mode is on or off, so a key never
changes meaning because of a mode you cannot see.

**Settings → Keyboard** lists every key and mouse gesture. It is generated from
the same tables the keys are bound in, so it cannot drift.

### The AI suite

Tasks double as a protocol for talking to an agent. An AI conversation is a
section on a day, every turn in it is a task, and the section lays them out in
columns by whose move it is. You write a brief; an agent claims it, works it,
and writes back an answer with follow-ups.

How a task gets worked is a set of switches rather than a paragraph: which mode
it runs in, how deep it may nest its own steps, how many tasks one run may
create, what it has to show before claiming something is finished. The planner
enforces some of them itself, so a run that has spent its budget is refused by
the server whatever the agent intended.

[`mcp/README.md`](mcp/README.md) documents the tool server, which is shaped
after Jira's: one search tool over a query language, metadata tools that say
what is legal before you act, and transitions rather than status assignment.

```sh
claude mcp add planner -- node /path/to/planner_v3/mcp/server.js
```

**Settings → AI suite** explains all of it inside the app, generated from the
switch definitions themselves.

### From the terminal

`bin/plan.js` reads and writes the same database directly, with no server
running.

```sh
node bin/plan.js                    # today
node bin/plan.js week
node bin/plan.js add "Derive the bound" -p Research -e 90 -!
node bin/plan.js done 3
node bin/plan.js mv 7 tomorrow
node bin/plan.js note               # day notes in $EDITOR
node bin/plan.js apply "Monday planning" tomorrow
node bin/plan.js help
```

Dates take `2026-08-20`, `today`, `tomorrow`, `yesterday`, or `+3` / `-1`. For a
bare `plan` command:

```sh
ln -s "$PWD/bin/plan.js" ~/.local/bin/plan
```

### Appearance

Light, Night and Auto themes, set at the foot of the sidebar. Auto follows your
operating system. Seven accent colours, three of which move the neutral tones as
well and change the feel of the whole page. Both settings persist.

## Running it for real

Everything above works on one machine with no accounts. The rest of this section
is about reaching it from your phone or from another computer.

### Accounts

Everyone who signs in gets their own login. New people ask from the login page,
and the owner approves them in **Settings → Account**.

```sh
node server/accounts.js add-owner <login>   # the first account, and the owner
node server/accounts.js add <login>         # someone else, already approved
node server/accounts.js approve <login>
node server/accounts.js block <login>
node server/accounts.js passwd <login>
node server/accounts.js list
```

Sessions do not expire, because signing in on a phone should be something you do
once. A session ends when it is signed out, when the owner revokes that device
in Settings, or when the account is blocked. Passwords are scrypt-hashed, and
the session cookie is stored only as its SHA-256, so a copy of
`data/accounts.db` lets nobody in.

### Two ports, and only one of them is trusted

The app listens twice, on loopback both times.

| | |
| --- | --- |
| **8787** | a request with no session is the owner. This is what the CLI, the MCP server and the tests talk to |
| **8789** | a request is whoever their cookie says, and nobody without one |

Publish **8789**. Publishing 8787 hands the planner to anyone who can reach it.

It has to be the port rather than the client's address, because a reverse proxy
running on the same machine forwards from `127.0.0.1`. Asking who is calling
cannot separate a visitor on the far side of the network from a local tool.

### On a Tailscale network

`tailscale serve` publishes the app to your tailnet and terminates HTTPS with a
real certificate, which is also what a phone wants before it will install the
app to its home screen.

```sh
npm run build
node server/accounts.js add-owner <login>
tailscale serve --bg 8789
tailscale serve status
```

That config survives reboots on its own. To keep the app itself up:

```sh
bash scripts/install-service.sh      # writes a systemd user unit for this machine
systemctl --user enable --now planner
loginctl enable-linger "$USER"       # so it survives logging out
```

The service and `npm run dev` want the same two ports, so stop one before
starting the other: `systemctl --user stop planner && npm run dev`.

**Choose the machine name before installing it on a phone.** An installed web
app is pinned to the address it was installed from, and that address follows the
machine name in MagicDNS. If you name the host `planner` now, a later move is
just copying `data/`, installing the unit there, and renaming that machine.

### Moving it to another machine

The app is a Node process, a `data/` directory, and one `tailscale serve` line.

```sh
# on the new machine
git clone https://github.com/samcaf/planner_v3 && cd planner_v3
npm ci && npm run build

# on the old one, stopped, so nothing is mid-write.
# the -wal files are part of the database, not scratch
systemctl --user stop planner
rsync -a data/ user@newhost:~/planner_v3/data/

# on the new machine
sudo tailscale up --hostname=planner
bash scripts/install-service.sh
systemctl --user enable --now planner && loginctl enable-linger "$USER"
tailscale serve --bg 8789

# and on the old one, so two hosts are not both answering
tailscale serve reset && systemctl --user disable --now planner
```

`data/accounts.db` travels with the rest, so every account, password and
signed-in phone comes across. Nobody signs in again as long as the address did
not change.

Two things change for the command-line tools. `bin/plan.js` opens the SQLite
file directly, so it only works where the file is. The MCP server talks over
HTTP and can stay put, but it now arrives through the public port and needs a
session of its own:

```sh
node server/accounts.js token <login> mcp        # on the server
PLANNER_API=https://planner.example.ts.net PLANNER_TOKEN=… node mcp/server.js
```

That token is an ordinary session. It appears in **Settings → Account** beside
that person's phones, says when it was last used, and is revoked with the same
button.

## Your data

One SQLite file at `data/planner.db`, plus `data/accounts.db` once anyone signs
in and `data/uploads/` for images. Copy the directory to back it up. Delete it
to start over; it is rebuilt on the next run.

```sh
npm run seed -- --reset   # wipe and reload demo data
sqlite3 data/planner.db   # poke at it directly
```

Nothing leaves the machine. The app makes no outbound requests.

## Working on it

```
server/
  schema.sql        most of the data model, 12 tables
  db.js             opens SQLite, applies the schema and the additive migrations
  index.js          the express app
  routes/           one file per entity
  accounts.js       logins and sessions, and the CLI that manages them
web/src/
  pages/            Day, Week, Month, Notes, AllTasks, Projects, People, Routines
  components/       TaskRow, VimLayer, Icon, shared UI
  lib/rich.jsx      markdown, LaTeX and the editors
  lib/vim.jsx       the keyboard cursor, found in the DOM rather than held by a page
bin/plan.js         the terminal interface
mcp/server.js       the MCP tool server
```

```sh
npm test
```

Fifty end-to-end suites that drive the real built app in jsdom against the real
server, because the bugs worth catching are interaction bugs that a green build
and a passing curl both miss. They need `npm run dev` up. Probe rows are created
on far-future dates and deleted afterwards, so your own data is left alone.

[`CLAUDE.md`](CLAUDE.md) has the house rules, including the few places where two
files have to change together and nothing checks that they did.
[`DESIGN.md`](DESIGN.md) covers the visual design: which tokens are levers and
which parts will fight a redesign.

Eight runtime dependencies: express, better-sqlite3, react, react-dom,
react-router-dom, marked, dompurify and katex.
