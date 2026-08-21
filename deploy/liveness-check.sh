#!/usr/bin/env bash
set -euo pipefail

# deploy/liveness-check.sh
# External uptime check script running off-box per PHASE-6 §3.5.
#
# Reads .capsules/<run-id>/last_pulse.json, calculates pulse age against
# the configured interval + grace threshold (default 15m + 5m = 20m / 1200s),
# and distinguishes between healthy, stale (paging owner), and check failures.
#
# Exit Codes:
#   0 - Healthy: pulse heartbeat is fresh (within interval + grace)
#   2 - Stale: pulse heartbeat exceeded threshold (pages owner)
#   3 - Check Failure: pulse record is missing, corrupted, or unreadable

DEFAULT_INTERVAL_SEC=900 # 15 minutes
DEFAULT_GRACE_SEC=300    # 5 minutes
DEFAULT_MAX_AGE_SEC=$(( DEFAULT_INTERVAL_SEC + DEFAULT_GRACE_SEC )) # 1200 seconds (20 minutes)

TARGET_PATH=""
THRESHOLD_SEC=""
PAGER_CMD="${PAGER_COMMAND:-}"
NOW_PARAM="${NOW_TIMESTAMP:-}"

# Parse command line flags or positional arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --capsule|--run|-c)
      TARGET_PATH="$2"
      shift 2
      ;;
    --pulse|-p)
      TARGET_PATH="$2"
      shift 2
      ;;
    --threshold|-t)
      THRESHOLD_SEC="$2"
      shift 2
      ;;
    --interval|-i)
      DEFAULT_INTERVAL_SEC="$2"
      shift 2
      ;;
    --grace|-g)
      DEFAULT_GRACE_SEC="$2"
      shift 2
      ;;
    --pager)
      PAGER_CMD="$2"
      shift 2
      ;;
    --now)
      NOW_PARAM="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [capsule-dir-or-pulse-file] [max-age-seconds]"
      echo ""
      echo "Options:"
      echo "  --capsule, -c <path>    Path to capsule directory or last_pulse.json"
      echo "  --threshold, -t <sec>   Maximum allowed heartbeat age in seconds (default: 1200)"
      echo "  --interval, -i <sec>    Heartbeat interval in seconds (default: 900)"
      echo "  --grace, -g <sec>       Grace period in seconds (default: 300)"
      echo "  --pager <command>       Command to execute on stale heartbeat"
      echo "  --now <timestamp>       Override current time (ISO-8601 or unix epoch seconds)"
      echo ""
      echo "Exit codes: 0 = healthy, 2 = stale (alert/page), 3 = check failure"
      exit 0
      ;;
    *)
      if [ -z "$TARGET_PATH" ]; then
        TARGET_PATH="$1"
      elif [ -z "$THRESHOLD_SEC" ]; then
        THRESHOLD_SEC="$1"
      fi
      shift
      ;;
  esac
done

# Default path resolution
if [ -z "$TARGET_PATH" ]; then
  if [ -f "last_pulse.json" ]; then
    TARGET_PATH="last_pulse.json"
  elif [ -d ".capsules/mind-gen-1" ]; then
    TARGET_PATH=".capsules/mind-gen-1"
  elif [ -d ".capsules" ]; then
    FIRST_CAPSULE="$(find .capsules -maxdepth 1 -mindepth 1 -type d | head -n 1)"
    if [ -n "$FIRST_CAPSULE" ]; then
      TARGET_PATH="$FIRST_CAPSULE"
    else
      TARGET_PATH=".capsules/mind-gen-1"
    fi
  else
    TARGET_PATH=".capsules/mind-gen-1"
  fi
fi

# Resolve file path
if [ -d "$TARGET_PATH" ]; then
  PULSE_FILE="$TARGET_PATH/last_pulse.json"
else
  PULSE_FILE="$TARGET_PATH"
fi

# Calculate effective threshold
if [ -z "$THRESHOLD_SEC" ]; then
  if [ -n "${MAX_AGE_SEC:-}" ]; then
    THRESHOLD_SEC="$MAX_AGE_SEC"
  elif [ -n "${PULSE_INTERVAL_SEC:-}" ] || [ -n "${PULSE_GRACE_SEC:-}" ]; then
    INT_SEC="${PULSE_INTERVAL_SEC:-$DEFAULT_INTERVAL_SEC}"
    GRC_SEC="${PULSE_GRACE_SEC:-$DEFAULT_GRACE_SEC}"
    THRESHOLD_SEC=$(( INT_SEC + GRC_SEC ))
  else
    THRESHOLD_SEC=$(( DEFAULT_INTERVAL_SEC + DEFAULT_GRACE_SEC ))
  fi
