#!/usr/bin/env bash
# Deploy all Supabase Edge Functions (skips _shared and any dir without index.ts).
# Run from repo root: ./supabase/functions/deploy-all.sh
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
for dir in supabase/functions/*/; do
  fn=$(basename "$dir")
  if [[ "$fn" == _* ]]; then
    echo "Skipping $fn (shared code, not a function)"
    continue
  fi
  if [[ ! -f "${dir}index.ts" ]]; then
    echo "Skipping $fn (no index.ts)"
    continue
  fi
  echo "Deploying $fn..."
  supabase functions deploy "$fn" --project-ref gogwkfrajmlhgdoanqrh
done
echo "Done."
