import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  buildProcessDiagnostics,
  trimChunks,
} from "../../../olt/scripts/src/watchdog/process-timeout/diagnostics.ts";
import { cleanupVirtualWatchdogFS, setupVirtualWatchdogFS } from "../watchdog-fixture.ts";

beforeEach(() => {
  setupVirtualWatchdogFS();
});

afterEach(() => {
  cleanupVirtualWatchdogFS();
});

describe("ProcessDiagnostics & Buffer Tail Trimming", () => {
  it("trimChunks preserves the most recent chunks within maxTailBytes limit", () => {
    const chunks = ["chunk1-10b-", "chunk2-10b-", "chunk3-10b-", "chunk4-10b-"];
    trimChunks(chunks, 22);

    expect(chunks.length).toBe(3);
    expect(chunks).toEqual(["chunk2-10b-", "chunk3-10b-", "chunk4-10b-"]);
  });

  it("trimChunks keeps all chunks if total length is below maxTailBytes", () => {
    const chunks = ["a", "b", "c"];
    trimChunks(chunks, 100);
    expect(chunks).toEqual(["a", "b", "c"]);
  });

  it("buildProcessDiagnostics constructs complete diagnostic structure with slice boundaries", () => {
    const stdoutChunks = ["line 1\n", "line 2\n", "line 3\n"];
    const stderrChunks = ["err 1\n", "err 2\n"];
    const nowMs = 1700000050000;

    const diag = buildProcessDiagnostics({
      stdoutChunks,
      stderrChunks,
      totalStdoutBytes: 21,
      totalStderrBytes: 12,
      maxTailBytes: 10,
      startedAtMs: 1700000000000,
      lastActivityAtMs: 1700000040000,
      lastProgressAtMs: 1700000020000,
      lastHeartbeatAtMs: 1700000030000,
      signalsSent: ["SIGTERM", "SIGKILL"],
      pid: 12345,
      ppid: 11111,
      nowMs,
    });

    expect(diag.stdoutTail).toBe(" 2\nline 3\n");
    expect(diag.stderrTail).toBe("r 1\nerr 2\n");
    expect(diag.stdoutBytes).toBe(21);
    expect(diag.stderrBytes).toBe(12);
    expect(diag.durationMs).toBe(50000);
    expect(diag.idleDurationMs).toBe(10000);
    expect(diag.progressStallDurationMs).toBe(30000);
    expect(diag.pid).toBe(12345);
    expect(diag.ppid).toBe(11111);
    expect(diag.signalsSent).toEqual(["SIGTERM", "SIGKILL"]);
  });
});
