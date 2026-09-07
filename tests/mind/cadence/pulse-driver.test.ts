import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  applyPulseOutcome,
  buildLiveHealthRecord,
  emptyDriverCounters,
  observeDriverState,
  pulseDriverHealthPath,
  readDriverHealth,
  runPulseDriver,
  stepPulseDriver,
  writeDriverHealth,
  type PulseDriverConfig,
  type PulseDriverHealthRecord,
  type PulseDriverPorts,
  type PulseInvocationResult,
} from "../../../olt/scripts/src/mind/cadence/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

const RUN_ROOT = "/virtual/repo/.olt/capsules/mind-gen-1";
const NOW_MS = Date.parse("2026-09-07T18:00:00.000Z");
const LIVE_PID = 4242;

function liveRecord(overrides: Partial<PulseDriverHealthRecord> = {}): PulseDriverHealthRecord {
  const base = buildLiveHealthRecord({
    runRoot: RUN_ROOT,
    pid: LIVE_PID,
    currentPid: LIVE_PID,
    startedAtMs: NOW_MS - 60000,
    nowMs: NOW_MS,
    nextWakeAt: "2026-09-07T18:15:00.000Z",
    counters: emptyDriverCounters(),
  });
  return { ...base, ...overrides };
}

describe("pulse driver health truthfulness", () => {
  it("refuses to write a liveness record on behalf of another process", () => {
    expect(() =>
      buildLiveHealthRecord({
        runRoot: RUN_ROOT,
        pid: 999,
        currentPid: LIVE_PID,
        startedAtMs: NOW_MS,
        nowMs: NOW_MS,
        nextWakeAt: null,
        counters: emptyDriverCounters(),
      }),
    ).toThrow(/may not be written by pid/);
  });

  it("writes a record for the writing process itself", () => {
    const record = liveRecord();
    expect(record.pid).toBe(LIVE_PID);
    expect(record.last_heartbeat_at).toBe("2026-09-07T18:00:00.000Z");
    expect(record.next_wake_at).toBe("2026-09-07T18:15:00.000Z");
  });

  it("never reports a dead process as live, and never a live one as stopped", () => {
    const record = liveRecord();
    expect(observeDriverState(record, NOW_MS, { isProcessAlive: () => false })).toBe("DEAD");
    expect(observeDriverState(record, NOW_MS, { isProcessAlive: () => true })).toBe("LIVE");
  });

  it("distinguishes stale, failing and degraded from live", () => {
    const alive = { isProcessAlive: () => true };
    expect(observeDriverState(liveRecord(), NOW_MS + 3600000, alive)).toBe("STALE");
    expect(observeDriverState(liveRecord({ consecutive_failures: 3 }), NOW_MS, alive)).toBe(
      "FAILING",
    );
    expect(observeDriverState(liveRecord({ last_outcome: "ran_unlocked" }), NOW_MS, alive)).toBe(
      "DEGRADED",
    );
    expect(observeDriverState(liveRecord({ last_outcome: "skipped_locked" }), NOW_MS, alive)).toBe(
      "LIVE",
    );
  });

  it("treats an unparsable heartbeat as stale rather than live", () => {
    const record = liveRecord({ last_heartbeat_at: "whenever" });
    expect(observeDriverState(record, NOW_MS, { isProcessAlive: () => true })).toBe("STALE");
  });
});

