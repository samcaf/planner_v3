/**
 * ფ — the Georgian letter pari, drawn rather than typeset.
 *
 * The letter is three strokes: a bowl, a small upper lobe, and a lower lobe
 * falling into a descender. The treatment comes from an ornamental reference:
 * a tall bowl, and a descender that does not merely hook but curls back into a
 * closed loop. Sans-serifised, so the reference's swelling calligraphic contrast
 * becomes an even-weight bowl against a tail that tapers over four decreasing
 * stroke widths — a compass on the left, a pen on the right.
 *
 * What the reference does and this deliberately does not: its descender is a
 * full figure-eight with a spiral eye set in the bowl. Both were drawn and
 * tested, and both collapse into an illegible squiggle at the 22–30px this mark
 * actually renders at; the eye also reads as an eye, which turns the letter into
 * a face. A single loop keeps the gesture and survives the size.
 *
 * The upper lobe is deliberately smaller than the bowl. Drawn at equal size the
 * two counters read as a pair of goggles; unequal, the eye travels bowl → lobe
 * → tail, which is the order the letter is actually written in.
 *
 * Strokes are separate paths with round caps that overlap at the joins, so the
 * taper reads continuously without needing a variable-width outline.
 *
 * Colour comes from `currentColor`, so the mark follows the theme rather than
 * carrying its own palette.
 */
export default function Pari({ size = 30, title = 'Planner', ...rest }) {
  return (
    <svg
      viewBox="8 26 208 286"
      height={size}
      width={size * (212 / 276)}
      role="img"
      aria-label={title}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <ellipse cx="70" cy="104" rx="40" ry="47" strokeWidth="27" />
      <path d="M112 64 C152 42 186 68 180 102 C174 130 146 140 120 126" strokeWidth="19" />
      <path d="M126 122 C170 136 200 178 190 224" strokeWidth="14.5" />
      <path d="M192 216 C184 274 128 306 84 288 C46 272 52 226 92 232" strokeWidth="9.5" />
    </svg>
  )
}
