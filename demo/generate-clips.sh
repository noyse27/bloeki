#!/bin/sh
# Generates a small library of synthetic "trailer" clips for the isolated
# demo deployment (see ../docker-compose.demo.yml). Real trailer clips are
# never checked into this repository - normal deployments get theirs from
# tools/snippet-cutter, cutting real trailers a licensed operator supplies.
# A public demo has no such source, and bundling real movie trailers would
# be a copyright problem anyway, so this generates clearly-fake placeholder
# clips (color bars + a tone, per-clip title burned in) entirely with
# ffmpeg's built-in lavfi sources - no video files of any kind are shipped
# or downloaded.
#
# Runs once as a one-shot compose service (see the "demo-clips" service in
# docker-compose.demo.yml), writing into the shared demo_clips volume that
# the backend then mounts read-only - the same read-only-mount shape a real
# deployment uses for its tools/snippet-cutter output.
set -eu

OUT_DIR="${OUT_DIR:-/clips}"
DURATION="${TRAILER_DEMO_CLIP_SECONDS:-25}"

mkdir -p "$OUT_DIR"

# title|year|imdb-id|color|tone-frequency-hz
# Deliberately fictional titles/IDs spanning a wide year range - a Timeline-
# style guessing game needs spread-out years to be any fun. Fake IMDb IDs
# use a reserved-looking tt09xxxxx range so they can never collide with a
# real title.
CLIPS='
Der Lange Sommer|1975|tt0900001|0x2a6f4f|220
Nachtzug nach Weiten|1983|tt0900002|0x1f3a5c|247
Stille Wasser|1991|tt0900003|0x5c1f3a|262
Blaue Stunde|1998|tt0900004|0x3a5c1f|294
Kurzschluss|2004|tt0900005|0x6f2a4f|330
Der Zeitzeuge|2009|tt0900006|0x4f6f2a|349
Regentanz|2013|tt0900007|0x2a4f6f|392
Glasnacht|2017|tt0900008|0x6f4f2a|415
Letzte Ausfahrt|2020|tt0900009|0x4f2a6f|440
Morgengrauen|2023|tt0900010|0x2a6f6f|494
'

echo "$CLIPS" | while IFS='|' read -r title year imdb_id color freq; do
  [ -z "$title" ] && continue
  filename="trailer-${title} (${year}) {imdb-id ${imdb_id}}.mp4"
  out_path="${OUT_DIR}/${filename}"

  if [ -f "$out_path" ]; then
    echo "generate-clips: '$filename' already exists, skipping"
    continue
  fi

  echo "generate-clips: rendering '$filename'"
  # -nostdin (and redirecting stdin from /dev/null): without this, ffmpeg
  # reads from the same stdin this `while read` loop is consuming line-by-
  # line, silently stealing a few bytes on each invocation and corrupting
  # every title after the first (seen while testing: "Nachtzug" -> "chtzug").
  ffmpeg -y -nostdin -loglevel error \
    -f lavfi -i "color=c=${color}:s=640x360:d=${DURATION}:r=25" \
    -f lavfi -i "sine=frequency=${freq}:duration=${DURATION}" \
    -vf "drawtext=fontfile=/usr/share/fonts/ttf-dejavu/DejaVuSans-Bold.ttf:text='${title} (${year})':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.5:boxborderw=10" \
    -c:v libx264 -preset veryfast -crf 30 -pix_fmt yuv420p \
    -c:a aac -b:a 64k \
    -shortest \
    "$out_path" < /dev/null
done

echo "generate-clips: done, $(find "$OUT_DIR" -name '*.mp4' | wc -l) clip(s) in $OUT_DIR"
