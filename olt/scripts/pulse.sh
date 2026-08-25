#!/usr/bin/env bash
set -euo pipefail

CAPSULE="${1:-.olt/capsules/mind-gen-1}"
HOST_CMD="${2:-${PULSE_HOST_CMD:-${HOST_CMD:-}}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS="${HARNESS_PATH:-$SCRIPT_DIR/harness.ts}"
BUN="${BUN_PATH:-bun}"
LOCK_DIR="$CAPSULE/.locks"
mkdir -p "$LOCK_DIR"
LOCK_FILE="$LOCK_DIR/mind.pulse"
EVIDENCE_DIR="$CAPSULE/evidence"
mkdir -p "$EVIDENCE_DIR"

exec 9>"$LOCK_FILE"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || exit 0
elif command -v perl >/dev/null 2>&1; then
  perl -MFcntl=:flock -e 'open(my $fh, "<&=", 9) or exit 1; flock($fh, LOCK_EX|LOCK_NB) or exit 1' || exit 0
elif command -v python3 >/dev/null 2>&1; then
  python3 -c 'import fcntl; fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)' 2>/dev/null || exit 0
fi

BRIEF_FILE="$EVIDENCE_DIR/mind-brief-$$-$RANDOM$RANDOM"
cleanup() {
  rm -f "$BRIEF_FILE"
}
trap cleanup EXIT INT TERM

"$BUN" "$HARNESS" mind:wake --run "$CAPSULE" > "$BRIEF_FILE"

if [ -n "$HOST_CMD" ]; then
  eval "$HOST_CMD \"$BRIEF_FILE\""
fi
