#!/usr/bin/env bash
#
# Reusable deploy script for Cloudflare Workers apps.
#
# Stamps a build version into your source, deploys, then waits until the new
# build is actually being served — Cloudflare's asset propagation runs a few
# seconds behind `wrangler deploy`, which makes a fresh deploy look like it
# didn't take.
#
# Drop this file into any app and add a deploy.conf next to it:
#
#   WORKER_DIR=worker              # dir holding wrangler.toml (auto-detected)
#   STAMP_FILES="frontend/js/config.js frontend/sw.js"
#   VERIFY_URL=https://myapp.example.workers.dev
#   VERIFY_PATH=/js/config.js      # a file whose body contains the version
#   GIT_COMMIT=0                   # 1 to commit+push the stamp after deploying
#
# Every setting is optional; anything absent is auto-detected or skipped.
# Files are stamped by rewriting VERSION = '...' or VERSION: '...' in place,
# so the pattern survives and the next deploy can find it again.

set -euo pipefail
cd "$(dirname "$0")"

[ -f deploy.conf ] && . ./deploy.conf

VERSION="${VERSION_OVERRIDE:-$(date +%Y%m%d_%H%M)}"

# GNU sed wants -i, BSD/macOS sed wants -i ''. Detect rather than assume.
sed_inplace() {
  if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi
}

# ── Locate the worker ──────────────────────────────────────────────────────
if [ -z "${WORKER_DIR:-}" ]; then
  for d in . worker src api; do
    if [ -f "$d/wrangler.toml" ] || [ -f "$d/wrangler.jsonc" ] || [ -f "$d/wrangler.json" ]; then
      WORKER_DIR="$d"; break
    fi
  done
fi
if [ -z "${WORKER_DIR:-}" ]; then
  echo "error: no wrangler config found. Set WORKER_DIR in deploy.conf." >&2
  exit 1
fi

# ── Stamp ──────────────────────────────────────────────────────────────────
STAMPED=0
for f in ${STAMP_FILES:-}; do
  if [ ! -f "$f" ]; then
    echo "warning: STAMP_FILES lists '$f', which does not exist — skipping" >&2
    continue
  fi
  before=$(md5 -q "$f" 2>/dev/null || md5sum "$f" | cut -d' ' -f1)
  sed_inplace "s/VERSION = '[^']*'/VERSION = '$VERSION'/g" "$f"
  sed_inplace "s/VERSION: '[^']*'/VERSION: '$VERSION'/g" "$f"
  after=$(md5 -q "$f" 2>/dev/null || md5sum "$f" | cut -d' ' -f1)
  if [ "$before" = "$after" ]; then
    echo "warning: no VERSION placeholder found in '$f' — nothing stamped" >&2
  else
    STAMPED=$((STAMPED + 1))
  fi
done
echo "==> version $VERSION (stamped into $STAMPED file(s))"

# ── Deploy ─────────────────────────────────────────────────────────────────
( cd "$WORKER_DIR" && npx wrangler deploy )

# ── Wait for propagation ───────────────────────────────────────────────────
if [ -n "${VERIFY_URL:-}" ] && [ -n "${VERIFY_PATH:-}" ]; then
  echo "==> waiting for $VERSION to go live at $VERIFY_URL$VERIFY_PATH"
  for i in $(seq 1 20); do
    body=$(curl -fsS -H 'Cache-Control: no-cache' "$VERIFY_URL$VERIFY_PATH" 2>/dev/null || true)
    if printf '%s' "$body" | grep -q "$VERSION"; then
      echo "==> live: $VERSION (after $((i * 3))s)"
      LIVE=1; break
    fi
    sleep 3
  done
  if [ -z "${LIVE:-}" ]; then
    echo "warning: $VERSION not visible after 60s — it usually lands shortly after" >&2
  fi
fi

# ── Optional git bookkeeping ───────────────────────────────────────────────
if [ "${GIT_COMMIT:-0}" = "1" ]; then
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git add ${STAMP_FILES:-} && git commit -m "deploy $VERSION" && git push
  else
    echo "warning: GIT_COMMIT=1 but this is not a git repo — skipping" >&2
  fi
fi

echo "==> done: $VERSION"
