#!/usr/bin/env bash
# Makes the 1000px copy of camera-tour captures under <id>/frames/<tour>/, scaled to 1000px wide
# (JPEG quality 75): every frame of a place tour (captures/places-*), and from grid tours only the
# frames mixtures.json links to a place. stops.txt is always copied whole. Frames no longer linked
# are removed, and so are tours left without frames. Both captures/ and frames/ are in the research
# archive ($SC2_RESEARCH_DIR/docs/research/exemplar-maps; README "Research archive"): the frames are
# never committed or shipped with the Style Pack, which reads only their paths, from mixtures.json.
#
# Run after mixtures.mjs, so mixtures.json knows the frames:
#   node packages/core/scripts/exemplar-analysis/mixtures.mjs     # rewrites <Style Pack>/exemplar-maps/mixtures.json
#   packages/core/scripts/exemplar-capture/make-frames.sh
# from the Workspace root.
set -euo pipefail

if [ -z "${SC2_RESEARCH_DIR:-}" ]; then
  echo 'SC2_RESEARCH_DIR isn'"'"'t set. Set it to the folder of your research archive (README "Research archive"), such as export SC2_RESEARCH_DIR=~/sc2-research.' >&2
  exit 1
fi

scripts="$(cd "$(dirname "$0")/.." && pwd)"
# The active Style Pack's Exemplar Maps folder, in the Workspace this is run from (needs npm run build).
root="$(node --input-type=module -e '
  const { workspaceRoot } = await import(process.argv[1] + "/workspace-root.mjs");
  const { loadWorkspace, stylePackFiles } = await import(process.argv[1] + "/../dist/plugins/workspace.js");
  const { exemplarDir } = stylePackFiles(await loadWorkspace(workspaceRoot()));
  if (!exemplarDir) throw new Error("the Style Pack lists no Exemplar Maps");
  console.log(exemplarDir);
' "$scripts")"
captures="$SC2_RESEARCH_DIR/docs/research/exemplar-maps"
cd "$captures"

# Path swaps go through unquoted variables: bash 3.2 (macOS) keeps backslashes and quotes literally in a
# ${x/pat/rep} replacement.
cap=/captures/ fr=/frames/
wanted="$(mktemp)"
trap 'rm -f "$wanted"' EXIT
node -e '
  const { places } = require(process.argv[1]);
  for (const f of new Set(places.flatMap((p) => p.frames ?? []))) console.log(f);
' "$root/mixtures.json" >"$wanted"
for tour in "$captures"/*/captures/places-*/; do
  [[ -d "$tour" ]] || continue
  for f in "$tour"*.jpg; do f="${f#"$captures"/}"; echo "${f/$cap/$fr}"; done >>"$wanted"
done

made=0
while read -r f; do
  src="$captures/${f/$fr/$cap}"
  # A rerun tour overwrites its captures, so rebuild frames older than their capture.
  [[ ! -f "$src" ]] || [[ -f "$f" && ! "$src" -nt "$f" ]] && continue
  mkdir -p "$(dirname "$f")"
  sips -Z 1000 -s formatOptions 75 "$src" --out "$f" >/dev/null
  made=$((made + 1))
done <"$wanted"

for stops in "$captures"/*/captures/*/stops.txt; do
  [[ -f "$stops" ]] || continue
  rel="${stops#"$captures"/}"
  dest="${rel/$cap/$fr}"
  [[ -d "$(dirname "$dest")" ]] && cp "$stops" "$dest"
done

# Prune only tours whose full-size captures are here to rebuild them from: frames with no capture
# beside them (Episode 3's, whose tours were lost) are the only copy, and the archive is outside git's
# reach until committed.
removed=0
for f in */frames/*/*.jpg; do
  [[ -f "$f" ]] || continue
  [[ -d "$(dirname "${f/$fr/$cap}")" ]] || continue
  grep -qxF "$f" "$wanted" || { rm "$f"; removed=$((removed + 1)); }
done
# A tour left with no frames keeps only its stops.txt; drop it.
for tour in */frames/*/; do
  compgen -G "$tour*.jpg" >/dev/null || rm -r "$tour"
done
echo "made $made, removed $removed, kept $(ls */frames/*/*.jpg 2>/dev/null | wc -l | tr -d ' ')"
