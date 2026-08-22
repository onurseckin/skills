#!/usr/bin/env bash
set -euo pipefail

# backup-capsule.sh
# Archives a capsule directory while preserving permission mode bits (0444 on prompt.md)
# and generates a manifest with SHA-256 hashes of all archived artifacts.

CAPSULE_PATH="${1:-}"
ARCHIVE_PATH="${2:-}"
MANIFEST_PATH="${3:-}"

if [ -z "$CAPSULE_PATH" ]; then
  echo "Usage: $0 <capsule-path> [output-archive-path] [manifest-path]" >&2
  exit 1
fi

if [ ! -d "$CAPSULE_PATH" ]; then
  echo "Error: Capsule directory '$CAPSULE_PATH' does not exist." >&2
  exit 1
fi

CAPSULE_PATH="$(cd "$CAPSULE_PATH" && pwd)"
RUN_ID="$(basename "$CAPSULE_PATH")"
PARENT_DIR="$(dirname "$CAPSULE_PATH")"

if [ -z "$ARCHIVE_PATH" ]; then
  ARCHIVE_PATH="${CAPSULE_PATH}.tar.gz"
fi

mkdir -p "$(dirname "$ARCHIVE_PATH")"

if [ -z "$MANIFEST_PATH" ]; then
  if [[ "$ARCHIVE_PATH" == *.tar.gz ]]; then
    MANIFEST_PATH="${ARCHIVE_PATH%.tar.gz}.manifest.json"
  else
    MANIFEST_PATH="${ARCHIVE_PATH}.manifest.json"
  fi
fi

hash_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  elif command -v bun >/dev/null 2>&1; then
    bun -e "import crypto from 'node:crypto'; import fs from 'node:fs'; console.log(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "$file"
  else
    python3 -c "import hashlib, sys; print(hashlib.sha256(open(sys.argv[1], 'rb').read()).hexdigest())" "$file"
  fi
}

file_mode() {
  local file="$1"
  if stat -f "%OLp" "$file" >/dev/null 2>&1; then
    stat -f "%04OLp" "$file"
  elif stat -c "%a" "$file" >/dev/null 2>&1; then
    stat -c "%04a" "$file"
  else
    perl -e 'printf "%04o\n", (stat(shift))[2] & 07777' "$file"
  fi
}

if [ -f "$CAPSULE_PATH/prompt.md" ]; then
  PROMPT_MODE="$(file_mode "$CAPSULE_PATH/prompt.md")"
  if [ -w "$CAPSULE_PATH/prompt.md" ]; then
    echo "INTEGRITY: prompt.md is writable (mode: $PROMPT_MODE)" >&2
  fi
fi

TMP_MANIFEST="$(mktemp -t capsule-manifest-XXXXXX 2>/dev/null || mktemp /tmp/capsule-manifest.XXXXXX)"
cleanup() {
  rm -f "$TMP_MANIFEST"
}
trap cleanup EXIT

echo "{" > "$TMP_MANIFEST"
echo "  \"schema\": \"capsule.backup.manifest\"," >> "$TMP_MANIFEST"
echo "  \"version\": 1," >> "$TMP_MANIFEST"
echo "  \"run_id\": \"$RUN_ID\"," >> "$TMP_MANIFEST"
echo "  \"created_at\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"," >> "$TMP_MANIFEST"
echo "  \"artifacts\": [" >> "$TMP_MANIFEST"

FIRST=true
while IFS= read -r -d '' file; do
  REL_PATH="${file#"$CAPSULE_PATH"/}"
  if [[ "$REL_PATH" == .locks/* ]] || [[ "$REL_PATH" == .locks ]] || [[ ! -f "$file" ]]; then
    continue
  fi
  SHA="$(hash_file "$file")"
  MODE="$(file_mode "$file")"
  SIZE="$(wc -c < "$file" 2>/dev/null | tr -d ' ' || echo 0)"

  if [ "$FIRST" = true ]; then
    FIRST=false
  else
    echo "," >> "$TMP_MANIFEST"
  fi
  printf '    {"path": "%s", "sha256": "%s", "mode": "%s", "size": %d}' "$REL_PATH" "$SHA" "$MODE" "$SIZE" >> "$TMP_MANIFEST"
done < <(find "$CAPSULE_PATH" -type f -print0 | sort -z)

echo "" >> "$TMP_MANIFEST"
echo "  ]" >> "$TMP_MANIFEST"
echo "}" >> "$TMP_MANIFEST"

mkdir -p "$(dirname "$MANIFEST_PATH")"
cp "$TMP_MANIFEST" "$MANIFEST_PATH"

tar -czpf "$ARCHIVE_PATH" -C "$PARENT_DIR" "$RUN_ID"

echo "Backup created successfully:"
echo "  Archive:  $ARCHIVE_PATH"
echo "  Manifest: $MANIFEST_PATH"
