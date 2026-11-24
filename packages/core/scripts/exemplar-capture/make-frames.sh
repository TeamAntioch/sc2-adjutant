#!/usr/bin/env bash
# Makes the 1000px copy of camera-tour captures under <id>/frames/<tour>/, scaled to 1000px wide
# (JPEG quality 75): every frame of a place tour (captures/places-*), and from grid tours only the
# frames mixtures.json links to a place. stops.txt is always copied whole. Frames no longer linked
# are removed, and so are tours left without frames. A wrapper over core's makeFrames
# (src/capture/style-pack-captures.ts), which capture_exemplar and `npm run capture-exemplars` also
# run after each capture.
#
# The tours are in the active Style Pack's exemplar-maps/ (git-ignored), or in the research archive
# ($SC2_RESEARCH_DIR/docs/research/exemplar-maps; README "Research archive") when it is set, as for
# the Antioch pack: the frames are never committed or shipped with the Style Pack, which reads only
# their paths, from mixtures.json.
#
# Run after find_places (or mixtures.mjs), so mixtures.json knows the frames:
#   node packages/core/scripts/exemplar-analysis/mixtures.mjs     # rewrites <Style Pack>/exemplar-maps/mixtures.json
#   packages/core/scripts/exemplar-capture/make-frames.sh
# from the Workspace root (needs npm run build).
set -euo pipefail

exec node "$(cd "$(dirname "$0")/../.." && pwd)/dist/cli/make-frames.js"
