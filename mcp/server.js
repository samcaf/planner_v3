#!/usr/bin/env node
/**
 * The planner as a tracker, in the shape of Atlassian's Jira MCP server.
 *
 * That shape, and why each part of it earns its place here:
 *
 *   ONE SEARCH TOOL, NOT A TOOL PER QUESTION
 *     Jira's server has a dozen read tools and exactly one search tool, built
 *     on JQL. That is what makes it general: a tool per question can only
 *     answer the questions someone thought of. `search_tasks` takes a written
 *     query — see query.js for the grammar.
 *
 *   METADATA BEFORE ACTION
 *     `describe` and `get_transitions` exist so the model can ask what is legal
 *     instead of guessing an enum and finding out from a 400.
 *
 *   TRANSITIONS, NOT STATUS ASSIGNMENT
 *     A transition is a named move with its own required arguments. Moving a
 *     task to another day needs a date, and setting status='moved' without one
 *     leaves a task that has gone nowhere — a bug this project has actually
 *     shipped. An enumerated transition cannot express it.
 *
 *   COMMENTS AND WORKLOGS, SEPARATE FROM THE BODY
 *     A task's notes are the user's own prose. What an agent did is a comment.
 *     Merging them means that after a week you cannot tell which sentences you
 *     wrote, which is why Jira keeps description and comments apart.
 *
 *   SCOPES
 *     Jira's tools are grouped read / write / search and granted separately.
 *     PLANNER_MCP_SCOPES does the same: set it to "read,search" and the server
 *     advertises no tool that can change anything.
 *
 * What is deliberately NOT copied: OAuth, multi-tenancy, cloud ids. This talks
 * to one planner on localhost, and inventing an identity layer for a
 * single-user app on a loopback socket would be ceremony, not security.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { parse, today } from './query.js'

const BASE = process.env.PLANNER_API || 'http://localhost:8787'
const WEB = process.env.PLANNER_WEB || 'http://localhost:5173'
const AUTHOR = process.env.PLANNER_MCP_AUTHOR || 'claude'

/** read, write, search — the same three Jira grants, same names. */
const SCOPES = new Set(
  (process.env.PLANNER_MCP_SCOPES || 'read,write,search')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
)

async function call(path, init) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  })
  if (!res.ok) {
    let detail = await res.text().catch(() => '')
    try { detail = JSON.parse(detail).error ?? detail } catch { /* plain text */ }
    throw new Error(`${init?.method || 'GET'} ${path} → ${res.status}: ${String(detail).slice(0, 300)}`)
  }
  return res.status === 204 ? null : res.json()
}

const get = (p) => call(p)
const post = (p, body) => call(p, { method: 'POST', body: JSON.stringify(body ?? {}) })
const patch = (p, body) => call(p, { method: 'PATCH', body: JSON.stringify(body) })

const qs = (params) => new URLSearchParams(
  Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]),
).toString()

// ── shaping ────────────────────────────────────────────────────────────────

/** Where to look at this in the app. Jira returns a browse URL; so does this. */
const urlFor = (t) => (t.scheduled_date ? `${WEB}/day/${t.scheduled_date}` : `${WEB}/backlog`)

const projectsById = async () => Object.fromEntries(
  (await get('/projects')).map((p) => [p.id, p]),
)

function shape(t, byProject = {}, extra = {}) {
  const project = byProject[t.project_id]
  return {
    id: t.id,
    title: t.title,
    notes: t.notes || null,
    status: t.status,
    priority: t.priority,
    estimate_min: t.estimate_min ?? null,
    logged_min: t.timer_elapsed_ms ? Math.round(t.timer_elapsed_ms / 60_000) : 0,
    deep_work: t.intensity === 'deep',
    optional: !!t.optional,
    is_code: !!t.is_code,
    scheduled_date: t.scheduled_date,
    due_date: t.due_date || null,
    parent_id: t.parent_id ?? null,
    project: project ? { id: project.id, name: project.name, repo: project.repo_path || null } : null,
    url: urlFor(t),
    ...extra,
  }
}

/**
 * What can be done to a task from where it is now.
 *
 * Named moves rather than a status field, each with the arguments it cannot do
 * without. `move` is the reason this matters: it needs somewhere to go.
 */
function transitionsFor(task) {
  const all = [
    { name: 'start', to: 'doing', description: 'Begin work — shows as in flight' },
    { name: 'complete', to: 'done', description: 'Finished' },
    { name: 'reopen', to: 'todo', description: 'Back to not started' },
    { name: 'drop', to: 'dropped', description: 'Decided against; kept as a record' },
    {
      name: 'move',
      to: 'moved',
      description: 'Send to another day. The task itself travels; a marker stays behind.',
      args: { date: 'YYYY-MM-DD, or "tomorrow"' },
      required: ['date'],
    },
    { name: 'backlog', to: null, description: 'Unschedule it — off the calendar, still on the list' },
  ]
  return all.filter((tr) => tr.to !== task.status)
}

