import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logDestructiveOp, smartEnsureSymlink } from "./fs-helpers.ts";

export interface EnsureBinaryOptions {
  targetBinDir?: string | undefined;
  cliPath?: string | undefined;
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

export function buildChatBinaryContent(cliPath: string): string {
  return `#!/usr/bin/env bash
set -e

GLOBAL_CLI="${cliPath}"

if [ ! -f "\${GLOBAL_CLI}" ]; then
  echo "Error: Chatroom global entry point not found at \${GLOBAL_CLI}." >&2
  echo "Run 'bun run sync' in your skills repository to deploy." >&2
  exit 1
fi

BUN_BIN=""
if command -v bun >/dev/null 2>&1; then
  BUN_BIN="$(command -v bun)"
elif [ -x "\${HOME}/.bun/bin/bun" ]; then
  BUN_BIN="\${HOME}/.bun/bin/bun"
elif [ -x "/opt/homebrew/bin/bun" ]; then
  BUN_BIN="/opt/homebrew/bin/bun"
elif [ -x "/usr/local/bin/bun" ]; then
  BUN_BIN="/usr/local/bin/bun"
elif [ -x "/usr/bin/bun" ]; then
  BUN_BIN="/usr/bin/bun"
else
  echo "Error: Bun runtime not found. Please install Bun (bun.sh) or add it to PATH." >&2
  exit 1
fi

exec "\${BUN_BIN}" "\${GLOBAL_CLI}" "$@"
`;
}

export function buildChatroomBinaryContent(cliPath: string): string {
  return buildChatBinaryContent(cliPath);
}

function atomicallyWriteExecutable(targetPath: string, content: string): void {
  const nonce = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const tempPath = `${targetPath}.tmp-${nonce}`;
  try {
    writeFileSync(tempPath, content, { encoding: "utf-8", mode: 0o755 });
    chmodSync(tempPath, 0o755);
    renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {}
    throw error;
  }
}

function ensureBinaryEntry(binaryName: string, options?: EnsureBinaryOptions): EnsureBinaryResult {
  const home = orDefault(options?.homeDir, homedir());
  const targetBinDir = orDefault(options?.targetBinDir, join(home, ".local", "bin"));
  const binaryPath = join(targetBinDir, binaryName);
  const cliTarget = orDefault(
    options?.cliPath,
    orDefault(options?.harnessPath, "${HOME}/.agents/skills/chatroom/cli.ts"),
  );

  const expectedContent = buildChatroomBinaryContent(cliTarget);

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
        atomicallyWriteExecutable(binaryPath, expectedContent);
        status = "updated";
      }
    } catch {
      atomicallyWriteExecutable(binaryPath, expectedContent);
      status = "updated";
    }
  } else {
    atomicallyWriteExecutable(binaryPath, expectedContent);
    status = "created";
  }

  let bunBinaryCreated = false;
  const bunBinDir = join(home, ".bun", "bin");
  if (existsSync(bunBinDir)) {
    try {
      const bunBinaryPath = join(bunBinDir, binaryName);
      const symlinkStatus = smartEnsureSymlink(binaryPath, bunBinaryPath, {
        allowedRoots: [bunBinDir],
        allowGitRepositoryDeletion: true,
        onAudit: logDestructiveOp,
      });
      bunBinaryCreated = symlinkStatus === "created";
    } catch (err) {
      console.warn(`[sync] Could not link ${join(bunBinDir, binaryName)}:`, err);
    }
  }

  return {
    binaryPath,
    status,
    bunBinaryCreated,
  };
}

export function ensureGlobalChatroomBinary(options?: EnsureBinaryOptions): EnsureBinaryResult {
  const primaryResult = ensureBinaryEntry("chatroom", options);
  ensureBinaryEntry("chat", options);
  return primaryResult;
}

export function ensureGlobalChatBinary(options?: EnsureBinaryOptions): EnsureBinaryResult {
  ensureBinaryEntry("chatroom", options);
  return ensureBinaryEntry("chat", options);
}