fi

# Step 1: Check existence of pulse record file
if [ ! -f "$PULSE_FILE" ]; then
  echo "[LIVENESS CHECK FAILURE] pulse record missing at '$PULSE_FILE'" >&2
  exit 3
fi

# Step 2: Parse pulse record using available runtime (bun, node, python3, or jq)
PARSED_DATA=""

if command -v bun >/dev/null 2>&1; then
  PARSED_DATA="$(bun -e '
    import fs from "node:fs";
    const filePath = process.argv[1];
    const nowOverride = process.argv[2];
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        process.exit(1);
      }
      const ts = obj.closed_at || obj.at || obj.started_at || obj.opened_at;
      if (!ts) process.exit(2);
      const pulseTimeMs = Date.parse(ts);
      if (!Number.isFinite(pulseTimeMs)) process.exit(2);
      
      let nowMs = Date.now();
      if (nowOverride) {
        const parsedNow = /^\d+$/.test(nowOverride) ? parseInt(nowOverride, 10) * 1000 : Date.parse(nowOverride);
        if (Number.isFinite(parsedNow)) nowMs = parsedNow;
      }
      
      const pulseId = obj.pulse_id || "unknown";
      const outcome = obj.outcome || "unknown";
      const nextWake = obj.next_wake_at || "";
      const ageSec = Math.round((nowMs - pulseTimeMs) / 1000);
      console.log(`${pulseId}\t${outcome}\t${ts}\t${nextWake}\t${ageSec}`);
    } catch (e) {
      process.exit(1);
    }
  ' "$PULSE_FILE" "$NOW_PARAM" 2>/dev/null)" || {
    EXIT_STATUS=$?
    echo "[LIVENESS CHECK FAILURE] pulse record corrupted or unreadable at '$PULSE_FILE' (code $EXIT_STATUS)" >&2
    exit 3
  }
elif command -v node >/dev/null 2>&1; then
  PARSED_DATA="$(node -e '
    const fs = require("fs");
    const filePath = process.argv[1];
    const nowOverride = process.argv[2];
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        process.exit(1);
      }
      const ts = obj.closed_at || obj.at || obj.started_at || obj.opened_at;
      if (!ts) process.exit(2);
      const pulseTimeMs = Date.parse(ts);
      if (!Number.isFinite(pulseTimeMs)) process.exit(2);
      
      let nowMs = Date.now();
      if (nowOverride) {
        const parsedNow = /^\d+$/.test(nowOverride) ? parseInt(nowOverride, 10) * 1000 : Date.parse(nowOverride);
        if (Number.isFinite(parsedNow)) nowMs = parsedNow;
      }
      
      const pulseId = obj.pulse_id || "unknown";
      const outcome = obj.outcome || "unknown";
      const nextWake = obj.next_wake_at || "";
      const ageSec = Math.round((nowMs - pulseTimeMs) / 1000);
      console.log(`${pulseId}\t${outcome}\t${ts}\t${nextWake}\t${ageSec}`);
    } catch (e) {
      process.exit(1);
    }
  ' "$PULSE_FILE" "$NOW_PARAM" 2>/dev/null)" || {
    echo "[LIVENESS CHECK FAILURE] pulse record corrupted or unreadable at '$PULSE_FILE'" >&2
    exit 3
  }
elif command -v python3 >/dev/null 2>&1; then
  PARSED_DATA="$(python3 -c '
import json, sys, datetime, os

file_path = sys.argv[1]
now_param = sys.argv[2]

