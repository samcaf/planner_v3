import teleonomy from './teleonomy.js'

/**
 * Task systems the planner can mirror work out of.
 *
 * One adapter per system, each a plain object answering the contract below.
 * The rest of the integration layer — the picker, the settings tab, the link
 * routes, the reconcile pass, the daemon — is written against this and knows
 * nothing about any particular system.
 *
 * There is one adapter today. That would normally be a bad reason to have an
 * interface at all: an abstraction built for a single implementation is usually
 * a guess about the second one, and usually wrong. The reason to have it here
 * is different and immediate. Without the boundary, the Teleonomy integration
 * touches ten files that belong to the general planner — `db.js`, `Settings`,
 * `AllTasks`, the route table — and a repository meant to be useful to anyone
 * has one person's private tool spread through it. With the boundary, that is
 * one file. The generality is not the point; the seam is.
 *
 * Expect the shape to be wrong in places until a second adapter exists. The
 * honest fix then is to change it, not to bend the second system to fit.
 *
 * ── the contract ─────────────────────────────────────────────────────────────
 *
 *   name      the id: settings keys and `tasks.ext_source` use it
 *   label     what a person sees
 *   fields    what has to be configured, drawn as a form by the settings tab.
 *             `{ key, label, hint, placeholder?, secret? }` — a `secret` field
 *             is stored write-only and never sent back to the browser.
 *
 *   connect(values)         → an opaque handle, passed back to every call below
 *   whoami(conn)            → { id, label } — the connection test, and the
 *                             actor whose own writes the daemon must ignore
 *   containers(conn)        → [{ id, key, title }] — the places to pick from
 *   items(conn, parent)     → [Item] — the work under one of them, in tree
 *                             order, each carrying its `depth`
 *   read(conn, id)          → Item
 *
 *   statusToPlanner(status) → { status, waiting_on } — their vocabulary in ours
 *   pushStatus(conn, item, plannerStatus) → [act] — the adapter owns the route
 *             AND the refusal: it decides which moves are legal and where it
 *             must stop. Returning an act of `{ how: 'gated' | 'blocked' | 'skip' }`
 *             says it went as far as it honestly could.
 *   pushNotes(conn, item, text)
 *
 *   watch(conn, onChange)   → optional. A live feed, if the system has one;
 *             call `onChange(ids)` with the external ids that moved. Absent is
 *             fine — the daemon's sweep is the floor, and this only makes a
 *             change arrive sooner.
 *
 * An `Item` is `{ id, key, title, status, notes, due_date, depth }`.
 */
const ADAPTERS = [teleonomy]

export const all = () => ADAPTERS

export const bySource = (name) => ADAPTERS.find((a) => a.name === name) || null

/** The settings key a given adapter's field is stored under. */
export const settingKey = (name, field) => `int_${name}_${field}`

/** Every key that must never be handed back to a browser. */
export const secretKeys = () => ADAPTERS.flatMap(
  (a) => a.fields.filter((f) => f.secret).map((f) => settingKey(a.name, f.key)),
)
