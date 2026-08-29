# The planner, as MCP tools

Shaped after [Atlassian's Jira MCP server](https://support.atlassian.com/rovo/docs/getting-started-with-the-atlassian-remote-mcp-server/):
one search tool over a query language, metadata tools that say what is legal
before you act, transitions rather than status assignment, comments and
worklogs separate from the body, and read/write/search scopes.

## Adding it

```bash
claude mcp add planner -- node ~/Documents/planner_v3/mcp/server.js
```

The API must be running; the tools talk to `http://localhost:8787`.

| variable | |
|---|---|
| `PLANNER_API` | where the API is (default `http://localhost:8787`) |
| `PLANNER_WEB` | what to build task URLs from (default `http://localhost:5173`) |
| `PLANNER_MCP_SCOPES` | `read,write,search` — drop `write` for a server that cannot change anything |
| `PLANNER_MCP_AUTHOR` | who comments are attributed to (default `claude`) |

## The tools

**read** — `get_task`, `get_transitions`, `get_projects`, `get_comments`, `describe`
**search** — `search_tasks`
**write** — `create_task`, `update_task`, `transition_task`, `add_comment`, `add_worklog`

A tool outside the granted scopes is not merely missing from the list; calling
it by name says which scope it needed.

## The query language

Terms separated by spaces, ANDed together. Bare words match the title or the
notes. **With no `status:` or `is:` term, only open tasks come back.**

```
is:code date:today order:priority
project:"Planner v3" priority:high has:notes
drag date:2026-08-01..2026-08-31 limit:10
is:done date:week
```

| | |
|---|---|
| `is:` / `not:` | `code` `deep` `light` `optional` `committed` `open` `done` `closed` `archived` |
| `status:` | `todo` `doing` `done` `moved` `dropped` — comma for OR |
| `priority:` | `lowest` `low` `medium` `high` `highest` |
| `date:` `due:` | `today` `tomorrow` `yesterday` `week` `overdue` `none` `YYYY-MM-DD` `A..B` |
| `project:` `section:` | by name, quoted if it has spaces |
| `has:` | `notes` `comments` |
| `order:` | `date` `-date` `created` `-created` `due` `priority` `estimate` |
| `limit:` `offset:` | paging — the result says `has_more` and `next_offset` |

A wrong term is an error that names the valid ones, rather than an empty
result. `describe` returns the same grammar, so a client can read it once
instead of being told.

## Why it is shaped this way

**One search tool, not a tool per question.** A tool per question can only
answer the questions someone thought of.

**Metadata before action.** `describe` and `get_transitions` exist so the model
asks what is legal instead of guessing an enum and learning from a 400.

**Transitions, not status assignment.** A transition is a named move with its
own required arguments. Sending a task to another day needs a date, and setting
`status='moved'` without one leaves a task that has gone nowhere — a bug this
project has actually shipped. An enumerated transition cannot express it.

**Comments are not the notes.** A task's notes are your prose. What an agent did
is a comment. Merged, you cannot tell a week later which sentences you wrote —
which is exactly why Jira keeps description and comments apart. `update_task`
can replace notes if you ask it to; `add_comment` never can.

**Worklogs are real time.** `add_worklog` adds to the task's own timer, so the
day's totals see it, and leaves a comment saying where the time went.

What is deliberately **not** copied: OAuth, multi-tenancy, cloud ids. This talks
to one planner over loopback, and an identity layer for a single-user app on
localhost would be ceremony, not security. Keep it on localhost — there is no
authentication because nothing needs to cross a network.

## Flagging code work

A **Code task** checkbox in the task's details, or `:code` in vim mode. Give a
project a **Repository** path on its own page and every code task under it
reports where to work.