describe("pulse driver counters", () => {
  it("advances only the counter that matches the outcome", () => {
    const ran = applyPulseOutcome(emptyDriverCounters(), "ran", 0, NOW_MS, "perl", "");
    expect(ran.pulses_ran).toBe(1);
    expect(ran.pulses_skipped_locked).toBe(0);
    expect(ran.pulses_failed).toBe(0);

    const skipped = applyPulseOutcome(ran, "skipped_locked", 75, NOW_MS, "perl", "");
    expect(skipped.pulses_ran).toBe(1);
    expect(skipped.pulses_skipped_locked).toBe(1);
    expect(skipped.pulses_failed).toBe(0);
    expect(skipped.consecutive_failures).toBe(0);
  });

  it("records failures with their evidence and resets the streak on recovery", () => {
    const failed = applyPulseOutcome(
      emptyDriverCounters(),
      "failed",
      70,
      NOW_MS,
      "perl",
      "AUTHENTICATION_FAILURE: mind:wake requires a verified caller session",
    );
    expect(failed.pulses_failed).toBe(1);
    expect(failed.consecutive_failures).toBe(1);
    expect(failed.recent_errors).toHaveLength(1);
    expect(failed.recent_errors[0]).toContain("AUTHENTICATION_FAILURE");

    const recovered = applyPulseOutcome(failed, "ran", 0, NOW_MS + 1000, "perl", "");
    expect(recovered.consecutive_failures).toBe(0);
    expect(recovered.pulses_failed).toBe(1);
  });

  it("keeps at most the five most recent errors", () => {
    let counters = emptyDriverCounters();
    for (let index = 0; index < 8; index += 1) {
      counters = applyPulseOutcome(counters, "failed", 70, NOW_MS, "perl", `boom-${index}`);
    }
    expect(counters.recent_errors).toHaveLength(5);
    expect(counters.recent_errors[4]).toBe("boom-7");
    expect(counters.consecutive_failures).toBe(8);
  });
});

describe("pulse driver health persistence", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  it("round-trips a record through the capsule runtime directory", () => {
    const record = liveRecord();
    const path = writeDriverHealth(RUN_ROOT, record);
    expect(path).toBe(pulseDriverHealthPath(RUN_ROOT));
    expect(readDriverHealth(RUN_ROOT)).toEqual(record);
  });

  it("reports no record rather than a fabricated one when nothing was written", () => {
    expect(readDriverHealth(RUN_ROOT)).toBeNull();
  });

  it("rejects unparsable and foreign-schema records instead of trusting them", () => {
    vfs.mkdirSync(`${RUN_ROOT}/runtime`, { recursive: true });
    vfs.writeFileSync(pulseDriverHealthPath(RUN_ROOT), "{ not json");
    expect(readDriverHealth(RUN_ROOT)).toBeNull();

    vfs.writeFileSync(
      pulseDriverHealthPath(RUN_ROOT),
      JSON.stringify({ ...liveRecord(), schema: "someone.elses.health/9" }),
    );
    expect(readDriverHealth(RUN_ROOT)).toBeNull();

    writeDriverHealth(RUN_ROOT, liveRecord());
    expect(readDriverHealth(RUN_ROOT)).not.toBeNull();
  });
});

