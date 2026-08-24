import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { smartEnsureSymlink } from "./fs-helpers";

export interface EnsureBinaryOptions {
  targetBinDir?: string | undefined;
  harnessPath?: string | undefined;
  homeDir?: string | undefined;
}

export interface EnsureBinaryResult {
  binaryPath: string;
  status: "created" | "updated" | "verified";
  bunBinaryCreated?: boolean | undefined;
}

/**
 * Builds the bash executable script for the `olt` global command.
 */
export function buildOltBinaryContent(harnessPath: string): string {
  return `#!/usr/bin/env bash
set -e

GLOBAL_HARNESS="${harnessPath}"

if [ ! -f "\${GLOBAL_HARNESS}" ]; then
  echo "Error: OLT global harness not found at \${GLOBAL_HARNESS}." >&2
  echo "Run 'bun run sync' in your skills repository to deploy." >&2
  exit 1
fi

exec bun "\${GLOBAL_HARNESS}" "$@"
`;
}

/**
 * Ensures ~/.local/bin/olt (and optionally ~/.bun/bin/olt) exists, is executable (0o755),
 * and strictly delegates execution to the canonical global harness.
 */
export function ensureGlobalOltBinary(options?: EnsureBinaryOptions): EnsureBinaryResult {
  const home = options?.homeDir ?? homedir();
  const targetBinDir = options?.targetBinDir ?? join(home, ".local", "bin");
  const binaryPath = join(targetBinDir, "olt");
  const harnessTarget = options?.harnessPath ?? "${HOME}/.agents/skills/olt/scripts/harness.ts";

  const expectedContent = buildOltBinaryContent(harnessTarget);

  mkdirSync(targetBinDir, { recursive: true });

  let status: "created" | "updated" | "verified" = "created";

  if (existsSync(binaryPath)) {
    try {
      const existingContent = readFileSync(binaryPath, "utf-8");
      const stat = statSync(binaryPath);
      const isExecutable = (stat.mode & 0o111) !== 0;

      if (existingContent === expectedContent && isExecutable) {
        status = "verified";
      } else {
        writeFileSync(binaryPath, expectedContent, { encoding: "utf-8", mode: 0o755 });
        chmodSync(binaryPath, 0o755);
        status = "updated";
      }
    } catch {
      writeFileSync(binaryPath, expectedContent, { encoding: "utf-8", mode: 0o755 });
      chmodSync(binaryPath, 0o755);
      status = "updated";
    }
  } else {
    writeFileSync(binaryPath, expectedContent, { encoding: "utf-8", mode: 0o755 });
    chmodSync(binaryPath, 0o755);
    status = "created";
  }

  // Ensure ~/.bun/bin/olt is also linked if ~/.bun/bin exists
  let bunBinaryCreated = false;
  const bunBinDir = join(home, ".bun", "bin");
  if (existsSync(bunBinDir)) {
    try {
      const bunOltPath = join(bunBinDir, "olt");
      const symlinkStatus = smartEnsureSymlink(binaryPath, bunOltPath);
      bunBinaryCreated = symlinkStatus === "created";
    } catch {
      // Ignored for resilience
    }
  }

  return {
    binaryPath,
    status,
    bunBinaryCreated,
  };
}