// ── tools ──────────────────────────────────────────────────────────────────

const READ = [
  {
    name: 'get_task',
    description: 'One task in full, with its subtasks, comments, project and repository.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
  },
  {
    name: 'get_transitions',
    description:
      'What can legally be done to a task from its current status, and what each move requires. '
      + 'Call this before transition_task rather than guessing a status.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
  },
  {
    name: 'get_projects',
    description: 'Every project, with its status and the repository its code lives in.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_comments',
    description: 'The comments and worklog entries on a task, oldest first.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
  },
  {
    name: 'describe',
    description:
      'What this planner allows: the query grammar, the valid statuses and priorities, '
      + 'the sections of a day, and the fields update_task will accept. '
      + 'Read this once before composing a query or a write.',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'Include this day\'s sections.' } },
    },
  },
]

const SEARCH = [
  {
    name: 'search_tasks',
    description:
      'Search tasks with a query. Terms are ANDed; bare words match title or notes.\n'
      + '  is:code|deep|light|optional|committed|open|done|closed|archived   not:code|optional\n'
      + '  status:todo,doing   priority:high   project:"Name"   section:"Name"   parent:12\n'
      + '  date:today|tomorrow|yesterday|week|overdue|none|YYYY-MM-DD|A..B   due:<same>\n'
      + '  has:notes   has:comments   order:date|-date|created|-created|due|priority|estimate\n'
      + '  limit:N   offset:N\n'
      + 'Example: is:code date:today order:priority. '
      + 'With no status term, only open tasks are returned.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The query. Empty means every open task.' },
        limit: { type: 'number', description: 'Max rows, 1–200. Default 50.' },
        offset: { type: 'number', description: 'Rows to skip, for paging.' },
      },
    },
  },
]

const WRITE = [
  {
    name: 'create_task',
    description: 'Add a task. Give it a date to put it on a day, or leave it out for the backlog.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        notes: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD. Omit for the backlog.' },
        project: { type: 'string', description: 'Project name.' },
        priority: { type: 'string', enum: ['lowest', 'low', 'medium', 'high', 'highest'] },
        estimate_min: { type: 'number' },
        is_code: { type: 'boolean' },
        deep_work: { type: 'boolean' },
        parent_id: { type: 'number', description: 'Make it a subtask of this task.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description:
      'Change a task\'s fields. Not its status — use transition_task, which knows what each '
      + 'move requires.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        title: { type: 'string' },
        notes: { type: 'string', description: 'REPLACES the notes. To add without erasing, add_comment.' },
        priority: { type: 'string', enum: ['lowest', 'low', 'medium', 'high', 'highest'] },
        estimate_min: { type: 'number' },
        due_date: { type: 'string' },
        is_code: { type: 'boolean' },
        deep_work: { type: 'boolean' },
        optional: { type: 'boolean' },
        project: { type: 'string', description: 'Project name, or "" to detach.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'transition_task',
    description:
      'Move a task through its lifecycle by name: start, complete, reopen, drop, move, backlog. '
      + 'Ask get_transitions what is available and what each one needs.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        transition: { type: 'string', description: 'start | complete | reopen | drop | move | backlog' },
        date: { type: 'string', description: 'Required by "move": YYYY-MM-DD or "tomorrow".' },
        comment: { type: 'string', description: 'Recorded against the task as a comment.' },
      },
      required: ['id', 'transition'],
    },
  },
  {
    name: 'add_comment',
    description:
      'Comment on a task — what you found, what you changed, what is still open. '
      + 'Separate from the notes, which are the user\'s own, and never overwrites them.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        body: { type: 'string', description: 'Markdown. Be specific: files, commits, failures.' },
      },
      required: ['id', 'body'],
    },
  },
  {
    name: 'add_worklog',
    description:
      'Record time spent on a task. Adds to its timer, so the day\'s totals see it, '
      + 'and leaves a worklog comment saying where the time went.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number' },
        minutes: { type: 'number' },
        comment: { type: 'string' },
      },
      required: ['id', 'minutes'],
    },
  },
]

const GROUPS = { read: READ, search: SEARCH, write: WRITE }
const TOOLS = Object.entries(GROUPS)
  .filter(([scope]) => SCOPES.has(scope))
  .flatMap(([, list]) => list)

// ── running them ───────────────────────────────────────────────────────────

