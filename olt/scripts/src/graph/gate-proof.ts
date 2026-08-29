import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isJsonObject, type JsonObject, type JsonValue } from "../core/contracts/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import { safeRmSync } from "../core/shared/safe-fs/index.ts";
import { repositoryGit, type RepositoryGitCommand } from "../packets/repository-git-command.ts";
import { hasRepositoryGitMetadata } from "../packets/repository-git-metadata.ts";
import { commandIsWeak } from "./gate-command-policy.ts";
import { normalizeScopePath } from "./scope-analyzer.ts";

export const DEFAULT_BASE_REF = "HEAD";
const MAX_SCRATCH_FILES = 50_000;
const MAX_LS_FILES_BYTES = 64 * 1024 * 1024;
const MAX_LS_TREE_BYTES = 16 * 1024 * 1024;
const MAX_BLOB_BYTES = 64 * 1024 * 1024;
const DEFAULT_GATE_TIMEOUT_MS = 5 * 60_000;
const GATE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const GATE_OUTPUT_TAIL_CHARS = 4_000;
const EXECUTABLE_BLOB_MODE = "100755";
const UNSUPPORTED_BLOB_MODES = new Set(["120000", "160000"]);

export interface GateProveInput {
  readonly repoRoot: string;
  readonly writeScope: readonly string[];
  readonly gateArgv: readonly string[];
  readonly base?: string;
  readonly wallTimeoutMs?: number;
  readonly maxFiles?: number;
}

export type GateProveOutcome = "falsifiable" | "not_falsifiable" | "refused_absent_at_base";

export interface GateProveResult {
  readonly outcome: GateProveOutcome;
  readonly falsifiable: boolean;
  readonly base: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly restoredPaths: readonly string[];
  readonly deletedPaths: readonly string[];

  readonly revertedScope: readonly string[];
  readonly copiedFileCount: number;
  readonly durationMs: number;
  readonly stdoutTail: string;
  readonly stderrTail: string;
}

interface RefEntry {
  readonly path: string;
  readonly mode: string;
}

function repoFileList(repoRoot: string, git: RepositoryGitCommand): string[] {
  const result = git(
    repoRoot,
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    MAX_LS_FILES_BYTES,
  );
  return result.bytes
    .toString("utf8")
    .split("\0")
    .filter((entry) => entry.length > 0);
}

function copyIntoScratch(repoRoot: string, scratchRoot: string, files: readonly string[]): number {
  let count = 0;
  for (const relPath of files) {
    const from = join(repoRoot, relPath);
    let stat;
    try {
      stat = lstatSync(from);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) continue;
    const to = join(scratchRoot, relPath);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    chmodSync(to, stat.mode & 0o777);
    count += 1;
  }
  copyNodeModules(repoRoot, scratchRoot);
  return count;
}

function copyDirRecursive(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const fromPath = join(from, entry.name);
    const toPath = join(to, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      copyDirRecursive(fromPath, toPath);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = lstatSync(fromPath);
    copyFileSync(fromPath, toPath);
    chmodSync(toPath, stat.mode & 0o777);
  }
}

function copyNodeModules(repoRoot: string, scratchRoot: string): void {
  const nm = join(repoRoot, "node_modules");
  if (!existsSync(nm)) return;
  copyDirRecursive(nm, join(scratchRoot, "node_modules"));
}

function refEntriesAt(
  repoRoot: string,
  ref: string,
  scopeEntry: string,
  git: RepositoryGitCommand,
): RefEntry[] {
  const result = git(repoRoot, ["ls-tree", "-r", ref, "--", scopeEntry], MAX_LS_TREE_BYTES);
  const entries: RefEntry[] = [];
  for (const line of result.bytes.toString("utf8").split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const mode = line.slice(0, tab).split(" ")[0] ?? "";
    entries.push({ mode, path: line.slice(tab + 1) });
  }
  return entries;
}

