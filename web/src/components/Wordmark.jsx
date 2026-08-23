/**
 * The brand wordmark: the whole Tibetan composition — gold finial above, the
 * calligraphy, the endless-knot pendant below.
 *
 * It is painted rather than placed. The source is ink on parchment, and dropping
 * that in as an <img> puts a cream rectangle on a dark sidebar; worse, the ink
 * is near-black, so on a dark theme it would vanish. The artwork is therefore
 * reduced to an alpha mask — ink opaque, parchment gone — which CSS fills with
 * the theme colour. The cost of that is real and worth naming: the gold
 * ornaments and the navy letters come through as a single colour, because a
 * mask carries shape and not hue.
 *
 * Sized by aspect ratio rather than a fixed height. The block spans the rail's
 * full width and reserves its height through `padding-bottom`, so the sidebar
 * does not reflow when the mask image finishes loading.
 *
 * The ratio below is the trimmed ink of the source, and scripts/build-brand.sh
 * is what produces it — change the artwork there and this number follows.
 */
const RATIO = 932 / 920

export default function Wordmark({ title = 'Planner', ...rest }) {
  return (
    <span
      className="brand-mark"
      role="img"
      aria-label={title}
      style={{ paddingBottom: `${RATIO * 100}%` }}
      {...rest}
    />
  )
}
