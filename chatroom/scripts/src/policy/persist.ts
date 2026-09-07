import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ChatError, globalPolicyPath, repoChatroomDir, repoPolicyPath } from "../core/index.ts";

export interface PolicyPorts {
  readonly existsSync?: (path: string) => boolean;
  readonly readFileSync?: (path: string, encoding: string) => string;
  readonly writeFileSync?: (path: string, content: string) => void;
  readonly mkdirSync?: (path: string, options?: { readonly recursive?: boolean }) => void;
}

export interface PersistPolicyOptions {
  readonly policyPath?: string;
  readonly repoRoot?: string;
  readonly userPolicyPath?: string;
  readonly env?: Record<string, string | undefined>;
  readonly ports?: PolicyPorts;
}

export interface PersistPolicyResult {
  readonly targetPath: string;
  readonly notify_command: string | null;
  readonly policy: Record<string, unknown>;
}

export function resolveTargetPolicyPath(options: PersistPolicyOptions = {}): string {
  if (options.policyPath && options.policyPath.trim().length > 0) {
    return options.policyPath.trim();
  }

  const exists = options.ports?.existsSync ?? existsSync;

  if (options.repoRoot && options.repoRoot.trim().length > 0) {
    const candidate = repoPolicyPath(options.repoRoot);
    const dirCandidate = repoChatroomDir(options.repoRoot);
    if (exists(candidate) || exists(dirCandidate)) {
      return candidate;
    }
  }

  const cwdCandidate = repoPolicyPath(process.cwd());
  const cwdDirCandidate = repoChatroomDir(process.cwd());
  if (exists(cwdCandidate) || exists(cwdDirCandidate)) {
    return cwdCandidate;
  }

  if (options.userPolicyPath && options.userPolicyPath.trim().length > 0) {
    return options.userPolicyPath.trim();
  }

  return globalPolicyPath();
}

export function readPolicyJson(filePath: string, ports?: PolicyPorts): Record<string, unknown> {
  const exists = ports?.existsSync ?? existsSync;
  const read = ports?.readFileSync ?? readFileSync;

  if (!exists(filePath)) {
    return {};
  }

  try {
    const raw = read(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function writePolicyJson(
  filePath: string,
  data: Record<string, unknown>,
  ports?: PolicyPorts,
): void {
  const content = JSON.stringify(data, null, 2) + "\n";
  const parentDir = dirname(filePath);

  if (ports?.writeFileSync) {
    if (ports.mkdirSync) {
      ports.mkdirSync(parentDir, { recursive: true });
    }
    ports.writeFileSync(filePath, content);
    return;
  }

  mkdirSync(parentDir, { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

export function persistNotifyCommand(
  commandOrOptions: string | (PersistPolicyOptions & { readonly command: string }),
  options?: PersistPolicyOptions,
): PersistPolicyResult {
  const command =
    typeof commandOrOptions === "string" ? commandOrOptions : commandOrOptions.command;
  const opts = typeof commandOrOptions === "string" ? (options ?? {}) : commandOrOptions;

  if (typeof command !== "string" || command.trim().length === 0) {
    throw new ChatError("INVALID_ARGUMENT", "Notify command cannot be empty");
  }

  const trimmedCommand = command.trim();
  const targetPath = resolveTargetPolicyPath(opts);
  const existing = readPolicyJson(targetPath, opts.ports);

  existing.notify_command = trimmedCommand;
  writePolicyJson(targetPath, existing, opts.ports);

  return {
    targetPath,
    notify_command: trimmedCommand,
    policy: existing,
  };
}

export function removeNotifyCommand(options: PersistPolicyOptions = {}): PersistPolicyResult {
  const targetPath = resolveTargetPolicyPath(options);
  const existing = readPolicyJson(targetPath, options.ports);

  delete existing.notify_command;
  writePolicyJson(targetPath, existing, options.ports);

  return {
    targetPath,
    notify_command: null,
    policy: existing,
  };
}

export const setNotifyCommand = persistNotifyCommand;
export const clearNotifyCommand = removeNotifyCommand;
