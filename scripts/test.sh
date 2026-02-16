#!/usr/bin/env bash
set -euo pipefail

rm -rf .test-dist
npx tsc -p tsconfig.test.json
node --test .test-dist/tests/*.test.js
