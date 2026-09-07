import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  buildLiveHealthRecord,
  classifyPulseExit,
  describePulseOutcome,
  emptyDriverCounters,
  isPulseOutcomeDegraded,
  isPulseOutcomePageworthy,
  observeDriverState,
  pulseDriverHealthPath,
  readDriverHealth,
  runPulseDriver,
  writeDriverHealth,
  type PulseDriverPorts,
  type PulseInvocationResult,
} from "./src/mind/cadence/index.ts";

const SCRIPT_DIR = import.meta.dir;
const PULSE_SCRIPT = join(SCRIPT_DIR, "pulse.sh");

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const err = error as { code?: string };
    return err?.code === "EPERM";
  }
}

function readArg(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) return null;
  return argv[index + 1] ?? null;
}

function readIntArg(argv: readonly string[], name: string, fallback: number): number {
  const raw = readArg(argv, name);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNextWakeAt(runRoot: string): string | null {
  const path = join(runRoot, "last_pulse.json");
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed === null || typeof parsed !== "object") return null;
    const value = (parsed as Record<string, unknown>)["next_wake_at"];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function invokePulse(runRoot: string): PulseInvocationResult {
  const result = spawnSync("bash", [PULSE_SCRIPT, runRoot], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    exitCode: result.status,
    lockMechanism: null,
    stderr: `${result.stderr ?? ""}${result.error ? String(result.error.message) : ""}`,
  };
}

function driverLockPath(runRoot: string): string {
  return join(runRoot, ".locks", "mind.driver");
}

function acquireDriverLock(runRoot: string): number {
  const path = driverLockPath(runRoot);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    let holder = 0;
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      const pid = (parsed as Record<string, unknown>)["pid"];
      if (typeof pid === "number") holder = pid;
    } catch {
      holder = 0;
    }
    if (holder > 0 && isProcessAlive(holder)) {
      throw new Error(`pulse driver already running for ${runRoot} as pid ${holder}`);
    }
    unlinkSync(path);
  }
  const fd = openSync(path, "wx", 0o644);
  const payload = `${JSON.stringify({ pid: process.pid, run_root: runRoot, acquired_at: new Date().toISOString() }, null, 2)}\n`;
  writeSync(fd, Buffer.from(payload, "utf8"));
  return fd;
}

function releaseDriverLock(runRoot: string, fd: number | null): void {
  try {
    if (fd !== null) closeSync(fd);
  } catch {}
  try {
    const path = driverLockPath(runRoot);
    if (existsSync(path)) unlinkSync(path);
  } catch {}
}

function blockingSleep(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function printStatus(runRoot: string): number {
  const record = readDriverHealth(runRoot);
  if (record === null) {
    process.stdout.write(
      `pulse driver: NO HEALTH RECORD at ${pulseDriverHealthPath(runRoot)}\nNo driver has ever run against this capsule.\n`,
    );
    return 1;
  }
  const state = observeDriverState(record, Date.now(), { isProcessAlive });
  const lines = [
    `pulse driver: ${state}`,
    `run_root            ${record.run_root}`,
    `pid                 ${record.pid}`,
    `started_at          ${record.started_at}`,
    `last_heartbeat_at   ${record.last_heartbeat_at}`,
    `last_attempt_at     ${record.last_attempt_at ?? "-"}`,
    `last_outcome        ${record.last_outcome ?? "-"}`,
    `lock_mechanism      ${record.lock_mechanism ?? "-"}`,
    `next_wake_at        ${record.next_wake_at ?? "-"}`,
    `pulses ran/skip/err ${record.pulses_ran}/${record.pulses_skipped_locked}/${record.pulses_failed}`,
    `consecutive_failures ${record.consecutive_failures}`,
  ];
  for (const error of record.recent_errors) lines.push(`error               ${error}`);
  process.stdout.write(`${lines.join("\n")}\n`);
  return state === "LIVE" || state === "DEGRADED" ? 0 : 1;
}

function main(): number {
  const argv = process.argv.slice(2);
  const runRoot = resolve(readArg(argv, "--run") ?? ".olt/capsules/mind-gen-1");

  if (argv.includes("--status")) return printStatus(runRoot);

  if (!argv.includes("--foreground")) {
    process.stderr.write(
      "pulse-driver requires --foreground. It is a supervised foreground process: start it detached from a supervisor that survives your session, do not fork it here.\n",
    );
    return 2;
  }

  const minIntervalMs = readIntArg(argv, "--min-interval", 60000);
  const maxSliceMs = readIntArg(argv, "--max-slice", 60000);
  const maxIterations = readIntArg(argv, "--max-iterations", 0);
  const startedAtMs = Date.now();

  let lockFd: number | null = null;
  try {
    lockFd = acquireDriverLock(runRoot);
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 3;
  }

  const release = (): void => releaseDriverLock(runRoot, lockFd);
  process.on("SIGTERM", () => {
    release();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    release();
    process.exit(0);
  });

  writeDriverHealth(
    runRoot,
    buildLiveHealthRecord({
      runRoot,
      pid: process.pid,
      currentPid: process.pid,
      startedAtMs,
      nowMs: startedAtMs,
      nextWakeAt: readNextWakeAt(runRoot),
      counters: emptyDriverCounters(),
    }),
  );

  const ports: PulseDriverPorts = {
    now: () => Date.now(),
    readNextWakeAt,
    runPulse: invokePulse,
    writeHealth: (root, record) => {
      writeDriverHealth(root, record);
    },
    sleep: blockingSleep,
  };

  process.stderr.write(
    `pulse-driver LIVE pid=${process.pid} run=${runRoot} min_interval_ms=${minIntervalMs} max_slice_ms=${maxSliceMs}\n`,
  );

  const loggingPorts: PulseDriverPorts = {
    ...ports,
    runPulse: (root) => {
      const invocation = invokePulse(root);
      const outcome = classifyPulseExit(invocation.exitCode);
      process.stderr.write(
        `pulse-driver attempt exit=${invocation.exitCode ?? "null"} outcome=${outcome}\n${invocation.stderr}`,
      );
      if (isPulseOutcomePageworthy(outcome)) {
        process.stderr.write(
          `pulse-driver PULSE FAILED: ${describePulseOutcome(outcome)}; the health record carries the failure\n`,
        );
      }
      if (isPulseOutcomeDegraded(outcome)) {
        process.stderr.write(`pulse-driver DEGRADED: ${describePulseOutcome(outcome)}\n`);
      }
      return invocation;
    },
  };

  try {
    runPulseDriver(
      { runRoot, pid: process.pid, startedAtMs, minIntervalMs, maxSliceMs },
      emptyDriverCounters(),
      loggingPorts,
      (iteration) => maxIterations === 0 || iteration < maxIterations,
    );
  } finally {
    release();
  }
  return 0;
}

process.exit(main());
