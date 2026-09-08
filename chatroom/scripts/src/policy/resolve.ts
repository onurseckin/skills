import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

export interface ChatroomPolicy {
  readonly runtime_command: string;
  readonly harness_path: string;
  readonly notify_command: string | null;
  readonly poll_interval_ms: number;
  readonly heartbeat_interval_ms: number;
  readonly lease_ttl_ms: number;
  readonly stale_after_ms: number;
  readonly wedge_after_ms: number;
  readonly max_spool_bytes: number;
  readonly max_spool_lines: number;
  readonly spool_retention_ms: number;
  readonly respawn_budget_per_hour: number;
  readonly batch_size: number;
  readonly test_runner: string | null;
}

export interface ResolvePolicyOptions {
  readonly repoRoot?: string;
  readonly userPolicyPath?: string;
  readonly shippedPolicyPath?: string;
  readonly env?: Record<string, string | undefined>;
  readonly probeRuntime?: boolean;
  readonly cacheProbedRuntime?: boolean;
  readonly ports?: {
    readonly existsSync?: (path: string) => boolean;
    readonly readFileSync?: (path: string, encoding: string) => string;
  };
}

export class ChatError extends Error {
  public readonly code: string;
  public readonly exitCode: number;

  public constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.name = "ChatError";
    this.code = code;
    this.exitCode = exitCode;
    Object.setPrototypeOf(this, ChatError.prototype);
  }
}

const DEFAULT_POLL_INTERVAL_MS = 750;
const MIN_POLL_INTERVAL_MS = 250;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
const DEFAULT_LEASE_TTL_MS = 120000;
const DEFAULT_STALE_AFTER_MS = 30000;
const DEFAULT_WEDGE_AFTER_MS = 60000;
const DEFAULT_MAX_SPOOL_BYTES = 33554432;
const DEFAULT_MAX_SPOOL_LINES = 20000;
const DEFAULT_SPOOL_RETENTION_MS = 86400000;
const DEFAULT_RESPAWN_BUDGET_PER_HOUR = 20;
const DEFAULT_BATCH_SIZE = 50;