/** Names to ids, with an error that says what does exist. */
async function projectNamed(name) {
  const list = await get('/projects')
  const want = String(name).trim().toLowerCase()
  const hit = list.find((p) => p.name.toLowerCase() === want)
    || list.find((p) => p.name.toLowerCase().startsWith(want))
  if (!hit) {
    throw new Error(`no project called "${name}". There is: ${list.map((p) => p.name).join(', ')}`)
  }
  return hit
}

async function sectionNamed(name, date) {
  const day = await get(`/days/${date || today()}`)
  const want = String(name).trim().toLowerCase()
  const hit = (day.sections || []).find((s) => s.name.toLowerCase() === want)
    || (day.sections || []).find((s) => s.name.toLowerCase().startsWith(want))
  if (!hit) {
    throw new Error(`no section called "${name}" on ${date || today()}. `
      + `There is: ${(day.sections || []).map((s) => s.name).join(', ') || 'none'}`)
  }
  return hit
}

const dateWord = (v) => {
  if (!v) return null
  const w = String(v).trim().toLowerCase()
  if (w === 'today') return today()
  if (w === 'tomorrow' || w === 'yesterday') {
    const d = new Date(`${today()}T12:00:00`)
    d.setDate(d.getDate() + (w === 'tomorrow' ? 1 : -1))
    return d.toLocaleDateString('en-CA')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w)) throw new Error(`"${v}" is not a date (YYYY-MM-DD or tomorrow)`)
  return w
}

const comment = (id, body, extra = {}) => post(`/tasks/${id}/comments`, { author: AUTHOR, body, ...extra })

