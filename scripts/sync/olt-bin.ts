import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logDestructiveOp, smartEnsureSymlink } from "./fs-helpers.ts";

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

export function orDefault<T>(value: T | undefined, fallback: T): T {
  if (value !== undefined) {
    return value;
  }
  return fallback;
}

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

export function ensureGlobalOltBinary(options?: EnsureBinaryOptions): EnsureBinaryResult {
  const home = orDefault(options?.homeDir, homedir());
  const targetBinDir = orDefault(options?.targetBinDir, join(home, ".local", "bin"));
  const binaryPath = join(targetBinDir, "olt");
  const harnessTarget = orDefault(
    options?.harnessPath,
    "${HOME}/.agents/skills/olt/scripts/harness.ts",
  );

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
      try {
        chmodSync(binaryPath, 0o755);
      } catch {}
      writeFileSync(binaryPath, expectedContent, { encoding: "utf-8", mode: 0o755 });
      chmodSync(binaryPath, 0o755);
      status = "updated";
    }
  } else {
    writeFileSync(binaryPath, expectedContent, { encoding: "utf-8", mode: 0o755 });
    chmodSync(binaryPath, 0o755);
    status = "created";
  }

  let bunBinaryCreated = false;
  const bunBinDir = join(home, ".bun", "bin");
  if (existsSync(bunBinDir)) {
    try {
      const bunOltPath = join(bunBinDir, "olt");
      const symlinkStatus = smartEnsureSymlink(binaryPath, bunOltPath, {
        allowedRoots: [bunBinDir],
        allowGitRepositoryDeletion: true,
        onAudit: logDestructiveOp,
      });
      bunBinaryCreated = symlinkStatus === "created";
    } catch (err) {
      console.warn(`[sync] Could not link ${join(bunBinDir, "olt")}:`, err);
    }
  }

  return {
    binaryPath,
    status,
    bunBinaryCreated,
  };
}
