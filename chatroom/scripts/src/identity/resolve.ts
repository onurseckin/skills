import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type IdentitySource = "explicit" | "env" | "binding" | "repo_binding";

export interface Identity {
  readonly id: string;
  readonly role: string;
  readonly host: string;
  readonly repo_hint?: string | undefined;
  readonly source: IdentitySource;
}

export interface IdentityInput {
  readonly as?: string | undefined;
  readonly explicit?: string | undefined;
  readonly id?: string | undefined;
  readonly host?: string | undefined;
  readonly role?: string | undefined;
  readonly repoHint?: string | undefined;
  readonly repo_hint?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly homeDir?: string | undefined;
  readonly readFile?: ((filePath: string) => string | undefined) | undefined;
  readonly exists?: ((filePath: string) => boolean) | undefined;
}

export class ChatError extends Error {
  public readonly code: string;
  public readonly suggestion?: string | undefined;

  public constructor(code: string, message: string, suggestion?: string) {
    super(message);
    this.name = "ChatError";
    this.code = code;
    if (suggestion !== undefined) this.suggestion = suggestion;
  }
}

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{1,62}$/;

function assertValidIdentifier(value: string, code: "INVALID_IDENTITY" | "INVALID_ROOM_ID"): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new ChatError(
      code,
      `${code === "INVALID_IDENTITY" ? "invalid member id" : "invalid room id"}: '${value}'`,
    );
  }
}

function resolveRole(input: IdentityInput): string {
  if (input.role !== undefined && input.role.trim().length > 0) return input.role.trim();
  const env = input.env ?? process.env;
  const envRole = env["CHATROOM_ROLE"];
  if (envRole !== undefined && envRole.trim().length > 0) return envRole.trim();
  return "communicator";
}

function resolveHost(input: IdentityInput): string {
  if (input.host !== undefined && input.host.trim().length > 0) return input.host.trim();
  const env = input.env ?? process.env;
  const envHost = env["CHATROOM_HOST"];
  if (envHost !== undefined && envHost.trim().length > 0) return envHost.trim();
  const probes: readonly [readonly string[], string][] = [
    [["CLAUDE_CODE_", "ANTHROPIC_"], "claude_code"],
    [["ANTIGRAVITY_", "GEMINI_"], "antigravity"],
    [["CODEX_", "OPENAI_"], "codex"],
    [["CURSOR_"], "cursor"],
  ];
  for (const key of Object.keys(env)) {
    for (const [prefixes, host] of probes) {
      if (prefixes.some((p) => key.startsWith(p))) return host;
    }
  }
  return "local";
}

function resolveRepoHint(input: IdentityInput): string | undefined {
  const explicit = input.repoHint ?? input.repo_hint ?? input.repoRoot ?? input.cwd;
  if (explicit !== undefined && explicit.trim().length > 0) return explicit.trim();
  try {
    return process.cwd();
  } catch {
    return undefined;
  }
}

function readJsonSafely(
  filePath: string,
  readFile: (p: string) => string | undefined,
  exists: (p: string) => boolean,
): unknown {
  if (!exists(filePath)) return undefined;
  try {
    const content = readFile(filePath);
    if (content === undefined || content.trim().length === 0) return undefined;
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

function extractMemberId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (typeof value !== "object" || value === null) return undefined;
  const obj = value as Record<string, unknown>;
  const candidate = obj["member_id"] ?? obj["id"] ?? obj["as"] ?? obj["memberId"] ?? obj["default"];
  if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
  return undefined;
}

function extractStringField(value: unknown, fieldName: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = (value as Record<string, unknown>)[fieldName];
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : undefined;
}

interface MatchResult {
  readonly id: string;
  readonly role?: string | undefined;
  readonly host?: string | undefined;
  readonly repo?: string | undefined;
}

function matchBindingEntry(
  entry: unknown,
  host: string,
  repo: string | undefined,
): MatchResult | undefined {
  const id = extractMemberId(entry);
  if (id === undefined) return undefined;
  return {
    id,
    role: extractStringField(entry, "role"),
    host: extractStringField(entry, "host"),
    repo: extractStringField(entry, "repo") ?? extractStringField(entry, "repo_hint"),
  };
}

function searchBindingList(
  list: readonly unknown[],
  host: string,
  repo: string | undefined,
): MatchResult | undefined {
  let fallback: MatchResult | undefined;
  for (const item of list) {
    const match = matchBindingEntry(item, host, repo);
    if (match === undefined) continue;
    if (repo !== undefined && match.repo === repo && match.host === host) return match;
    if (repo !== undefined && match.repo === repo) fallback = fallback ?? match;
    if (match.host === host) fallback = fallback ?? match;
    fallback = fallback ?? match;
  }
  return fallback;
}

function resolveFromUserIdentityJson(
  input: IdentityInput,
  readFile: (p: string) => string | undefined,
  exists: (p: string) => boolean,
  host: string,
  repo: string | undefined,
): MatchResult | undefined {
  const env = input.env ?? process.env;
  const homeDir = input.homeDir ?? env["HOME"] ?? os.homedir();
  const identityPath = path.join(homeDir, ".agents", "chatroom", "identity.json");
  const parsed = readJsonSafely(identityPath, readFile, exists);
  if (parsed === undefined) return undefined;

  if (Array.isArray(parsed)) return searchBindingList(parsed, host, repo);
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj["bindings"])) {
      const result = searchBindingList(obj["bindings"], host, repo);
      if (result !== undefined) return result;
    }
    const map =
      typeof obj["bindings"] === "object" && obj["bindings"] !== null
        ? (obj["bindings"] as Record<string, unknown>)
        : obj;
    const candidates = [repo !== undefined ? `${host}:${repo}` : undefined, repo, host, "default"];
    for (const key of candidates) {
      if (key !== undefined && key in map) {
        const id = extractMemberId(map[key]);
        if (id !== undefined) return { id, host, repo };
      }
    }
    const directId = extractMemberId(obj);
    if (directId !== undefined) {
      return {
        id: directId,
        role: extractStringField(obj, "role"),
        host: extractStringField(obj, "host"),
        repo: extractStringField(obj, "repo") ?? extractStringField(obj, "repo_hint"),
      };
    }
  }
  return undefined;
}