function blobContent(
  repoRoot: string,
  ref: string,
  path: string,
  git: RepositoryGitCommand,
): Buffer {
  return git(repoRoot, ["show", `${ref}:${path}`], MAX_BLOB_BYTES).bytes;
}

function filesUnderScope(scratchRoot: string, scopeEntry: string): string[] {
  const abs = join(scratchRoot, scopeEntry);
  let stat;
  try {
    stat = lstatSync(abs);
  } catch {
    return [];
  }
  if (stat.isSymbolicLink()) return [];
  if (stat.isFile()) return [scopeEntry];
  if (!stat.isDirectory()) return [];
  const found: string[] = [];
  const walk = (absDir: string, relDir: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      const absPath = join(absDir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(absPath, relPath);
        continue;
      }
      if (entry.isFile()) found.push(`${scopeEntry}/${relPath}`);
    }
  };
  walk(abs, "");
  return found;
}

function revertWriteScope(
  repoRoot: string,
  scratchRoot: string,
  base: string,
  writeScope: readonly string[],
  git: RepositoryGitCommand,
): { restoredPaths: string[]; deletedPaths: string[] } {
  const restored = new Set<string>();
  const deleted = new Set<string>();
  for (const raw of writeScope) {
    const scopeEntry = normalizeScopePath(raw);
    const atBase = refEntriesAt(repoRoot, base, scopeEntry, git);
    const keep = new Set(atBase.map((entry) => entry.path));
    for (const entry of atBase) {
      if (UNSUPPORTED_BLOB_MODES.has(entry.mode)) {
        throw new HarnessError(
          "NOT_IMPLEMENTED",
          `gate:prove cannot revert ${entry.path}: a symlink or submodule in the write scope is not supported`,
        );
      }
      const to = join(scratchRoot, entry.path);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, blobContent(repoRoot, base, entry.path, git));
      chmodSync(to, entry.mode === EXECUTABLE_BLOB_MODE ? 0o755 : 0o644);
      restored.add(entry.path);
    }
    for (const currentPath of filesUnderScope(scratchRoot, scopeEntry)) {
      if (keep.has(currentPath)) continue;
      safeRmSync(join(scratchRoot, currentPath), {
        allowedRoots: [scratchRoot],
        missingOk: true,
      });
      deleted.add(currentPath);
    }
  }
  return { restoredPaths: [...restored].sort(), deletedPaths: [...deleted].sort() };
}

export interface GateSpawnResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}
export type GateSpawn = (
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
) => GateSpawnResult;

const GATE_ENV_PASSTHROUGH = [
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "TMPDIR",
  "TZ",
  "HOME",
  "SHELL",
] as const;

function gateEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of GATE_ENV_PASSTHROUGH) {
    const value = source[key];
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  env.GIT_TERMINAL_PROMPT = "0";
  env.CI = "1";
  env.TERM = "dumb";
  env.FORCE_COLOR = "0";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_AUTHOR_NAME = "test";
  env.GIT_AUTHOR_EMAIL = "test@example.com";
  env.GIT_COMMITTER_NAME = "test";
  env.GIT_COMMITTER_EMAIL = "test@example.com";
  return env;
}

const SHELL_COMPOUND_OPERATORS: ReadonlySet<string> = new Set(["&&", "||", ";"]);

