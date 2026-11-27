#!/usr/bin/env bash
# Tests every package but core, then runs the check scripts: with core's tests, what `pnpm test` runs.
# CI runs core's tests in jobs of their own. Turborepo builds what each package's tests need first
# (cached from pnpm install's build) and runs one package's tests at a time, as the runners are small.
set -euo pipefail

node scripts/turbo.mjs run test --filter='!@team-antioch/sc2-adjutant' --concurrency=1
pnpm run test:checks
