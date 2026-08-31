const PATHS = {
  today: 'M4 5h16v15H4z M4 9h16 M8 3v4 M16 3v4 M12 13h4',
  week: 'M3 5h18v14H3z M3 10h18 M9 10v9 M15 10v9',
  month: 'M3 5h18v15H3z M3 10h18 M8 3v4 M16 3v4 M7 14h2 M11 14h2 M15 14h2',
  projects: 'M4 6h6l2 2h8v11H4z',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20c0-3.6 2.9-5.5 6.5-5.5s6.5 1.9 6.5 5.5 M17 5.2a3.4 3.4 0 0 1 0 6.6 M18.5 14.8c2 .6 3.5 2.1 3.5 5',
  templates: 'M5 3h9l5 5v13H5z M14 3v5h5 M8 12h8 M8 16h5',
  plus: 'M12 5v14 M5 12h14',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  check: 'M4 12l5 5L20 6',
  x: 'M6 6l12 12 M18 6L6 18',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  flag: 'M5 21V4h13l-3 4 3 4H5',
  link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1 M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  dots: 'M12 6.5v.01 M12 12v.01 M12 17.5v.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
  mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
  building: 'M4 21V4h10v17 M14 10h6v11 M7 8h2 M7 12h2 M7 16h2 M17 14h1 M17 18h1',
  arrowRight: 'M4 12h15 M13 6l6 6-6 6',
  undo: 'M4 10h11a5 5 0 0 1 0 10h-6 M4 10l4-4 M4 10l4 4',
  redo: 'M20 10H9a5 5 0 0 0 0 10h6 M20 10l-4-4 M20 10l-4 4',
  grip: 'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',
  rewind: 'M11 6L4 12l7 6V6Z M20 6l-7 6 7 6V6Z',
  play: 'M8 5l11 7-11 7z',
  pause: 'M9 5v14 M15 5v14',
  skip: 'M6 5l9 7-9 7z M18 5v14',
  reset: 'M4 11a8 8 0 1 1 2.3 5.7 M4 5v6h6',
  chevronDown: 'M6 9l6 6 6-6',
  subtask: 'M6 4v9a3 3 0 0 0 3 3h9 M14 12l4 4-4 4 M17 4h3',
  columns: 'M3 4h18v16H3z M9 4v16 M15 4v16',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3.5 6h.01 M3.5 12h.01 M3.5 18h.01',
  image: 'M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M15.5 8.5h.01',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  /* A keyboard: an outline with three rows of keys and a spacebar. Dots rather
     than rects for the keys, so it stays legible at 14px. */
  keyboard: 'M2.5 6h19v12h-19z M6 9.5h.01 M9.5 9.5h.01 M13 9.5h.01 M16.5 9.5h.01'
    + ' M6 12.5h.01 M9.5 12.5h.01 M13 12.5h.01 M16.5 12.5h.01 M7.5 15.5h9',
  paperclip: 'M21.4 11l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5',
  /* A four-pointed star with a small companion: the mark that has come to mean
     "a machine did this". Two strokes, so it reads at 11px. */
  sparkle: 'M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z M18 16.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z',
  /* The box the files go in: a lid across the top, the body under it, and the
     lift-tab in the middle of the lid — which is the detail that separates an
     archive from a plain crate at 13px. */
  archive: 'M3 4h18v4H3z M5 8v12h14V8 M10 12h4',
  /* Angle brackets and a slash — what everyone draws for code. */
  code: 'M8.5 17.5L3 12l5.5-5.5 M15.5 6.5L21 12l-5.5 5.5 M13.5 4.5l-3 15',

  /*
   * Six teeth with flat tops, tip radius 9.6 on a root of 6.6. Teeth need the
   * flat top: alternating tip/root radii is half the path length but renders as
   * a star, and six is as many as stay separate at 14px under a 1.7 stroke.
   */
  gear: 'M21.2 9.4L21.2 14.6L18.1 14.5L17.2 16.1L18.9 18.7L14.3 21.3L12.9 18.5'
      + 'L11.1 18.5L9.7 21.3L5.1 18.7L6.8 16.1L5.9 14.5L2.8 14.6L2.8 9.4L5.9 9.5'
      + 'L6.8 7.9L5.1 5.3L9.7 2.7L11.1 5.5L12.9 5.5L14.3 2.7L18.9 5.3L17.2 7.9L18.1 9.5Z'
      + ' M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z',

  /*
   * Priority, Jira-style: bare arrowheads rather than arrows, so five levels
   * stay legible at 13px. Each pair mirrors its opposite about the centre line,
   * which is what makes highest/lowest read as one scale rather than two icons.
   */
  priHighest: 'M5 17l7-6 7 6 M5 11l7-6 7 6',
  priHigh: 'M5 15l7-6 7 6',
  priMedium: 'M5 9h14 M5 15h14',
  priLow: 'M5 9l7 6 7-6',
  priLowest: 'M5 7l7 6 7-6 M5 13l7 6 7-6',
}

export default function Icon({ name, size = 16, className = '', strokeWidth = 1.7 }) {
  const d = PATHS[name]
  if (!d) return null
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d.split(' M').map((seg, i) => (
        <path key={i} d={i === 0 ? seg : `M${seg}`} />
      ))}
    </svg>
  )
}
