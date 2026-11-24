#!/usr/bin/env bash
# Tests every package but core, then runs the check scripts: with core's tests, what `npm test` runs.
# CI runs core's tests in jobs of their own.
set -euo pipefail

workspaces=()
for folder in packages/*/ site/; do
  [ "$folder" = packages/core/ ] || workspaces+=(-w "${folder%/}")
done
npm test "${workspaces[@]}" --if-present
npm run test:checks
