#!/usr/bin/env node
/**
 * The planner's code tasks, as MCP tools.
 *
 * WHAT THIS IS FOR
 *
 * Not dispatch. A task title — "fix the drag-drop bug" — is not a
 * specification, and handing one to an agent as if it were is how you get
 * plausible work that solves the wrong problem. What an agent is missing is
 * never the instruction; it is the CONTEXT around it, and a way to record what
 * it actually did.
 *
 * So the tools here run in one direction and back:
 *
 *   context in     code_tasks, task — the title AND its notes, its subtasks,
 *                  its project's description, and the working copy it lives in
 *   evidence out   start, log, finish — what is being worked on, what was
 *                  learned along the way, what was actually done
 *
 * The second half is the half nobody does by hand, and it is the reason this
 * is worth more than a curl to the same API.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * Creating, deleting, rescheduling, reorganising. This server can work a day's
 * code tasks and say what happened; it cannot administer the planner. The
 * narrow surface is the point — the same HTTP API is one shell command away,
 * so the value of a tool list is what it refuses as much as what it offers.
 *
 * `log` appends and never replaces, so nothing an agent writes can erase a
 * note you wrote.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const BASE = process.env.PLANNER_API || 'http://localhost:8787'

/** Local, not UTC: a planner's "today" is the one on the wall. */
const today = () => new Date().toLocaleDateString('en-CA')

async function call(path, init) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`${init?.method || 'GET'} ${path} — ${res.status} ${detail.slice(0, 200)}`)
  }
  return res.status === 204 ? null : res.json()
}

const get = (p) => call(p)
const patch = (p, body) => call(p, { method: 'PATCH', body: JSON.stringify(body) })

/** Where each project's working copy is, by project id. */
async function repos() {
  const list = await get('/projects').catch(() => [])
  return Object.fromEntries(
    (Array.isArray(list) ? list : list?.projects || [])
      .map((p) => [p.id, { repo: p.repo_path || null, description: p.description || '' }]),
  )
}

/** A task as an agent needs it: what it says, where it lives, what is under it. */
const shape = (t, byProject, children = []) => ({
  id: t.id,
  title: t.title,
  notes: t.notes || null,
  status: t.status,
  priority: t.priority,
  estimate_min: t.estimate_min ?? null,
  deep_work: t.intensity === 'deep',
  optional: !!t.optional,
  scheduled_date: t.scheduled_date,
  project: t.project_name || null,
  // The single most useful field here, and the one a title can never carry:
  // which working copy this is work IN.
  repo: byProject[t.project_id]?.repo || null,
  subtasks: children.map((c) => ({
    id: c.id, title: c.title, notes: c.notes || null, status: c.status,
  })),
})

const TOOLS = [
  {
    name: 'code_tasks',
    description:
      'The code tasks scheduled for a day, with everything needed to work them: '
      + 'notes, subtasks, project, and the repository each lives in. '
      + 'Defaults to today. Start here.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
        include_done: { type: 'boolean', description: 'Include finished ones. Default false.' },
      },
    },
  },
  {
    name: 'task',
    description:
      'One task in full, whether or not it is flagged as code work — its notes, '
      + 'its subtasks, its project description and repository.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number', description: 'The task id.' } },
      required: ['id'],
    },
  },
  {
    name: 'start',
    description:
      'Mark a task as being worked on right now, so the planner shows it in flight. '
      + 'Call this when you begin, not when you finish.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
  },
  {
    name: 'log',
    description:
      'Append a note to a task — what you found, what you tried, what is still open. '
      + 'Appends; it can never overwrite what is already written. '
      + 'Use it for anything the next session would want to know.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        text: { type: 'string', description: 'Markdown. Be specific: files, commits, failures.' },
      },
      required: ['id', 'text'],
    },
  },
  {
    name: 'finish',
    description:
      'Mark a task done, recording what was actually done as a note. '
      + 'The summary is required: a task closed with no evidence is indistinguishable '
      + 'from one nobody did.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        summary: { type: 'string', description: 'What was done, and how it was verified.' },
      },
      required: ['id', 'summary'],
    },
  },
]

/** A stamped block, appended under whatever is already there. */
function appended(existing, text) {
  const when = new Date().toLocaleString('en-CA', { hour12: false }).replace(',', '')
  const block = `_${when}_ — ${text.trim()}`
  return existing?.trim() ? `${existing.trimEnd()}\n\n${block}` : block
}

async function run(name, args = {}) {
  if (name === 'code_tasks') {
    const date = args.date || today()
    const [day, byProject] = await Promise.all([get(`/days/${date}`), repos()])
    const all = day.tasks || []
    const wanted = all.filter((t) => t.is_code
      && !t.archived
      && (args.include_done || !['done', 'dropped', 'moved'].includes(t.status)))
    const kids = (id) => all.filter((t) => t.parent_id === id)
    // Only top-level ones are listed; a subtask arrives under its parent, where
    // it means something, rather than twice.
    const top = wanted.filter((t) => t.parent_id == null || !wanted.some((w) => w.id === t.parent_id))
    return {
      date,
      count: top.length,
      tasks: top.map((t) => shape(t, byProject, kids(t.id))),
      note: top.length
        ? undefined
        : `Nothing on ${date} is flagged as a code task. Flag one in the planner `
          + '(the task\'s details panel, or :code in vim mode).',
    }
  }

  if (name === 'task') {
    const [t, byProject] = await Promise.all([get(`/tasks/${args.id}`), repos()])
    const kids = await get(`/tasks?parent_id=${args.id}`).catch(() => [])
    const out = shape(t, byProject, Array.isArray(kids) ? kids : [])
    out.project_description = byProject[t.project_id]?.description || null
    return out
  }

  if (name === 'start') {
    await patch(`/tasks/${args.id}`, { status: 'doing' })
    return { id: args.id, status: 'doing' }
  }

  if (name === 'log') {
    const t = await get(`/tasks/${args.id}`)
    await patch(`/tasks/${args.id}`, { notes: appended(t.notes, args.text) })
    return { id: args.id, logged: true }
  }

  if (name === 'finish') {
    const t = await get(`/tasks/${args.id}`)
    await patch(`/tasks/${args.id}`, {
      status: 'done',
      notes: appended(t.notes, args.summary),
    })
    return { id: args.id, status: 'done' }
  }

  throw new Error(`no such tool: ${name}`)
}

const server = new Server(
  { name: 'planner', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const out = await run(req.params.name, req.params.arguments || {})
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }
  } catch (e) {
    // Reported as a tool result rather than thrown, so the model sees what went
    // wrong and can say so, instead of the call vanishing into a protocol error.
    return {
      isError: true,
      content: [{ type: 'text', text: `${e.message}\n\nIs the planner running at ${BASE}?` }],
    }
  }
})

await server.connect(new StdioServerTransport())
