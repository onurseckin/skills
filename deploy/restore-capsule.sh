#!/usr/bin/env bash
set -euo pipefail

# restore-capsule.sh
# Restores a capsule run from archive, verifies read-only 0444 mode preservation on prompt.md,
# validates SHA-256 artifact checksums against the manifest, and executes harness doctor
# to verify destination capsule integrity.

ARCHIVE_PATH="${1:-}"
TARGET_DEST="${2:-}"
MANIFEST_PATH="${3:-}"

if [ -z "$ARCHIVE_PATH" ] || [ -z "$TARGET_DEST" ]; then
  echo "Usage: $0 <archive-path> <target-destination-path> [manifest-path]" >&2
  exit 1
fi

if [ ! -f "$ARCHIVE_PATH" ]; then
  echo "Error: Archive file '$ARCHIVE_PATH' does not exist." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUN="${BUN_PATH:-bun}"
HARNESS="${HARNESS_PATH:-}"

if [ -z "$HARNESS" ]; then
  if [ -f "$SCRIPT_DIR/../orchestrating-long-tasks/scripts/harness.ts" ]; then
    HARNESS="$SCRIPT_DIR/../orchestrating-long-tasks/scripts/harness.ts"
  elif [ -f "$HOME/.agents/skills/orchestrating-long-tasks/scripts/harness.ts" ]; then
    HARNESS="$HOME/.agents/skills/orchestrating-long-tasks/scripts/harness.ts"
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

# Inspect top-level directory in archive
ARCHIVE_ROOT_ENTRY="$(tar -tf "$ARCHIVE_PATH" | head -n 1 | cut -d/ -f1)"

# Determine target directory
if [ -d "$TARGET_DEST" ] && [ "$(basename "$TARGET_DEST")" != "$ARCHIVE_ROOT_ENTRY" ]; then
  # Target is a parent directory (e.g. .capsules/)
  EXTRACT_PARENT="$TARGET_DEST"
  RESTORED_CAPSULE="$TARGET_DEST/$ARCHIVE_ROOT_ENTRY"
else
  # Target is the full destination path
  EXTRACT_PARENT="$(dirname "$TARGET_DEST")"
  mkdir -p "$EXTRACT_PARENT"
  EXTRACT_TEMP_NAME="$ARCHIVE_ROOT_ENTRY"
  RESTORED_CAPSULE="$TARGET_DEST"
fi

mkdir -p "$EXTRACT_PARENT"

# Extract preserving exact permission bits (-p)
tar -xzpf "$ARCHIVE_PATH" -C "$EXTRACT_PARENT"

# If extracted into a name different from TARGET_DEST, rename to match TARGET_DEST
if [ "$EXTRACT_PARENT/$ARCHIVE_ROOT_ENTRY" != "$RESTORED_CAPSULE" ] && [ -d "$EXTRACT_PARENT/$ARCHIVE_ROOT_ENTRY" ]; then
  rm -rf "$RESTORED_CAPSULE"
  mv "$EXTRACT_PARENT/$ARCHIVE_ROOT_ENTRY" "$RESTORED_CAPSULE"
fi

# Mode Bit Verification: prompt.md MUST be read-only (0444 / no write bits)
if [ -f "$RESTORED_CAPSULE/prompt.md" ]; then
  PROMPT_MODE="$(file_mode "$RESTORED_CAPSULE/prompt.md")"
  if [ -w "$RESTORED_CAPSULE/prompt.md" ]; then
    echo "INTEGRITY: prompt.md is writable (mode: $PROMPT_MODE)" >&2
    exit 3
  fi
fi

# Manifest verification if manifest exists
if [ -z "$MANIFEST_PATH" ]; then
  if [ -f "${ARCHIVE_PATH%.tar.gz}.manifest.json" ]; then
    MANIFEST_PATH="${ARCHIVE_PATH%.tar.gz}.manifest.json"
  elif [ -f "${ARCHIVE_PATH}.manifest.json" ]; then
    MANIFEST_PATH="${ARCHIVE_PATH}.manifest.json"
  fi
fi

if [ -n "$MANIFEST_PATH" ] && [ -f "$MANIFEST_PATH" ]; then
  echo "Verifying SHA-256 hashes against manifest: $MANIFEST_PATH"
  # Parse artifacts from manifest and verify each
  if command -v bun >/dev/null 2>&1; then
    bun -e '
      import fs from "node:fs";
      import crypto from "node:crypto";
      import path from "node:path";

      const manifestPath = process.argv[1];
      const capsulePath = process.argv[2];
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const artifacts = manifest.artifacts || [];

      for (const item of artifacts) {
        const filePath = path.join(capsulePath, item.path);
        if (!fs.existsSync(filePath)) {
          console.error(`Missing artifact: ${item.path}`);
          process.exit(1);
        }
        const fileBytes = fs.readFileSync(filePath);
        const actualSha = crypto.createHash("sha256").update(fileBytes).digest("hex");
        if (actualSha !== item.sha256) {
          console.error(`INTEGRITY: SHA-256 mismatch for ${item.path}: expected ${item.sha256}, got ${actualSha}`);
          process.exit(1);
        }
      }
    ' "$MANIFEST_PATH" "$RESTORED_CAPSULE"
  fi
fi

# Run doctor command if harness is available
if [ -n "$HARNESS" ] && [ -f "$HARNESS" ] && command -v "$BUN" >/dev/null 2>&1; then
  echo "Running capsule doctor validation on: $RESTORED_CAPSULE"
  "$BUN" "$HARNESS" doctor --run "$RESTORED_CAPSULE"
else
  echo "Capsule restored and validated at: $RESTORED_CAPSULE"
fi

echo "Restore completed successfully: $RESTORED_CAPSULE"
