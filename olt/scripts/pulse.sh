#!/usr/bin/env bash
# One OLT mind pulse. Exit code is the outcome, and every outcome is distinct:
#   0  ran               pulse executed, held a lock, and reached a host
#   70 failed            pulse could not complete
#   71 ran_unlocked      pulse executed with NO lock primitive available (degraded)
#   72 ran_undispatched  pulse executed but reached no host, so it did nothing (degraded)
#   75 skipped_locked    a peer holds the pulse lock; normal, not an incident
# Exiting 0 on lock contention is what made a skipped pulse indistinguishable
# from a pulse that ran. Exiting 0 with no host dispatch made an inert pulse
# indistinguishable from useful work. Both now have their own code.
set -uo pipefail

EXIT_RAN=0
EXIT_FAILED=70
EXIT_RAN_UNLOCKED=71
EXIT_RAN_UNDISPATCHED=72
EXIT_SKIPPED_LOCKED=75

CAPSULE="${1:-.olt/capsules/mind-gen-1}"
HOST_CMD="${2:-${PULSE_HOST_CMD:-${HOST_CMD:-}}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS="${HARNESS_PATH:-$SCRIPT_DIR/harness.ts}"
BUN="${BUN_PATH:-bun}"
REPO_ROOT="${PULSE_REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
PULSE_AGENT_ID="${PULSE_AGENT_ID:-mind-gen-1}"
PULSE_ROLE="${PULSE_ROLE:-mind}"

LOCK_DIR="$CAPSULE/.locks"
EVIDENCE_DIR="$CAPSULE/evidence"
SESSION_DIR="$REPO_ROOT/.olt/.sessions"
mkdir -p "$LOCK_DIR" "$EVIDENCE_DIR" "$SESSION_DIR"
LOCK_FILE="$LOCK_DIR/mind.pulse"
SESSION_FILE="$SESSION_DIR/$$.json"
BRIEF_FILE=""

LOCK_MECHANISM=none

report() {
  printf 'pulse_status=%s pulse_lock_mechanism=%s pulse_host_dispatch=%s\n' \
    "$1" "$LOCK_MECHANISM" "$2" >&2
}

cleanup() {
  [ -n "$BRIEF_FILE" ] && rm -f "$BRIEF_FILE"
  rm -f "$SESSION_FILE"
}
trap cleanup EXIT INT TERM

exec 9>"$LOCK_FILE"
if command -v flock >/dev/null 2>&1; then
  LOCK_MECHANISM=flock
  if ! flock -n 9; then
    report skipped_locked none
    exit "$EXIT_SKIPPED_LOCKED"
  fi
elif command -v perl >/dev/null 2>&1; then
  LOCK_MECHANISM=perl
  if ! perl -MFcntl=:flock -e 'open(my $fh, "<&=", 9) or exit 1; flock($fh, LOCK_EX|LOCK_NB) or exit 1'; then
    report skipped_locked none
    exit "$EXIT_SKIPPED_LOCKED"
  fi
elif command -v python3 >/dev/null 2>&1; then
  LOCK_MECHANISM=python3
  if ! python3 -c 'import fcntl; fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)' 2>/dev/null; then
    report skipped_locked none
    exit "$EXIT_SKIPPED_LOCKED"
  fi
else
  LOCK_MECHANISM=none
  echo "pulse.sh WARNING: no lock primitive available (flock, perl and python3 are all missing); this pulse runs UNLOCKED and may race a concurrent pulse" >&2
fi

# mind:wake refuses any caller without a verified, ledger-backed grant. The
# ancestry session below is read by the bun child through its ppid, and takes
# precedence over a stale repo-root .session.json left by a dead agent.
cat > "$SESSION_FILE" <<JSON
{"agent_id":"$PULSE_AGENT_ID","role":"$PULSE_ROLE","tier":0,"token":"unauthenticated","run_id":"$PULSE_AGENT_ID","can_execute_shell":true,"can_edit_files":true,"host":"local","granted_at":"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"}
JSON

BRIEF_FILE="$EVIDENCE_DIR/mind-brief-$$-$RANDOM$RANDOM"
if ! "$BUN" "$HARNESS" mind:wake --run "$CAPSULE" > "$BRIEF_FILE"; then
  report failed none
  exit "$EXIT_FAILED"
fi

DISPATCH=none
if [ -n "$HOST_CMD" ]; then
  if eval "$HOST_CMD \"$BRIEF_FILE\""; then
    DISPATCH=delivered
  else
    DISPATCH=failed
    report failed "$DISPATCH"
    exit "$EXIT_FAILED"
  fi
else
  echo "pulse.sh WARNING: no host command configured (argument 2, PULSE_HOST_CMD or HOST_CMD); the brief was produced and discarded, so this pulse accomplished nothing an operator can observe" >&2
fi

if [ "$DISPATCH" = none ]; then
  report ran_undispatched "$DISPATCH"
  exit "$EXIT_RAN_UNDISPATCHED"
fi

if [ "$LOCK_MECHANISM" = none ]; then
  report ran_unlocked "$DISPATCH"
  exit "$EXIT_RAN_UNLOCKED"
fi

report ran "$DISPATCH"
exit "$EXIT_RAN"