try:
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        sys.exit(1)
    
    ts = data.get("closed_at") or data.get("at") or data.get("started_at") or data.get("opened_at")
    if not ts:
        sys.exit(2)
    
    # parse timestamp
    clean_ts = ts.replace("Z", "+00:00")
    pulse_dt = datetime.datetime.fromisoformat(clean_ts)
    pulse_epoch = pulse_dt.timestamp()
    
    if now_param:
        if now_param.isdigit():
            now_epoch = float(now_param)
        else:
            now_epoch = datetime.datetime.fromisoformat(now_param.replace("Z", "+00:00")).timestamp()
    else:
        now_epoch = datetime.datetime.now(datetime.timezone.utc).timestamp()
    
    age_sec = int(round(now_epoch - pulse_epoch))
    pulse_id = data.get("pulse_id") or "unknown"
    outcome = data.get("outcome") or "unknown"
    next_wake = data.get("next_wake_at") or ""
    print(f"{pulse_id}\t{outcome}\t{ts}\t{next_wake}\t{age_sec}")
except Exception:
    sys.exit(1)
' "$PULSE_FILE" "$NOW_PARAM" 2>/dev/null)" || {
    echo "[LIVENESS CHECK FAILURE] pulse record corrupted or unreadable at '$PULSE_FILE'" >&2
    exit 3
  }
else
  # Minimal shell/grep fallback
  if ! grep -q "{" "$PULSE_FILE"; then
    echo "[LIVENESS CHECK FAILURE] pulse record corrupted at '$PULSE_FILE'" >&2
    exit 3
  fi
  PULSE_ID="$(grep -o '"pulse_id"[[:space:]]*:[[:space:]]*"[^"]*"' "$PULSE_FILE" | cut -d'"' -f4 || echo "unknown")"
  OUTCOME="$(grep -o '"outcome"[[:space:]]*:[[:space:]]*"[^"]*"' "$PULSE_FILE" | cut -d'"' -f4 || echo "unknown")"
  TS="$(grep -o '"\(closed_at\|at\|started_at\|opened_at\)"[[:space:]]*:[[:space:]]*"[^"]*"' "$PULSE_FILE" | head -n 1 | cut -d'"' -f4 || true)"
  if [ -z "$TS" ]; then
    echo "[LIVENESS CHECK FAILURE] pulse record missing timestamp at '$PULSE_FILE'" >&2
    exit 3
  fi
  # Simple epoch comparison if date command supports it
  PULSE_EPOCH="$(date -j -f "%Y-%m-%dT%H:%M:%S" "${TS:0:19}" "+%s" 2>/dev/null || date -d "$TS" "+%s" 2>/dev/null || echo "")"
  if [ -z "$PULSE_EPOCH" ]; then
    echo "[LIVENESS CHECK FAILURE] cannot parse timestamp '$TS' at '$PULSE_FILE'" >&2
    exit 3
  fi
  NOW_EPOCH="$(date "+%s")"
  AGE_SEC=$(( NOW_EPOCH - PULSE_EPOCH ))
  PARSED_DATA="${PULSE_ID}\t${OUTCOME}\t${TS}\t\t${AGE_SEC}"
fi

if [ -z "$PARSED_DATA" ]; then
  echo "[LIVENESS CHECK FAILURE] failed to extract pulse metadata from '$PULSE_FILE'" >&2
  exit 3
fi

PULSE_ID="$(echo "$PARSED_DATA" | cut -f1)"
OUTCOME="$(echo "$PARSED_DATA" | cut -f2)"
TIMESTAMP="$(echo "$PARSED_DATA" | cut -f3)"
NEXT_WAKE="$(echo "$PARSED_DATA" | cut -f4)"
AGE_SEC="$(echo "$PARSED_DATA" | cut -f5)"

# Step 3: Evaluate freshness against threshold
if [ "$AGE_SEC" -le "$THRESHOLD_SEC" ]; then
  echo "[LIVENESS OK] Heartbeat fresh. Pulse: ${PULSE_ID}, Outcome: ${OUTCOME}, Timestamp: ${TIMESTAMP}, Age: ${AGE_SEC}s (threshold: ${THRESHOLD_SEC}s)"
  exit 0
else
  echo "[LIVENESS STALE - PAGING OWNER] Heartbeat stale! Pulse: ${PULSE_ID}, Outcome: ${OUTCOME}, Timestamp: ${TIMESTAMP}, Age: ${AGE_SEC}s > threshold: ${THRESHOLD_SEC}s" >&2
  if [ -n "$PAGER_CMD" ]; then
    echo "Executing pager alert: $PAGER_CMD" >&2
    eval "$PAGER_CMD" || true
  fi
  exit 2
fi
