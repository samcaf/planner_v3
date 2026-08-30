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
 *
 * FOUR LAYERS, in order of precedence: the task, its section, your defaults in
 * settings, and the built-in `fallback` below. Each layer stores only what it
 * differs from the one under it, which is why a row usually shows nothing —
 * and why setting a switch back to what it would have inherited removes the
 * entry rather than freezing a copy of the value.
 */

export const ENFORCED = [
  {
    key: 'mode',
    label: 'Mode',
    values: ['plan', 'ask', 'build'],
    fallback: 'ask',
    hint: 'What the agent is allowed to do about this at all.',
    about: {
      plan: 'Work it out and write the plan back as tasks. Changes nothing else.',
      ask: 'Answer, and stop there. Changes nothing.',
      build: 'Actually do the work.',
    },
  },
  {
    key: 'followups',
    label: 'Follow-ups',
    values: ['auto', 'always', 'never'],
    fallback: 'always',
    hint: 'Whether the answer arrives with follow-up tasks for you.',
    about: {
      auto: 'The agent decides whether any are worth raising.',
      always: 'Always end with follow-ups — what to check, what is still open.',
      never: 'No follow-ups. The answer is the whole of it.',
    },
  },
  {
    key: 'on_done',
    label: 'On finishing',
    values: ['stop', 'continue'],
    fallback: 'stop',
    hint: 'Whether finishing this is the end of the run.',
    about: {
      stop: 'Finishing this ends the run. You decide what happens next.',
      continue: 'It may keep raising and working tasks toward the original goal.',
    },
  },
  {
    key: 'depth',
    label: 'Depth',
    values: ['0', '1', '2', '3', '4'],
    fallback: '2',
    hint: 'How far the agent may nest tasks it raises FOR ITSELF while working '
      + 'this one — its own trail, not the follow-ups it leaves you. Depth 1 means '
      + 'it may break the work into steps; depth 2 means one of those steps may be '
      + 'broken down again.',
    about: {
      0: 'It may not raise any tasks of its own — it works this one directly.',
      1: 'It may break this into steps. Those steps may not be broken down further.',
      2: 'A step it raised may raise steps of its own. Two levels.',
      3: 'Three levels of self-raised steps.',
      4: 'Four levels. Deep enough to lose track of; use with a small budget.',
    },
  },
  {
    key: 'budget',
    label: 'Budget',
    values: ['4', '8', '12', '20', '40'],
    fallback: '12',
    hint: 'The most tasks the agent may create in one run, counting everything — '
      + 'its own steps, its answer, and your follow-ups. The ceiling on how much '
      + 'work one brief can turn into. Refused past this, and being refused, its '
      + 'only move left is to ask you.',
    about: {
      4: 'Four. An answer and a couple of follow-ups; no room to explore.',
      8: 'Eight. One round of work with a little branching.',
      12: 'Twelve. Enough for a real piece of work.',
      20: 'Twenty. A substantial excursion.',
      40: 'Forty. As much as is readable in a day before it becomes a transcript.',
    },
  },
  {
    key: 'sign_off',
    label: 'Sign-off',
    values: ['required', 'none'],
    fallback: 'required',
    hint: 'Who gets to call this done.',
    about: {
      required: 'It proposes done and hands the task back to you.',
      none: 'It may close the task itself.',
    },
  },
  {
    key: 'verify',
    label: 'Verify',
    values: ['test', 'reproduce', 'none'],
    fallback: 'test',
    hint: 'What it has to show before claiming this is finished.',
    about: {
      test: 'It must leave a passing test behind.',
      reproduce: 'It must show the failure FIRST, then fix it. The strictest, and '
        + 'the one that catches fixing the wrong thing.',
      none: 'Take its word.',
    },
  },
]