export const nodeSpawnGate: GateSpawn = (argv, cwd, timeoutMs) => {
  const compoundToken = argv.find((token) => SHELL_COMPOUND_OPERATORS.has(token));
  if (compoundToken !== undefined) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `gate argv contains "${compoundToken}", a shell compound operator; gate:prove runs argv ` +
        "directly with no shell (shell:false), so it cannot honor a compound command. Split it " +
        "into separate gates, or move it into an explicit script file that is itself part of the " +
        "task's write scope so gate:prove reverts it along with the rest of the change.",
    );
  }
  const result = spawnSync(argv[0]!, argv.slice(1), {
    cwd,
    env: gateEnvironment(process.env),
    encoding: "utf8",
    shell: false,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: GATE_MAX_OUTPUT_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  if (result.error && !timedOut) {
    throw new HarnessError("INTEGRITY", `gate command failed to start: ${result.error.message}`);
  }
  return {
    status: timedOut ? null : (result.status ?? null),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut,
  };
};

function tail(text: string): string {
  return text.length > GATE_OUTPUT_TAIL_CHARS ? text.slice(-GATE_OUTPUT_TAIL_CHARS) : text;
}

export interface GateProveDependencies {
  git?: RepositoryGitCommand;
  spawn?: GateSpawn;
}

interface EffectiveRevertScope {
  readonly scope: readonly string[];

  readonly gateTargetUnexcludable: boolean;
}

function effectiveRevertScope(
  writeScope: readonly string[],
  gateArgv: readonly string[],
): EffectiveRevertScope {
  const isBunTest = gateArgv.length >= 2 && gateArgv[0] === "bun" && gateArgv[1] === "test";
  const isOtherTest =
    gateArgv.length >= 2 &&
    (gateArgv[0] === "vitest" || gateArgv[0] === "jest" || gateArgv[0] === "pytest");
  if (!isBunTest && !isOtherTest) return { scope: writeScope, gateTargetUnexcludable: false };

  const rawTestPaths = isBunTest ? gateArgv.slice(2) : gateArgv.slice(1);
  const gateTestPaths = rawTestPaths.filter((arg) => !arg.startsWith("-")).map(normalizeScopePath);

  const nonTestScope = writeScope.filter(
    (raw) =>
      !raw.startsWith("tests/") &&
      !raw.includes(".test.") &&
      !raw.includes(".spec.") &&
      !raw.includes("__tests__"),
  );
  if (nonTestScope.length === 0) {
    return { scope: writeScope, gateTargetUnexcludable: true };
  }

  const filtered = writeScope.filter((raw) => {
    const norm = normalizeScopePath(raw);
    return !gateTestPaths.some((testPath) => testPath === norm || testPath.startsWith(`${norm}/`));
  });
  if (filtered.length === 0) {
    return { scope: writeScope, gateTargetUnexcludable: true };
  }
  return { scope: filtered, gateTargetUnexcludable: false };
}

export function proveGateFalsifiable(
  input: GateProveInput,
  deps: GateProveDependencies = {},
): GateProveResult {
  if (input.writeScope.length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "gate:prove needs a non-empty write scope to revert",
    );
  }
  if (input.gateArgv.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "gate:prove needs a gate command to run");
  }
  if (commandIsWeak(input.gateArgv)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `gate argv ${JSON.stringify(input.gateArgv)} fails the gate-command-policy at the execution boundary; gate:prove refuses to spawn it`,
    );
  }
  const git = deps.git ?? repositoryGit;
  const spawn = deps.spawn ?? nodeSpawnGate;
  const repoRoot = resolve(input.repoRoot);
  if (!hasRepositoryGitMetadata(repoRoot)) {
    throw new HarnessError(
      "INVALID_STATE",
      `${repoRoot} is not inside a Git repository; gate:prove needs history to revert against`,
    );
  }
  const base = input.base?.trim() || DEFAULT_BASE_REF;
  const maxFiles = input.maxFiles ?? MAX_SCRATCH_FILES;

  const scratchRoot = realpathSync(mkdtempSync(join(tmpdir(), "gate-prove-")));
  try {
    const files = repoFileList(repoRoot, git);
    if (files.length > maxFiles) {
      throw new HarnessError(
        "INVALID_STATE",
        `repository carries ${files.length} tracked/untracked files, over the ${maxFiles} gate:prove will copy; pass a narrower --max-files or prove this gate by hand`,
      );
    }
    const copiedFileCount = copyIntoScratch(repoRoot, scratchRoot, files);
    const { scope: revertScope, gateTargetUnexcludable } = effectiveRevertScope(
      input.writeScope,
      input.gateArgv,
    );
    const { restoredPaths, deletedPaths } = revertWriteScope(
      repoRoot,
      scratchRoot,
      base,
      revertScope,
      git,
    );

    if (gateTargetUnexcludable && restoredPaths.length === 0) {
      const startedAt = Date.now();
      return {
        outcome: "refused_absent_at_base",
        falsifiable: false,
        base,
        exitCode: null,
        timedOut: false,
        restoredPaths,
        deletedPaths,
        revertedScope: revertScope,
        copiedFileCount,
        durationMs: Date.now() - startedAt,
        stdoutTail: "",
        stderrTail: "",
      };
    }
    const startedAt = Date.now();
    const run = spawn(input.gateArgv, scratchRoot, input.wallTimeoutMs ?? DEFAULT_GATE_TIMEOUT_MS);
    const falsifiable = run.status !== null && run.status !== 0;
    return {
      outcome: falsifiable ? "falsifiable" : "not_falsifiable",
      falsifiable,
      base,
      exitCode: run.status,
      timedOut: run.timedOut,
      restoredPaths,
      deletedPaths,
      revertedScope: revertScope,
      copiedFileCount,
      durationMs: Date.now() - startedAt,
      stdoutTail: tail(run.stdout),
      stderrTail: tail(run.stderr),
    };
  } finally {
    safeRmSync(scratchRoot, { allowedRoots: [dirname(scratchRoot)], missingOk: true });
  }
}

