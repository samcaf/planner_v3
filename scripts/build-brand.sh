#!/usr/bin/env bash
#
# Regenerate every served brand asset from the source artwork.
#
#   assets/brand/*        source artwork, committed, never served
#   web/public/brand/*    everything below, generated, served at /brand/...
#
# Run this after replacing a source image. It is idempotent; nothing else in the
# app writes to web/public/brand.
#
#   ./scripts/build-brand.sh
#
# Requires ImageMagick (`convert`).

set -euo pipefail
cd "$(dirname "$0")/.."

SRC=assets/brand/wordmark-source.png
OUT=web/public/brand
mkdir -p "$OUT"

command -v convert >/dev/null || { echo "ImageMagick 'convert' not found" >&2; exit 1; }
[ -f "$SRC" ] || { echo "missing $SRC" >&2; exit 1; }

# Round the corners of a square icon in place. Bare squares look like clipped
# screenshots in a tab strip or a launcher; every platform that does not mask an
# icon itself expects the art to arrive already softened.
#   round <file> <size> <radius>
round() {
  local file=$1 size=$2 radius=$3 mask=/tmp/_round_mask.png
  convert -size "${size}x${size}" xc:black -fill white \
    -draw "roundrectangle 0,0,$((size - 1)),$((size - 1)),$radius,$radius" \
    -alpha off "$mask"
  convert "$file" -alpha set "$mask" -compose CopyOpacity -composite "$file"
  rm -f "$mask"
}

# --- the sidebar wordmark --------------------------------------------------
# The whole composition — gold finial above, calligraphy, knot pendant below —
# trimmed to the ink so no parchment margin is baked in. An earlier version cut
# the ornaments off because the mark was then only 26px tall and they crowded
# out the letters; it now spans the sidebar's full width, which gives every part
# room.
#
# Emitted as an alpha mask (ink opaque, parchment gone) rather than a picture:
# the sidebar is dark and this ink is near-black, so placed as an <img> it would
# be invisible in dark mode and carry a cream rectangle in light mode. As a mask
# CSS fills it with the theme colour — which also means the gold ornaments and
# the navy letters arrive as one colour, the price of working on both themes.
convert "$SRC" \
  -colorspace Gray -level 20%,86% -negate \
  -alpha copy -channel RGB -evaluate set 100% +channel \
  -trim +repage \
  "$OUT/wordmark.png"

# --- app icons -------------------------------------------------------------
# The whole composition in full colour, softened at the corners. An icon sits on
# the OS's own background rather than ours, so the parchment stays.
convert "$SRC" -resize 512x512 -strip "$OUT/icon-512.png"; round "$OUT/icon-512.png" 512 96
convert "$SRC" -resize 192x192 -strip "$OUT/icon-192.png"; round "$OUT/icon-192.png" 192 36

# iOS applies its own rounded mask and composites on black, so a pre-rounded
# apple-touch icon gets double-rounded with dark corners. This one stays square.
convert "$SRC" -resize 180x180 -strip "$OUT/apple-touch-icon.png"

# Android crops maskable icons to a squircle, so inset the artwork and pad with
# its own parchment rather than letting the flourishes get clipped. Square for
# the same reason as above — the platform does the rounding.
convert "$SRC" -resize 400x400 -background '#f4ecdc' -gravity center -extent 512x512 \
  -strip "$OUT/icon-maskable-512.png"

# Favicon: the same full composition as the sidebar mark — finial, letters,
# pendant — so the tab and the rail show the same thing.
#
# It is the *trimmed* ink re-padded to a square, not the raw source: the source
# carries a wide parchment margin, and scaling that to 32px shrinks the artwork
# to a speck in the middle of an empty frame. Trimming first lets the composition
# fill its square, which is the difference between this reading at small sizes
# and not.
FAVSQ=/tmp/_favsq.png
convert "$SRC" -trim +repage \
  -background '#f4ecdc' -gravity center -extent 1040x1040 "$FAVSQ"
# Two of them, because a tab strip is not one colour. The browser tells the page
# which it is using via prefers-color-scheme, and index.html offers a matching
# icon for each — so the mark sits on the chrome rather than punching a pale
# square into a dark toolbar. Both are the sidebar's own pairing: the rail's
# background with the rail's ink, rather than the artwork's parchment.
#   favicon-light.*  dark ink  on parchment, for a light browser
#   favicon-dark.*   light ink on the deep sidebar purple, for a dark one
INK_ON=/tmp/_ink.png
convert "$FAVSQ" -colorspace Gray -level 20%,86% -negate -alpha copy \
  -channel RGB -evaluate set 100% +channel "$INK_ON"

emit() {                       # emit <name> <bg> <fg>
  local name=$1 bg=$2 fg=$3
  for s in 64 32 16; do
    convert -size 1040x1040 "xc:$bg" \
      \( "$INK_ON" -fill "$fg" -colorize 100 \) -composite \
      -resize ${s}x${s} -strip "/tmp/_f${s}.png"
    # Radius scaled to the size, and kept small at 16px — round a 16px square
    # too hard and the glyphs start getting clipped at the corners.
    round "/tmp/_f${s}.png" "$s" "$(( s / 5 ))"
  done
  cp /tmp/_f64.png "$OUT/${name}.png"
  convert /tmp/_f16.png /tmp/_f32.png /tmp/_f64.png "$OUT/${name}.ico"
  rm -f /tmp/_f16.png /tmp/_f32.png /tmp/_f64.png
}

emit favicon-light '#f4ecdc' '#241a33'
emit favicon-dark  '#241a33' '#efe9ff'
cp "$OUT/favicon-light.png" "$OUT/favicon.png"
cp "$OUT/favicon-light.ico" "$OUT/favicon.ico"
rm -f "$INK_ON" "$FAVSQ"

echo "brand assets written to $OUT:"
ls -la "$OUT" | awk 'NR>3 {printf "  %-26s %s\n", $9, $5}'
