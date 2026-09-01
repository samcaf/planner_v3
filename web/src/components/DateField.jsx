import { useMobile } from '../lib/mobile.js'

/**
 * The day's date, as a field you can jump from.
 *
 * `<input type="date">` draws its own text in the browser's locale format, and
 * there is no way to ask it for a two-digit year — the format is the browser's
 * to choose. On a phone those two extra digits cost more than they are worth,
 * so the input stops being the thing you READ while staying the thing you
 * press: it sits transparent over a label formatted here, filling the box, so
 * a tap still lands on it and still opens the native picker. That picker is the
 * one part of a date input genuinely worth having on a phone, which is why this
 * is an overlay rather than a text field that parses `mm/dd/yy` by hand.
 *
 * `opacity: 0` and not `display: none` or `visibility: hidden` — either of
 * those would take the picker with it.
 */
export default function DateField({ value, onChange, label = 'Go to date' }) {
  const phone = useMobile()

  if (!phone) {
    return (
      <input
        className="input topbar-date"
        type="date"
        aria-label={label}
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      />
    )
  }

  const [y, m, d] = (value || '').split('-')

  return (
    <span className="date-mini">
      {/* aria-hidden: the input behind it already announces the same date, and
          two readings of one control is worse than none. */}
      <span aria-hidden="true">{m}/{d}/{y?.slice(2)}</span>
      <input
        type="date"
        aria-label={label}
        value={value}
        onChange={(e) => e.target.value && onChange(e.target.value)}
      />
    </span>
  )
}