describe("pulse driver step", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  const config: PulseDriverConfig = {
    runRoot: RUN_ROOT,
    pid: LIVE_PID,
    startedAtMs: NOW_MS - 5000,
    minIntervalMs: 60000,
    maxSliceMs: 60000,
  };

  function makePorts(
    nextWakeAt: string | null,
    invocation: PulseInvocationResult,
  ): { ports: PulseDriverPorts; calls: { pulses: number; sleeps: number[] } } {
    const calls = { pulses: 0, sleeps: [] as number[] };
    const ports: PulseDriverPorts = {
      now: () => NOW_MS,
      readNextWakeAt: () => nextWakeAt,
      runPulse: () => {
        calls.pulses += 1;
        return invocation;
      },
      writeHealth: (runRoot, record) => {
        writeDriverHealth(runRoot, record);
      },
      sleep: (ms) => {
        calls.sleeps.push(ms);
      },
    };
    return { ports, calls };
  }

  const ranOk: PulseInvocationResult = {
    exitCode: 0,
    lockMechanism: null,
    stderr: "pulse_status=ran pulse_lock_mechanism=perl pulse_host_dispatch=none\n",
  };

  it("sleeps without pulsing while the armed deadline is still ahead", () => {
    const { ports, calls } = makePorts("2026-09-07T18:00:30.000Z", ranOk);
    const result = stepPulseDriver(config, emptyDriverCounters(), ports);
    expect(calls.pulses).toBe(0);
    expect(calls.sleeps).toEqual([30000]);
    expect(result.outcome).toBeNull();
    expect(readDriverHealth(RUN_ROOT)?.pid).toBe(LIVE_PID);
  });

  it("pulses when the deadline has passed and records the lock mechanism it used", () => {
    const { ports, calls } = makePorts("2026-09-07T17:00:00.000Z", ranOk);
    const result = stepPulseDriver(config, emptyDriverCounters(), ports);
    expect(calls.pulses).toBe(1);
    expect(calls.sleeps).toEqual([]);
    expect(result.outcome).toBe("ran");
    expect(result.counters.pulses_ran).toBe(1);
    expect(result.counters.lock_mechanism).toBe("perl");
    expect(readDriverHealth(RUN_ROOT)?.pulses_ran).toBe(1);
  });

  it("counts a locked-out pulse as a skip, not a run and not a failure", () => {
    const { ports } = makePorts("2026-09-07T17:00:00.000Z", {
      exitCode: 75,
      lockMechanism: null,
      stderr: "pulse_status=skipped_locked pulse_lock_mechanism=perl pulse_host_dispatch=none\n",
    });
    const result = stepPulseDriver(config, emptyDriverCounters(), ports);
    expect(result.outcome).toBe("skipped_locked");
    expect(result.counters.pulses_skipped_locked).toBe(1);
    expect(result.counters.pulses_ran).toBe(0);
    expect(result.counters.pulses_failed).toBe(0);
  });

  it("records a lockless pulse as a run whose health record reads DEGRADED", () => {
    const { ports } = makePorts("2026-09-07T17:00:00.000Z", {
      exitCode: 71,
      lockMechanism: null,
      stderr: "pulse_status=ran_unlocked pulse_lock_mechanism=none pulse_host_dispatch=none\n",
    });
    const result = stepPulseDriver(config, emptyDriverCounters(), ports);
    expect(result.outcome).toBe("ran_unlocked");
    expect(result.counters.pulses_ran).toBe(1);
    expect(result.counters.lock_mechanism).toBe("none");
    expect(observeDriverState(result.health, NOW_MS, { isProcessAlive: () => true })).toBe(
      "DEGRADED",
    );
  });

  it("reads DEGRADED, never LIVE, when a pulse reached no host", () => {
    const { ports } = makePorts("2026-09-07T17:00:00.000Z", {
      exitCode: 72,
      lockMechanism: null,
      stderr: "pulse_status=ran_undispatched pulse_lock_mechanism=perl pulse_host_dispatch=none\n",
    });
    const result = stepPulseDriver(config, emptyDriverCounters(), ports);
    expect(result.outcome).toBe("ran_undispatched");
    expect(result.counters.pulses_ran).toBe(1);
    expect(result.counters.pulses_failed).toBe(0);
    expect(observeDriverState(result.health, NOW_MS, { isProcessAlive: () => true })).toBe(
      "DEGRADED",
    );
  });

  it("reads DEGRADED when the pulse held no lock, even if the outcome text says ran", () => {
    const { ports } = makePorts("2026-09-07T17:00:00.000Z", {
      exitCode: 0,
      lockMechanism: "none",
      stderr: "pulse_status=ran pulse_lock_mechanism=none pulse_host_dispatch=delivered\n",
    });
    const result = stepPulseDriver(config, emptyDriverCounters(), ports);
    expect(result.outcome).toBe("ran");
    expect(result.counters.lock_mechanism).toBe("none");
    expect(observeDriverState(result.health, NOW_MS, { isProcessAlive: () => true })).toBe(
      "DEGRADED",
    );
  });

  it("surfaces a failed pulse in the health record instead of swallowing it", () => {
    const { ports } = makePorts("2026-09-07T17:00:00.000Z", {
      exitCode: 70,
      lockMechanism: null,
      stderr: "pulse_status=failed pulse_lock_mechanism=perl pulse_host_dispatch=none\n",
    });
    const result = stepPulseDriver(config, emptyDriverCounters(), ports);
    expect(result.outcome).toBe("failed");
    expect(result.counters.pulses_failed).toBe(1);
    const persisted = readDriverHealth(RUN_ROOT);
    expect(persisted?.consecutive_failures).toBe(1);
    expect(persisted?.recent_errors[0]).toContain("pulse_status=failed");
  });

  it("keeps looping for as many iterations as the supervisor allows", () => {
    const { ports, calls } = makePorts("2026-09-07T18:00:30.000Z", ranOk);
    const result = runPulseDriver(
      config,
      emptyDriverCounters(),
      ports,
      (iteration) => iteration < 4,
    );
    expect(result.iterations).toBe(4);
    expect(calls.sleeps).toEqual([30000, 30000, 30000, 30000]);
    expect(calls.pulses).toBe(0);
  });
});