export const DECLARED = [
  {
    key: 'detail',
    label: 'Detail',
    values: ['brief', 'normal', 'full'],
    fallback: 'normal',
    hint: 'How much explanation comes back with the answer.',
    about: {
      brief: 'What was done, in a line or two.',
      normal: 'What was done and why.',
      full: 'The reasoning as well — what was tried, what was rejected.',
    },
  },
  {
    key: 'model',
    label: 'Model',
    values: ['inherit', 'haiku', 'sonnet', 'opus'],
    fallback: 'inherit',
    hint: 'Which model should do this. Honoured when the work is dispatched to a '
      + 'subagent; otherwise the session you started decides.',
    about: {
      inherit: 'Whatever session you run it in.',
      haiku: 'Fast and cheap. Mechanical work.',
      sonnet: 'The middle. Most work.',
      opus: 'The most capable. Worth it when the thinking is the hard part.',
    },
  },
  {
    key: 'effort',
    label: 'Effort',
    values: ['inherit', 'low', 'medium', 'high', 'max'],
    fallback: 'inherit',
    hint: 'How hard it should think before answering. Same caveat as the model.',
    about: {
      inherit: 'Whatever the session is set to.',
      low: 'Answer quickly.',
      medium: 'Think it through.',
      high: 'Think hard.',
      max: 'Exhaustive. Slow and expensive.',
    },
  },
  {
    key: 'tokens',
    label: 'Tokens',
    values: ['none', '50k', '200k', '500k', '1M'],
    fallback: 'none',
    hint: 'A ceiling on what this is worth spending. Advisory — but what is spent '
      + 'is written back as a worklog, so it is at least auditable.',
    about: {
      none: 'No ceiling.',
      '50k': 'A small question.',
      '200k': 'A normal piece of work.',
      '500k': 'A large one.',
      '1M': 'As much as it takes.',
    },
  },
]

export const ALL = [...ENFORCED, ...DECLARED]
const BY_KEY = Object.fromEntries(ALL.map((s) => [s.key, s]))

export const isDeclared = (key) => DECLARED.some((s) => s.key === key)

/** The built-in bottom layer, before your settings touch it. */
export const BUILT_IN = Object.fromEntries(ALL.map((s) => [s.key, s.fallback]))

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

/** Keep only recognised keys with values the switch actually offers. */
export function clean(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj || {})) {
    if (BY_KEY[k]?.values.includes(String(v))) out[k] = String(v)
  }
  return out
}

/**
 * Stack the layers, lowest first, and say what applies.
 *
 * Each argument is either a JSON string as stored or an object already read.
 * Later layers win. The built-in bottom is always there, so every key has an
 * answer whatever the caller passes.
 */
export function stack(...layers) {
  const out = { ...BUILT_IN }
  for (const layer of layers) {
    Object.assign(out, clean(typeof layer === 'string' ? read(layer) : layer))
  }
  return out
}

/** What applies to a task: built-in, then your settings, then section, then task. */
export const resolve = (task, section, defaults) =>
  stack(defaults, section?.ai_switches, task?.ai_switches)

/** Where each value came from, so the UI can say what is merely inherited. */
export function sources(task, section, defaults) {
  const own = clean(read(task?.ai_switches))
  const sec = clean(read(section?.ai_switches))
  const def = clean(typeof defaults === 'string' ? read(defaults) : defaults)
  const out = {}
  for (const s of ALL) {
    if (own[s.key] !== undefined) out[s.key] = 'task'
    else if (sec[s.key] !== undefined) out[s.key] = 'section'
    else if (def[s.key] !== undefined) out[s.key] = 'settings'
    else out[s.key] = 'default'
  }
  return out
}

/**
 * Only what differs from the layer below this one.
 *
 * Eleven switches on every row would bury the title. A row shows what is
 * unusual about it, which for most tasks is nothing at all — and "unusual"
 * means unusual for THIS conversation, so a section that works in build mode
 * does not stamp "build" on every task in it.
 */
export function notable(value, inherited) {
  const own = clean(read(value))
  return ALL
    .filter((s) => own[s.key] !== undefined && own[s.key] !== inherited[s.key])
    .map((s) => ({ ...s, value: own[s.key] }))
}

/**
 * Set one switch on one layer.
 *
 * `value` is what that layer stores today; `inherited` is everything that
 * would apply if it stored nothing. Setting a switch to what it would inherit
 * anyway removes the entry — which is what keeps a section default working
 * after a task has been touched.
 *
 * Takes the raw string rather than the row it came from, so a caller can pass
 * what it has just written instead of what the server has last told it. Two
 * clicks in a row used to compute both from the same stale row, and the second
 * silently dropped the first.
 */
export function setSwitch(value, inherited, key, next) {
  const own = clean(read(value))
  const out = { ...own }
  if (next === undefined || next === inherited[key]) delete out[key]
  else out[key] = String(next)
  return Object.keys(out).length ? JSON.stringify(out) : ''
}