function executeProbeCheck(cmd: string, args: readonly string[]): boolean {
  try {
    const result = spawnSync(cmd, args, { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function probeRuntimeCommand(): string | null {
  if (typeof process.execPath === "string" && process.execPath.length > 0) {
    const currentName = basename(process.execPath).toLowerCase();
    if (currentName.includes("bun")) {
      return "bun";
    }
    if (currentName.includes("node")) {
      return "node";
    }
    if (currentName.includes("deno")) {
      return "deno";
    }
  }

  if (executeProbeCheck("bun", ["--version"])) {
    return "bun";
  }
  if (executeProbeCheck("node", ["--version"])) {
    return "node";
  }
  if (executeProbeCheck("deno", ["--version"])) {
    return "deno";
  }

  const altRunner = "npx";
  if (executeProbeCheck(altRunner, ["tsx", "--version"])) {
    return `${altRunner} tsx`;
  }

  return null;
}

function parseJsonFile(
  filePath: string,
  ports?: {
    readonly existsSync?: (path: string) => boolean;
    readonly readFileSync?: (path: string, encoding: string) => string;
  },
): Record<string, unknown> {
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

function parseInteger(val: unknown): number | null {
  if (typeof val === "number" && Number.isFinite(val)) {
    return Math.floor(val);
  }
  if (typeof val === "string") {
    const parsed = parseInt(val.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseString(val: unknown): string | null {
  if (typeof val === "string") {
    return val;
  }
  return null;
}

function parseNullableString(val: unknown): string | null {
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.length === 0 || trimmed === "null" || trimmed === "undefined") {
      return null;
    }
    return trimmed;
  }
  return null;
}

function cacheRuntimeInUserPolicy(userPolicyPath: string, runtime: string): void {
  try {
    mkdirSync(dirname(userPolicyPath), { recursive: true });
    let existing: Record<string, unknown> = {};
    if (existsSync(userPolicyPath)) {
      const raw = readFileSync(userPolicyPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    }
    if (!existing.runtime_command) {
      existing.runtime_command = runtime;
      writeFileSync(userPolicyPath, JSON.stringify(existing, null, 2) + "\n", "utf8");
    }
  } catch {
    return;
  }
}

export function resolvePolicy(options: ResolvePolicyOptions = {}): ChatroomPolicy {
  const home = homedir();
  const repo = options.repoRoot ?? process.cwd();
  const env = options.env ?? process.env;

  const shippedPath =
    options.shippedPolicyPath ?? join(home, ".agents", "skills", "chatroom", "policy.json");
  const userPath = options.userPolicyPath ?? join(home, ".agents", "chatroom", "policy.json");
  const repoPath = join(repo, ".chatroom", "policy.json");

  const layer1 = parseJsonFile(shippedPath, options.ports);
  const layer2 = parseJsonFile(userPath, options.ports);
  const layer3 = parseJsonFile(repoPath, options.ports);

  let runtime =
    parseString(env.CHATROOM_RUNTIME_COMMAND) ??
    parseString(layer3.runtime_command) ??
    parseString(layer2.runtime_command) ??
    parseString(layer1.runtime_command);

  if ((!runtime || runtime.trim().length === 0) && options.probeRuntime !== false) {
    const probed = probeRuntimeCommand();
    if (probed !== null) {
      runtime = probed;
      if (options.cacheProbedRuntime !== false) {
        cacheRuntimeInUserPolicy(userPath, probed);
      }
    }
  }

  if (!runtime || runtime.trim().length === 0) {
    throw new ChatError(
      "RUNTIME_UNRESOLVED",
      "Could not resolve a supported JavaScript/TypeScript runtime (probed: bun, node, deno). Please configure runtime in chatroom policy.",
    );
  }

  const resolvedRuntime = runtime.trim();

  const rawHarness =
    parseString(env.CHATROOM_HARNESS_PATH) ??
    parseString(layer3.harness_path) ??
    parseString(layer2.harness_path) ??
    parseString(layer1.harness_path) ??
    join(home, ".agents", "skills", "chatroom", "scripts", "cli.ts");

  let harness = rawHarness.startsWith("~/")
    ? join(home, rawHarness.slice(2))
    : rawHarness === "~"
      ? home
      : rawHarness;

  const exists = options.ports?.existsSync ?? existsSync;
  if (!exists(harness)) {
    const localCli = join(repo, "chatroom", "scripts", "cli.ts");
    if (exists(localCli)) {
      harness = localCli;
    } else {
      const rootCli = join(repo, "chatroom", "cli.ts");
      if (exists(rootCli)) {
        harness = rootCli;
      } else {
        const localHarness = join(repo, "chatroom", "scripts", "harness.ts");
        if (exists(localHarness)) {
          harness = localHarness;
        } else {
          const rootHarness = join(repo, "chatroom", "harness.ts");
          if (exists(rootHarness)) {
            harness = rootHarness;
          }
        }
      }
    }
  }

  const notify =
    (env.CHATROOM_NOTIFY_COMMAND !== undefined
      ? parseNullableString(env.CHATROOM_NOTIFY_COMMAND)
      : undefined) ??
    (layer3.notify_command !== undefined
      ? parseNullableString(layer3.notify_command)
      : undefined) ??
    (layer2.notify_command !== undefined
      ? parseNullableString(layer2.notify_command)
      : undefined) ??
    (layer1.notify_command !== undefined
      ? parseNullableString(layer1.notify_command)
      : undefined) ??
    null;

  const rawPoll =
    parseInteger(env.CHATROOM_POLL_INTERVAL_MS) ??
    parseInteger(layer3.poll_interval_ms) ??
    parseInteger(layer2.poll_interval_ms) ??
    parseInteger(layer1.poll_interval_ms) ??
    DEFAULT_POLL_INTERVAL_MS;
  const pollInterval = Math.max(MIN_POLL_INTERVAL_MS, rawPoll);

  const heartbeatInterval =
    parseInteger(env.CHATROOM_HEARTBEAT_INTERVAL_MS) ??
    parseInteger(layer3.heartbeat_interval_ms) ??
    parseInteger(layer2.heartbeat_interval_ms) ??
    parseInteger(layer1.heartbeat_interval_ms) ??
    DEFAULT_HEARTBEAT_INTERVAL_MS;

  const leaseTtl =
    parseInteger(env.CHATROOM_LEASE_TTL_MS) ??
    parseInteger(layer3.lease_ttl_ms) ??
    parseInteger(layer2.lease_ttl_ms) ??
    parseInteger(layer1.lease_ttl_ms) ??
    DEFAULT_LEASE_TTL_MS;

  const staleAfter =
    parseInteger(env.CHATROOM_STALE_AFTER_MS) ??
    parseInteger(layer3.stale_after_ms) ??
    parseInteger(layer2.stale_after_ms) ??
    parseInteger(layer1.stale_after_ms) ??
    DEFAULT_STALE_AFTER_MS;

  const wedgeAfter =
    parseInteger(env.CHATROOM_WEDGE_AFTER_MS) ??
    parseInteger(layer3.wedge_after_ms) ??
    parseInteger(layer2.wedge_after_ms) ??
    parseInteger(layer1.wedge_after_ms) ??
    DEFAULT_WEDGE_AFTER_MS;

  const maxSpoolBytes =
    parseInteger(env.CHATROOM_MAX_SPOOL_BYTES) ??
    parseInteger(layer3.max_spool_bytes) ??
    parseInteger(layer2.max_spool_bytes) ??
    parseInteger(layer1.max_spool_bytes) ??
    DEFAULT_MAX_SPOOL_BYTES;

  const maxSpoolLines =
    parseInteger(env.CHATROOM_MAX_SPOOL_LINES) ??
    parseInteger(layer3.max_spool_lines) ??
    parseInteger(layer2.max_spool_lines) ??
    parseInteger(layer1.max_spool_lines) ??
    DEFAULT_MAX_SPOOL_LINES;

  const spoolRetention =
    parseInteger(env.CHATROOM_SPOOL_RETENTION_MS) ??
    parseInteger(layer3.spool_retention_ms) ??
    parseInteger(layer2.spool_retention_ms) ??
    parseInteger(layer1.spool_retention_ms) ??
    DEFAULT_SPOOL_RETENTION_MS;

  const respawnBudget =
    parseInteger(env.CHATROOM_RESPAWN_BUDGET_PER_HOUR) ??
    parseInteger(layer3.respawn_budget_per_hour) ??
    parseInteger(layer2.respawn_budget_per_hour) ??
    parseInteger(layer1.respawn_budget_per_hour) ??
    DEFAULT_RESPAWN_BUDGET_PER_HOUR;

  const batchSize =
    parseInteger(env.CHATROOM_BATCH_SIZE) ??
    parseInteger(layer3.batch_size) ??
    parseInteger(layer2.batch_size) ??
    parseInteger(layer1.batch_size) ??
    DEFAULT_BATCH_SIZE;

  const testRunner =
    (env.CHATROOM_TEST_RUNNER !== undefined
      ? parseNullableString(env.CHATROOM_TEST_RUNNER)
      : undefined) ??
    (layer3.test_runner !== undefined ? parseNullableString(layer3.test_runner) : undefined) ??
    (layer2.test_runner !== undefined ? parseNullableString(layer2.test_runner) : undefined) ??
    (layer1.test_runner !== undefined ? parseNullableString(layer1.test_runner) : undefined) ??
    null;

  return {
    runtime_command: resolvedRuntime,
    harness_path: harness,
    notify_command: notify,
    poll_interval_ms: pollInterval,
    heartbeat_interval_ms: heartbeatInterval,
    lease_ttl_ms: leaseTtl,
    stale_after_ms: staleAfter,
    wedge_after_ms: wedgeAfter,
    max_spool_bytes: maxSpoolBytes,
    max_spool_lines: maxSpoolLines,
    spool_retention_ms: spoolRetention,
    respawn_budget_per_hour: respawnBudget,
    batch_size: batchSize,
    test_runner: testRunner,
  };
}
