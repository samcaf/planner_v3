# The planner, as MCP tools

Five tools that let a coding agent see the code work you have planned for a day,
and write back what it actually did.

## Adding it

```bash
claude mcp add planner -- node ~/Documents/planner_v3/mcp/server.js
```

Or, by hand, in `~/.claude.json` (or any MCP client's config):

```json
{
  "mcpServers": {
    "planner": {
      "command": "node",
      "args": ["/home/samaf/Documents/planner_v3/mcp/server.js"]
    }
  }
}
```

The API server must be running — the tools talk to `http://localhost:8787`, or
to `PLANNER_API` if you set it.

## The tools

| | |
|---|---|
| `code_tasks` | the day's code tasks, with notes, subtasks, project and repo |
| `task` | one task in full, code or not |
| `start` | mark it as being worked on now |
| `log` | append what you found — never overwrites |
| `finish` | close it, recording what was done |

## Flagging a task as code work

In the task's details panel there is a **Code task** checkbox; in vim mode,
`:code` toggles it. Give the project a **Repository** path on its own page and
every code task under it knows where to work.

## Why these five, and not more

The same HTTP API is one `curl` away, so a tool list earns its keep by what it
refuses. This one can work a day's code tasks and say what happened. It cannot
create, delete, reschedule or reorganise anything — an agent given the run of
your planner will eventually reorganise it.

`log` appends and never replaces, so nothing written here can erase a note you
wrote.

## The part that matters

The tools run in two directions:

- **context in** — a title like "fix the drag-drop bug" is not a specification.
  `code_tasks` carries the notes, the subtasks, the project's description and
  the working copy, because that is what is actually missing.
- **evidence out** — `start`, `log` and `finish` put back what happened. This is
  the half nobody does by hand, and it is the reason this beats pasting a list
  into a chat.

A task closed with no summary is indistinguishable from one nobody did, which
is why `finish` requires one.