function resolveFromRepoBindingJson(
  input: IdentityInput,
  readFile: (p: string) => string | undefined,
  exists: (p: string) => boolean,
): MatchResult | undefined {
  const startDir =
    input.repoRoot ?? input.repoHint ?? input.repo_hint ?? input.cwd ?? resolveRepoHint(input);
  if (startDir === undefined || startDir.trim().length === 0) return undefined;
  let current = path.resolve(startDir);
  let bindingPath: string | undefined;
  while (true) {
    const candidate = path.join(current, ".chatroom", "binding.json");
    if (exists(candidate)) {
      bindingPath = candidate;
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (bindingPath === undefined) return undefined;
  const parsed = readJsonSafely(bindingPath, readFile, exists);
  if (parsed === undefined) return undefined;
  const id = extractMemberId(parsed);
  if (id === undefined) return undefined;
  return {
    id,
    role: extractStringField(parsed, "role"),
    host: extractStringField(parsed, "host"),
    repo: current,
  };
}

export function resolveIdentity(input: IdentityInput = {}): Identity {
  const readFile =
    input.readFile ??
    ((p: string) => {
      try {
        return fs.readFileSync(p, "utf-8");
      } catch {
        return undefined;
      }
    });
  const exists =
    input.exists ??
    ((p: string) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });

  const baseRole = resolveRole(input);
  const baseHost = resolveHost(input);
  const repoHint = resolveRepoHint(input);

  const explicitValue = input.as ?? input.explicit ?? input.id;
  if (explicitValue !== undefined && explicitValue.trim().length > 0) {
    const id = explicitValue.trim();
    assertValidIdentifier(id, "INVALID_IDENTITY");
    return {
      id,
      role: baseRole,
      host: baseHost,
      repo_hint: repoHint,
      source: "explicit",
    };
  }

  const env = input.env ?? process.env;
  const envAs = env["CHATROOM_AS"];
  if (envAs !== undefined && envAs.trim().length > 0) {
    const id = envAs.trim();
    assertValidIdentifier(id, "INVALID_IDENTITY");
    return {
      id,
      role: baseRole,
      host: baseHost,
      repo_hint: repoHint,
      source: "env",
    };
  }

  const userBinding = resolveFromUserIdentityJson(input, readFile, exists, baseHost, repoHint);
  if (userBinding !== undefined) {
    assertValidIdentifier(userBinding.id, "INVALID_IDENTITY");
    return {
      id: userBinding.id,
      role: userBinding.role ?? baseRole,
      host: userBinding.host ?? baseHost,
      repo_hint: userBinding.repo ?? repoHint,
      source: "binding",
    };
  }

  const repoBinding = resolveFromRepoBindingJson(input, readFile, exists);
  if (repoBinding !== undefined) {
    assertValidIdentifier(repoBinding.id, "INVALID_IDENTITY");
    return {
      id: repoBinding.id,
      role: repoBinding.role ?? baseRole,
      host: repoBinding.host ?? baseHost,
      repo_hint: repoBinding.repo ?? repoHint,
      source: "repo_binding",
    };
  }

  throw new ChatError(
    "IDENTITY_UNRESOLVED",
    "unable to resolve identity: pass --as <member-id>, set CHATROOM_AS, or configure a binding",
  );
}
