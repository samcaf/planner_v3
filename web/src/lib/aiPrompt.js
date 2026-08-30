/**
 * The standing instructions an AI task is worked under.
 *
 * A task's `notes` say what it is about. Its prompt says how to go about it,
 * and is addressed to the agent rather than to a reader. Keeping the two apart
 * means the notes stay readable as a description of the work, and an
 * instruction you want applied everywhere does not have to be copied into
 * every task's prose to take effect.
 *
 * THEY STACK. Unlike the switches, where the most specific layer wins, all
 * three apply at once — what you want said about every AI task, about this
 * conversation, and about this one task. A general instruction and a specific
 * one are not in competition, so nothing here overrides anything; it
 * accumulates, most general first, because that is the order you would say
 * them in.
 *
 * Each part is labelled with where it came from. An agent that cannot tell a
 * standing rule from a one-off cannot weigh them when they pull in different
 * directions — and it should say so rather than silently pick.
 */

const clean = (s) => String(s || '').trim()

/**
 * The parts, in the order they apply. Empty layers are left out entirely
 * rather than included as blank headings.
 */
export function promptParts({ defaults, section, task } = {}) {
  const parts = []
  const standing = clean(defaults)
  const conversation = clean(section?.ai_prompt)
  const own = clean(task?.ai_prompt)

  if (standing) parts.push({ from: 'settings', label: 'Standing instructions', text: standing })
  if (conversation) {
    parts.push({
      from: 'section',
      label: section?.name ? `For this conversation — ${section.name}` : 'For this conversation',
      text: conversation,
    })
  }
  if (own) parts.push({ from: 'task', label: 'For this task', text: own })
  return parts
}

/** The same, as one block of markdown to put in front of a model. */
export function promptText(layers) {
  return promptParts(layers)
    .map((p) => `## ${p.label}\n\n${p.text}`)
    .join('\n\n')
}

/** Is there anything to say at all? Saves callers assembling to find out. */
export const hasPrompt = (layers) => promptParts(layers).length > 0