async function run(name, args = {}) {
  // A tool outside the granted scopes is not merely absent from the list; it
  // refuses by name, so a model working from a stale list is told why.
  if (!TOOLS.some((t) => t.name === name)) {
    if (Object.values(GROUPS).flat().some((t) => t.name === name)) {
      throw new Error(`${name} needs a scope this server was not given `
        + `(PLANNER_MCP_SCOPES=${[...SCOPES].join(',')})`)
    }
    throw new Error(`no such tool: ${name}`)
  }

  switch (name) {
    case 'describe': {
      const day = await get(`/days/${args.date || today()}`).catch(() => ({ sections: [] }))
      return {
        today: today(),
        query_grammar: {
          shape: 'terms separated by spaces, ANDed; bare words match title or notes',
          fields: {
            is: Object.keys({
              code: 1, deep: 1, light: 1, optional: 1, committed: 1, open: 1, done: 1, closed: 1, archived: 1,
            }),
            status: ['todo', 'doing', 'done', 'moved', 'dropped'],
            priority: ['lowest', 'low', 'medium', 'high', 'highest'],
            date: ['today', 'tomorrow', 'yesterday', 'week', 'overdue', 'none', 'YYYY-MM-DD', 'A..B'],
            has: ['notes', 'comments'],
            order: ['date', '-date', 'created', '-created', 'due', 'priority', 'estimate'],
            other: ['project:"Name"', 'section:"Name"', 'parent:N', 'due:<date>', 'limit:N', 'offset:N'],
          },
          default: 'with no status term, only open tasks are returned',
        },
        transitions: ['start', 'complete', 'reopen', 'drop', 'move', 'backlog'],
        updatable_fields: [
          'title', 'notes', 'priority', 'estimate_min', 'due_date', 'is_code', 'deep_work',
          'optional', 'project',
        ],
        sections_on: { date: args.date || today(), sections: (day.sections || []).map((s) => s.name) },
        scopes: [...SCOPES],
      }
    }

    case 'get_projects': {
      const list = await get('/projects')
      return list.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        repo: p.repo_path || null,
        description: p.description || null,
        url: `${WEB}/projects/${p.id}`,
      }))
    }

    case 'search_tasks': {
      const { params, projectName, sectionName, hasComments } = parse(args.query || '')
      if (projectName) params.project_id = (await projectNamed(projectName)).id
      if (sectionName) params.section_id = (await sectionNamed(sectionName, params.from)).id

      // One more than asked for, so "there are more" is known rather than
      // guessed — the alternative is silently returning a truncated page that
      // reads as the whole answer.
      const take = Math.min(Math.max(Number(args.limit ?? params.limit ?? 50), 1), 200)
      const skip = Math.max(Number(args.offset ?? params.offset ?? 0), 0)
      delete params.limit
      delete params.offset

      const rows = await get(`/tasks?${qs({ ...params, limit: take + 1, offset: skip })}`)
      const byProject = await projectsById()

      let page = rows.slice(0, take)
      let more = rows.length > take
      if (hasComments) {
        const withC = []
        for (const t of page) {
          const cs = await get(`/tasks/${t.id}/comments`)
          if (cs.length) withC.push(t)
        }
        page = withC
        // The filter runs after the page, so "more" would be a claim about
        // rows nobody looked at.
        more = rows.length > take
      }

      return {
        query: args.query || '(every open task)',
        count: page.length,
        has_more: more,
        next_offset: more ? skip + take : null,
        tasks: page.map((t) => shape(t, byProject)),
      }
    }

    case 'get_task': {
      const [t, byProject, comments, kids] = await Promise.all([
        get(`/tasks/${args.id}`),
        projectsById(),
        get(`/tasks/${args.id}/comments`).catch(() => []),
        get(`/tasks?${qs({ parent_id: args.id, status: 'todo,doing,done,dropped,moved' })}`).catch(() => []),
      ])
      return shape(t, byProject, {
        project_description: byProject[t.project_id]?.description || null,
        subtasks: kids.map((k) => ({ id: k.id, title: k.title, status: k.status })),
        comments: comments.map((c) => ({
          id: c.id, author: c.author, kind: c.kind, minutes: c.minutes, body: c.body, at: c.created_at,
        })),
        transitions: transitionsFor(t).map((tr) => tr.name),
      })
    }

    case 'get_comments': {
      const list = await get(`/tasks/${args.id}/comments`)
      return list.map((c) => ({
        id: c.id, author: c.author, kind: c.kind, minutes: c.minutes, body: c.body, at: c.created_at,
      }))
    }

    case 'get_transitions': {
      const t = await get(`/tasks/${args.id}`)
      return { id: t.id, status: t.status, transitions: transitionsFor(t) }
    }

    case 'create_task': {
      const body = {
        title: args.title,
        notes: args.notes || '',
        scheduled_date: args.date ? dateWord(args.date) : null,
        priority: args.priority,
        estimate_min: args.estimate_min,
        is_code: args.is_code ? 1 : undefined,
        intensity: args.deep_work === undefined ? undefined : (args.deep_work ? 'deep' : 'light'),
      }
      if (args.project) body.project_id = (await projectNamed(args.project)).id
      const made = await post('/tasks', body)
      // Nesting has its own route because it is the only path that checks for
      // cycles; going through PATCH would let a task become its own ancestor.
      if (args.parent_id) await post(`/tasks/${made.id}/nest`, { parent_id: args.parent_id })
      return shape(await get(`/tasks/${made.id}`), await projectsById())
    }

    case 'update_task': {
      const body = {}
      for (const k of ['title', 'notes', 'priority', 'estimate_min', 'due_date']) {
        if (args[k] !== undefined) body[k] = args[k]
      }
      if (args.is_code !== undefined) body.is_code = args.is_code ? 1 : 0
      if (args.optional !== undefined) body.optional = args.optional ? 1 : 0
      if (args.deep_work !== undefined) body.intensity = args.deep_work ? 'deep' : 'light'
      if (args.project !== undefined) {
        body.project_id = args.project ? (await projectNamed(args.project)).id : null
      }
      if (!Object.keys(body).length) throw new Error('nothing to change')
      await patch(`/tasks/${args.id}`, body)
      return shape(await get(`/tasks/${args.id}`), await projectsById())
    }

    case 'transition_task': {
      const t = await get(`/tasks/${args.id}`)
      const want = String(args.transition || '').toLowerCase()
      const tr = transitionsFor(t).find((x) => x.name === want)
      if (!tr) {
        throw new Error(`"${args.transition}" is not available from ${t.status}. `
          + `From here: ${transitionsFor(t).map((x) => x.name).join(', ')}`)
      }
      for (const need of tr.required || []) {
        if (!args[need]) throw new Error(`"${want}" needs ${need} (${tr.args[need]})`)
      }

      if (want === 'move') {
        await post(`/tasks/${args.id}/move`, { date: dateWord(args.date) })
      } else if (want === 'backlog') {
        await patch(`/tasks/${args.id}`, { scheduled_date: null, section_id: null })
      } else {
        await patch(`/tasks/${args.id}`, { status: tr.to })
      }
      if (args.comment) await comment(args.id, args.comment)
      return shape(await get(`/tasks/${args.id}`), await projectsById())
    }

    case 'add_comment':
      return comment(args.id, args.body)

    case 'add_worklog': {
      await post(`/tasks/${args.id}/worklog`, {
        minutes: args.minutes, comment: args.comment, author: AUTHOR,
      })
      return shape(await get(`/tasks/${args.id}`), await projectsById())
    }

    default:
      throw new Error(`no such tool: ${name}`)
  }
}

const server = new Server(
  { name: 'planner', version: '2.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const out = await run(req.params.name, req.params.arguments || {})
    return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }
  } catch (e) {
    // A tool result rather than a thrown protocol error, so the model reads
    // what went wrong and can correct itself instead of the call vanishing.
    return { isError: true, content: [{ type: 'text', text: e.message }] }
  }
})

await server.connect(new StdioServerTransport())
