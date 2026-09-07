import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type SupportedHost = "antigravity" | "claude_code" | "codex" | "cursor";

export const SUPPORTED_HOSTS: readonly SupportedHost[] = [
  "antigravity",
  "claude_code",
  "codex",
  "cursor",
] as const;

export class ProvisionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProvisionError";
    this.code = code;
  }
}

export interface DetectHostOptions {
  readonly hostFlag?: string | null;
  readonly env?: Record<string, string | undefined>;
  readonly identityPath?: string;
  readonly repoRoot?: string;
}

function normalizeHostCandidate(raw: string): SupportedHost | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "antigravity" || trimmed === "agy" || trimmed === "antigravity-cli") {
    return "antigravity";
  }
  if (trimmed === "claude_code" || trimmed === "claude" || trimmed === "claude-code") {
    return "claude_code";
  }
  if (trimmed === "codex" || trimmed === "openai-codex" || trimmed === "codex-cli") {
    return "codex";
  }
  if (trimmed === "cursor" || trimmed === "cursor-ide" || trimmed === "cursor-cli") {
    return "cursor";
  }
  return null;
}

function probeEnv(env: Record<string, string | undefined>): SupportedHost | null {
  const keys = Object.keys(env);
  for (const key of keys) {
    if (key.startsWith("ANTIGRAVITY_") || key.startsWith("GEMINI_")) {
      return "antigravity";
    }
  }
  for (const key of keys) {
    if (key.startsWith("CLAUDE_CODE_") || key.startsWith("ANTHROPIC_")) {
      return "claude_code";
    }
  }
  for (const key of keys) {
    if (key.startsWith("CODEX_") || key.startsWith("OPENAI_")) {
      return "codex";
    }
  }
  for (const key of keys) {
    if (key.startsWith("CURSOR_")) {
      return "cursor";
    }
  }
  return null;
}

function probeIdentityFile(filePath: string, repoRoot?: string): SupportedHost | null {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.host === "string") {
      const normalized = normalizeHostCandidate(record.host);
      if (normalized) {
        return normalized;
      }
    }
    if (typeof record.default_host === "string") {
      const normalized = normalizeHostCandidate(record.default_host);
      if (normalized) {
        return normalized;
      }
    }
    if (record.bindings && typeof record.bindings === "object" && !Array.isArray(record.bindings)) {
      const bindings = record.bindings as Record<string, unknown>;
      if (repoRoot && bindings[repoRoot] && typeof bindings[repoRoot] === "object") {
        const repoBinding = bindings[repoRoot] as Record<string, unknown>;
        if (typeof repoBinding.host === "string") {
          const normalized = normalizeHostCandidate(repoBinding.host);
          if (normalized) {
            return normalized;
          }
        }
      }
      for (const entry of Object.values(bindings)) {
        if (entry && typeof entry === "object") {
          const entryRecord = entry as Record<string, unknown>;
          if (typeof entryRecord.host === "string") {
            const normalized = normalizeHostCandidate(entryRecord.host);
            if (normalized) {
              return normalized;
            }
          }
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function detectHost(options: DetectHostOptions = {}): SupportedHost {
  const hostFlag = options.hostFlag?.trim();
  if (hostFlag && hostFlag !== "auto") {
    const normalized = normalizeHostCandidate(hostFlag);
    if (normalized) {
      return normalized;
    }
    throw new ProvisionError(
      "UNKNOWN_HOST",
      `Unknown host "${hostFlag}". Supported hosts: ${SUPPORTED_HOSTS.join(", ")}`,
    );
  }

  const env = options.env ?? process.env;
  const envHost = probeEnv(env);
  if (envHost) {
    return envHost;
  }

  const identityPath =
    options.identityPath ?? join(homedir(), ".agents", "chatroom", "identity.json");
  const repoRoot = options.repoRoot ?? process.cwd();
  const identityHost = probeIdentityFile(identityPath, repoRoot);
  if (identityHost) {
    return identityHost;
  }

  throw new ProvisionError(
    "UNKNOWN_HOST",
    `Failed to detect host harness. Supported hosts: ${SUPPORTED_HOSTS.join(", ")}`,
  );
}