export interface GateProofRecord extends JsonObject {
  task_id: string;
  gate_argv: string[];
  write_scope: string[];
  base: string;
  falsifiable: boolean;
  exit_code: number | null;
  timed_out: boolean;
  proved_at: string;
  actor: string;

  outcome?: GateProveOutcome;
  restored_paths?: string[];
  deleted_paths?: string[];
  reverted_scope?: string[];
  stdout_tail?: string;
  stderr_tail?: string;
}

const GATE_PROOFS_KEY = "gate_proofs";

const GATE_PROVE_OUTCOMES: ReadonlySet<string> = new Set<GateProveOutcome>([
  "falsifiable",
  "not_falsifiable",
  "refused_absent_at_base",
]);

function isGateProveOutcome(value: JsonValue): value is GateProveOutcome {
  return typeof value === "string" && GATE_PROVE_OUTCOMES.has(value);
}

function isOptionalStringArrayField(value: JsonValue | undefined): boolean {
  return value === undefined || (Array.isArray(value) && value.every((v) => typeof v === "string"));
}

function isOptionalStringField(value: JsonValue | undefined): boolean {
  return value === undefined || typeof value === "string";
}

function isGateProofRecord(value: JsonValue): value is GateProofRecord {
  return (
    isJsonObject(value) &&
    typeof value.task_id === "string" &&
    typeof value.falsifiable === "boolean" &&
    Array.isArray(value.gate_argv) &&
    (value.outcome === undefined || isGateProveOutcome(value.outcome)) &&
    isOptionalStringArrayField(value.restored_paths) &&
    isOptionalStringArrayField(value.deleted_paths) &&
    isOptionalStringArrayField(value.reverted_scope) &&
    isOptionalStringField(value.stdout_tail) &&
    isOptionalStringField(value.stderr_tail)
  );
}

export function readGateProofs(state: JsonObject): readonly GateProofRecord[] {
  const raw = state[GATE_PROOFS_KEY];
  return Array.isArray(raw) ? raw.filter(isGateProofRecord) : [];
}

export function appendGateProof(state: JsonObject, record: GateProofRecord): void {
  state[GATE_PROOFS_KEY] = [...readGateProofs(state), record] as unknown as JsonValue;
}

export function latestGateProof(
  state: JsonObject,
  taskId: string,
  gateArgv: readonly string[],
): GateProofRecord | undefined {
  const argvKey = gateArgv.join(" ");
  const records = readGateProofs(state).filter(
    (record) => record.task_id === taskId && record.gate_argv.join(" ") === argvKey,
  );
  return records.at(-1);
}
