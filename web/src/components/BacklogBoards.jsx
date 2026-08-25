import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon.jsx'
import ColumnBoard from './ColumnBoard.jsx'
import TaskRow, { nestTasks, visibleIds } from './TaskRow.jsx'
import Progress from './Progress.jsx'
import { Empty, Panel, cls } from './ui.jsx'

/** Undated first is meaningless here — everything is undated — so sort by name. */
const NO_PROJECT = { id: null, name: 'No project', color: null }

function byName(a, b) {
  // The unfiled group sorts last rather than under "N": it is a leftover, not a
  // project, and putting it in the middle of the alphabet hides that.
  if ((a.id === null) !== (b.id === null)) return a.id === null ? 1 : -1
  return (a.name || '').localeCompare(b.name || '')
}

/**
 * The whole backlog, one panel per project.
 *
 * A single flat backlog answers "what is waiting?" but not "waiting on what?",
 * and the second question is the one that decides what to pull into a day. Each
 * panel folds away on its own, and carries a link into that project's own
 * backlog tab for when one project is the whole subject.
 */
export default function BacklogBoards({
  tasks, projects, labels, rowProps, onMoveToColumn, board = true,
}) {
  const [shut, setShut] = useState(() => new Set())
  const toggle = (key) => setShut((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const byId = new Map((projects || []).map((p) => [p.id, p]))
  const groups = new Map()
  for (const t of tasks) {
    const key = t.project_id ?? null
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(t)
  }

  const ordered = [...groups.entries()]
    .map(([id, rows]) => ({ project: byId.get(id) || NO_PROJECT, rows }))
    .sort((a, b) => byName(a.project, b.project))

  if (ordered.length === 0) {
    return <Panel><Empty>Nothing in the backlog. Every open task has a day.</Empty></Panel>
  }

  return (
    <>
      {ordered.map(({ project, rows }) => {
        const key = project.id ?? 'none'
        const open = !shut.has(key)
        const tree = nestTasks(rows)

        return (
          <Panel
            key={key}
            className={project.color ? cls(project.color) : ''}
            bodyClass="at-body"
            title={
              <>
                <button
                  className="done-toggle bl-fold"
                  aria-expanded={open}
                  title={open ? `Minimise ${project.name}` : `Show ${project.name}`}
                  onClick={() => toggle(key)}
                >
                  <Icon name={open ? 'chevronDown' : 'right'} size={12} />
                </button>
                {project.color && <span className="dot" style={{ background: 'var(--c)' }} />}
                {project.name}
                <span className="muted">({rows.length})</span>
              </>
            }
            actions={project.id != null && (
              // Straight to this project's own backlog tab, where everything
              // else about the project is folded away by construction.
              <Link
                className="btn ghost sm"
                to={`/projects/${project.id}?tab=backlog`}
                title={`Open ${project.name}'s backlog on its own`}
              >
                <Icon name="arrowRight" size={12} /> In project
              </Link>
            )}
          >
            {open && (
              <>
                <div className="at-groupbar">
                  <Progress tasks={rows} color={project.color} className="at-prog" />
                </div>
                {board ? (
                  <ColumnBoard
                    tasks={rows}
                    labels={labels}
                    rowProps={rowProps}
                    onMoveToColumn={(ids, col) => onMoveToColumn?.(ids, col, rows)}
                  />
                ) : (
                  <div className="at-rows at-static">
                    {tree.map((t) => (
                      <TaskRow key={t.id} {...rowProps(t)} listIds={visibleIds(tree)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </Panel>
        )
      })}
    </>
  )
}
