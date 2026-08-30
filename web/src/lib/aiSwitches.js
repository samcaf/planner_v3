/**
 * The switches on an AI task.
 *
 * An ordinary task carries a duration; a task written for an agent carries the
 * terms it should be worked under. They are discrete on purpose — a set of
 * positions you can read off a row at a glance, not free text to be
 * interpreted.
 *
 * They fall into two classes, and the difference is not cosmetic:
 *
 *   ENFORCED   the planner itself refuses. A budget of twelve tasks means the
 *              thirteenth create is rejected by the server, whatever the agent
 *              intended.
 *   DECLARED   the planner records the intent and shows it; whoever runs the
 *              agent has to honour it. A model or an effort level is a
 *              property of the session doing the work, and nothing on this
 *              side can reach into that.
 *
 * Presenting them identically would be a lie about which knobs bite, so the
 * UI keeps them apart and says so.
 */

export const ENFORCED = [
  {
    key: 'mode',
    label: 'Mode',
    values: ['plan', 'ask', 'build'],
    fallback: 'plan',
    hint: 'plan — work it out and write the plan as tasks, change nothing\n'
      + 'ask — answer the question, change nothing\n'
      + 'build — actually do it',
  },
  {
    key: 'followups',
    label: 'Follow-ups',
    values: ['auto', 'always', 'never'],
    fallback: 'auto',
    hint: 'Whether the answer comes with follow-up tasks for you. auto leaves it to the agent.',
  },
  {
    key: 'on_done',
    label: 'On finishing',
    values: ['stop', 'continue'],
    fallback: 'stop',
    hint: 'stop — finishing this ends the run\n'
      + 'continue — it may keep raising and working tasks toward the original goal',
  },
  {
    key: 'depth',
    label: 'Depth',
    values: ['0', '1', '2', '3', '4'],
    fallback: '2',
    hint: 'How deep it may nest tasks it raised for itself. 0 forbids it entirely.',
  },
  {
    key: 'budget',
    label: 'Budget',
    values: ['4', '8', '12', '20', '40'],
    fallback: '12',
    hint: 'Most tasks it may create in one run. Refused past this — and being '
      + 'refused, its only move left is to ask you.',
  },
  {
    key: 'sign_off',
    label: 'Sign-off',
    values: ['required', 'none'],
    fallback: 'required',
    hint: 'required — it proposes done and hands the task back to you\n'
      + 'none — it may close the task itself',
  },
  {
    key: 'verify',
    label: 'Verify',
    values: ['test', 'reproduce', 'none'],
    fallback: 'test',
    hint: 'test — it must leave a passing test behind\n'
      + 'reproduce — it must show the failure FIRST, then fix it\n'
      + 'none — take its word',
  },
]

export const DECLARED = [
  {
    key: 'detail',
    label: 'Detail',
    values: ['brief', 'normal', 'full'],
    fallback: 'normal',
    hint: 'How much explanation comes back with the answer.',
  },
  {
    key: 'model',
    label: 'Model',
    values: ['inherit', 'haiku', 'sonnet', 'opus'],
    fallback: 'inherit',
    hint: 'Which model should do this. Honoured when the work is dispatched to a '
      + 'subagent; otherwise it is the session you started that decides.',
  },
  {
    key: 'effort',
    label: 'Effort',
    values: ['inherit', 'low', 'medium', 'high', 'max'],
    fallback: 'inherit',
    hint: 'How hard it should think. Same caveat as the model.',
  },
  {
    key: 'tokens',
    label: 'Tokens',
    values: ['none', '50k', '200k', '500k', '1m'],
    fallback: 'none',
    hint: 'A ceiling on what this is worth spending. Advisory — but what is spent '
      + 'is written back as a worklog, so it is at least auditable.',
  },
]

export const ALL = [...ENFORCED, ...DECLARED]
const BY_KEY = Object.fromEntries(ALL.map((s) => [s.key, s]))

export const isDeclared = (key) => DECLARED.some((s) => s.key === key)

/** A stored JSON blob to an object, forgivingly — a bad one is no settings. */
export function read(raw) {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * What actually applies: the task's own setting, else the section's, else the
 * built-in. The same shape as a project's default intensity — you set the
 * terms once for the conversation and override the one task that differs.
 */
export function resolve(task, section) {
  const own = read(task?.ai_switches)
  const base = read(section?.ai_switches)
  const out = {}
  for (const s of ALL) out[s.key] = own[s.key] ?? base[s.key] ?? s.fallback
  return out
}

/** Where each resolved value came from, so the UI can show what is inherited. */
export function sources(task, section) {
  const own = read(task?.ai_switches)
  const base = read(section?.ai_switches)
  const out = {}
  for (const s of ALL) {
    if (own[s.key] !== undefined) out[s.key] = 'task'
    else if (base[s.key] !== undefined) out[s.key] = 'section'
    else out[s.key] = 'default'
  }
  return out
}

/**
 * Only what differs from what would apply anyway.
 *
 * Eleven switches on every row would bury the title. A row shows what is
 * unusual about it, which for most tasks is nothing at all.
 */
export function notable(task, section) {
  const applied = resolve(task, section)
  return ALL
    .filter((s) => applied[s.key] !== s.fallback)
    .map((s) => ({ ...s, value: applied[s.key] }))
}

/** Set one switch, dropping it entirely when it matches what it inherits. */
export function withSwitch(task, section, key, value) {
  const own = read(task?.ai_switches)
  const inherited = read(section?.ai_switches)[key] ?? BY_KEY[key]?.fallback
  const next = { ...own }
  if (value === inherited || value === undefined) delete next[key]
  else next[key] = value
  return Object.keys(next).length ? JSON.stringify(next) : ''
}
