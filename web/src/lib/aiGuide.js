/**
 * What the AI suite is, written down where the app can show it.
 *
 * The switches, their values and what each one means are NOT here — they are
 * read straight from `aiSwitches.js`, which is what the panels and the server
 * already use, so a switch cannot be added without the page that explains it
 * growing a row. What is here is the prose around them: the shape of the
 * thing, the moves an agent can make, and how to connect one.
 *
 * KEEPING IT TRUE: `MOVES` and `SCOPES` mirror `mcp/server.js`. A tool added or
 * renamed there belongs here in the same change — that is the one part of this
 * page nothing can check for you.
 */

/** The idea, in the order it has to be understood. */
export const ABOUT = [
  {
    heading: 'Tasks are the medium',
    body: 'An AI conversation is a section on a day, and every turn in it is a '
      + 'task. You write a brief; an agent claims it, may raise tasks for itself '
      + 'as it works, and writes back an answer with follow-ups. Nothing lives in '
      + 'a chat window, so a question asked on Tuesday is still on Tuesday, in '
      + 'the day it belonged to, with everything else you were doing.',
  },
  {
    heading: 'Whose move it is',
    body: 'A conversation section lays its tasks out in columns by whose turn it '
      + 'is — yours, theirs, or settled. A question an agent asks lands in your '
      + 'column and the run stops there. That is the whole handshake: an agent '
      + 'that cannot ask has no way of saying it is stuck.',
  },
  {
    heading: 'Switches, in four layers',
    body: 'How a task is worked is a set of positions rather than a paragraph. '
      + 'They resolve most-specific-first: the task, then its conversation, then '
      + 'your defaults below, then the built-in fallback. Each layer stores only '
      + 'what it differs from the one under it, which is why a row usually shows '
      + 'nothing — and why setting a switch back to what it would have inherited '
      + 'removes it rather than freezing a copy.',
  },
  {
    heading: 'Instructions stack; switches override',
    body: 'A task’s notes say what it is about. An instruction is addressed to '
      + 'the agent and to nobody else: how to go about it, what not to touch. '
      + 'There are three — yours below, the conversation’s, the task’s own — and '
      + 'unlike the switches they all apply at once, most general first, each '
      + 'labelled with where it came from.',
  },
  {
    heading: 'The ceiling is what makes it safe',
    body: 'A run may create at most `budget` tasks and nest its own steps at '
      + 'most `depth` deep, and the planner itself refuses past either — not the '
      + 'agent, and not the tool server. Two moves are exempt, because both hand '
      + 'the turn back to you: a question, and the answer that reports what was '
      + 'done. Follow-ups are not, so a spent run can still say what it did but '
      + 'cannot leave twenty new tasks behind.',
  },
]

/** The five moves that hold a conversation in tasks. Mirrors mcp/server.js. */
export const MOVES = [
  ['claim', 'take a brief, open a run, and learn the terms it is worked under'],
  ['ask', 'ask you something — it goes in your column, and the run stops'],
  ['step', 'raise a task for itself, so its path is visible rather than internal'],
  ['report', 'a heading saying what it did, its notes, and follow-ups for you'],
  ['run_state', 'what has been spent and what is left, so a long stretch can be planned'],
]

/** What the tool server exposes, by scope. Mirrors mcp/server.js. */
export const SCOPES = [
  ['read', 'get_task, get_transitions, get_projects, get_comments, describe'],
  ['search', 'search_tasks — one query language, not a tool per question'],
  ['write', 'create_task, update_task, transition_task, add_comment, add_worklog'],
  ['dialogue', 'claim, ask, step, report, run_state'],
]

/** What a query looks like before the grammar means anything. */
export const QUERY_EXAMPLES = [
  'is:code date:today order:priority',
  'project:"Planner v3" priority:high has:notes',
  'drag date:2026-08-01..2026-08-31 limit:10',
]

/** Enough of the query language to start; `describe` returns the whole grammar. */
export const QUERY = [
  ['is: / not:', 'code, deep, light, optional, committed, open, done, closed, archived'],
  ['is:mine / is:theirs / is:settled', 'whose move it is in a conversation'],
  ['status:', 'todo, doing, done, moved, dropped — comma for or'],
  ['priority:', 'lowest, low, medium, high, highest'],
  ['date: / due:', 'today, tomorrow, week, overdue, none, YYYY-MM-DD, A..B'],
  ['project: / section:', 'by name, quoted if it has spaces'],
  ['has:', 'notes, comments'],
  ['order:', 'date, -date, created, -created, due, priority, estimate'],
  ['limit: / offset:', 'paging — the result says has_more and next_offset'],
]

/** How an agent is pointed at this planner. */
export const CONNECT = {
  command: 'claude mcp add planner -- node ~/Documents/planner_v3/mcp/server.js',
  env: [
    ['PLANNER_API', 'where the API is (default http://localhost:8787)'],
    ['PLANNER_WEB', 'what task URLs are built from (default http://localhost:5173)'],
    ['PLANNER_MCP_SCOPES',
      'read,write,search,dialogue — drop write and dialogue for a read-only server'],
    ['PLANNER_MCP_AUTHOR', 'who comments are attributed to (default claude)'],
  ],
}
