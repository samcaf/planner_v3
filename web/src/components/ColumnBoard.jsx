import { useState } from 'react'
import TaskRow, { nestTasks, visibleIds } from './TaskRow.jsx'
import { COLUMN_MINUTES, columnFor, dealIntoColumns } from '../lib/columns.js'
import { draggedIds, isSectionDrag } from './Selection.jsx'

/**
 * The day's three-box grid, without a day.
 *
 * The backlog is the same work seen before it has a date, so showing it as a
 * flat list asks you to re-read every row to judge its size — the one judgement
 * the day view makes for you. This is that grid, minus everything that only
 * means something on a date: no re-timing dwell, no section, no schedule.
 *
 * Dropping a row into a column writes `col_index`, which the day view reads
 * back when the task is eventually scheduled, so a backlog sorted here arrives
 * already sorted there.
 */
export default function ColumnBoard({ tasks, labels, rowProps, onMoveToColumn, empty }) {
  const [over, setOver] = useState(null)
  const tree = nestTasks(tasks)
  const cols = dealIntoColumns(tree)
  const ids = visibleIds(tree)

  if (tree.length === 0 && empty) return empty

  return (
    <div className="box-cols">
      {cols.map((group, i) => (
        <div
          className={`box-col${over === i ? ' is-over' : ''}`}
          key={i}
          onDragOver={(e) => {
            if (isSectionDrag(e)) return
            e.preventDefault()
            setOver(i)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setOver(null)
          }}
          onDrop={(e) => {
            const dropped = draggedIds(e)
            if (!dropped.length) return
            e.stopPropagation()
            setOver(null)
            onMoveToColumn?.(dropped, i)
          }}
        >
          <div className="box-col-h">{labels[i]}</div>
          {group.length === 0
            ? <p className="box-col-empty">Drop here</p>
            : group.map((t) => (
              <TaskRow key={t.id} {...rowProps(t)} listIds={ids} />
            ))}
        </div>
      ))}
    </div>
  )
}

export { COLUMN_MINUTES, columnFor }
