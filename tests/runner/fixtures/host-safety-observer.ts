import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readProcessIdentity,
  sameProcessIdentity,
  type ProcessIdentity,
} from "../../../orchestrating-long-tasks/scripts/src/runner/process-identity.ts";
import { sentinelCommandArgv } from "./sentinel-argv.ts";
import { captureSentinelOutput } from "./sentinel-output.ts";

function fail(message: string, code: number): never {
  console.error(`HOST-SAFETY SENTINEL FAIL: ${message}`);
  process.exit(code);
}

function ancestry(): ProcessIdentity[] {
  const result: ProcessIdentity[] = [];
  const seen = new Set<number>();
  let cursor = process.pid;
  while (!seen.has(cursor)) {
    seen.add(cursor);
    const identity = readProcessIdentity(cursor);
    if (!identity) break;
    result.push(identity);
    if (identity.parent <= 1) break;
    cursor = identity.parent;
  }
  return result;
}

function sameUserProcesses(): ProcessIdentity[] {
  const output = execFileSync("ps", ["-axo", "uid=,pid="], {
    encoding: "utf8",
    timeout: 2_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const identities = new Map<number, ProcessIdentity>();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
    if (Number(match?.[1]) !== process.getuid?.()) continue;
    const identity = readProcessIdentity(Number(match?.[2]));
    if (identity) identities.set(identity.pid, identity);
  }
  return [...identities.values()];
}

function persistSummary(path: string, summary: Record<string, unknown>): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(summary, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temporary, path);
}

const requested = sentinelCommandArgv(process.argv);
if (requested.length === 0) fail("observer requires `-- bun test <focused files...>`", 90);
const protectedIdentities = ancestry();
const preexistingIdentities = sameUserProcesses();
const self = protectedIdentities[0];
if (!self || self.group !== self.pid) fail("observer is not an isolated process-group leader", 91);

const directory = mkdtempSync(join(tmpdir(), "harness-host-sentinel-"));
const reportPath = join(directory, "blocked-signals.jsonl");
const markerPath = join(directory, "preload-loaded.marker");
const summaryPath = join(directory, "summary.json");
const stdoutLogPath = join(directory, "stdout.log");
const stderrLogPath = join(directory, "stderr.log");
const preloadPath = join(import.meta.dir, "host-signal-preload.ts");
const command = [process.execPath, "test", "--preload", preloadPath, ...requested.slice(2)];
const summary = {
  version: 1,
  status: "started",
  started_at: new Date().toISOString(),
  observer: self,
  protected_count: preexistingIdentities.length,
  protected_ancestry: protectedIdentities,
  command,
};
persistSummary(summaryPath, summary);
const child = Bun.spawn({
  cmd: command,
  cwd: process.cwd(),
  detached: true,
  stdin: "ignore",
  stdout: "pipe",
  stderr: "pipe",
  env: {
    ...process.env,
    HARNESS_SENTINEL_PROTECTED_PIDS: JSON.stringify(preexistingIdentities.map(({ pid }) => pid)),
    HARNESS_SENTINEL_PROTECTED_GROUPS: JSON.stringify([
      ...new Set(preexistingIdentities.map(({ group }) => group)),
    ]),
    HARNESS_SENTINEL_REPORT: reportPath,
    HARNESS_SENTINEL_PRELOAD_MARKER: markerPath,
  },
});

const stdoutPromise = captureSentinelOutput(child.stdout, stdoutLogPath, (chunk) => process.stdout.write(chunk));
const stderrPromise = captureSentinelOutput(child.stderr, stderrLogPath, (chunk) => process.stderr.write(chunk));

const [exitCode, stdoutOutput, stderrOutput] = await Promise.all([
  child.exited,
  stdoutPromise,
  stderrPromise,
]);

const changed = protectedIdentities.filter(
  (expected) => !sameProcessIdentity(expected, readProcessIdentity(expected.pid)),
);
const markerValid = existsSync(markerPath) && readFileSync(markerPath, "utf8") === "loaded\n";
const events = existsSync(reportPath)
  ? readFileSync(reportPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
  : [];
const blocked = events.filter((event) => event.blocked === true);

persistSummary(summaryPath, {
  ...summary,
  status: "focused-exited",
  finished_at: new Date().toISOString(),
  exit_code: exitCode,
  preload_marker_valid: markerValid,
  signal_call_count: events.length,
  blocked_signal_count: blocked.length,
  changed_protected_pids: changed.map(({ pid }) => pid),
  output: {
    stdout: stdoutOutput,
    stderr: stderrOutput,
  },
});

if (changed.length > 0)
  fail(`protected process identity changed: ${changed.map(({ pid }) => pid).join(",")}`, 92);
if (!markerValid)
  fail(`preload marker is missing or invalid; artifacts retained at ${directory}`, 93);
if (blocked.length > 0)
  fail(
    `blocked host signal observed; artifacts retained at ${directory}:\n${JSON.stringify(blocked)}`,
    94,
  );
if (exitCode !== 0)
  fail(
    `focused test command exited ${exitCode}; artifacts retained at ${directory}`,
    exitCode || 94,
  );

console.log(
  `HOST-SAFETY SENTINEL PASS: preload active; ${preexistingIdentities.length} pre-existing identities protected; ${events.length} signal calls observed; artifacts retained at ${directory}`,
);
