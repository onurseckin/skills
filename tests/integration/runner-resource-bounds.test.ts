import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifySignals,
  inspectFailureText,
} from "../../orchestrating-long-tasks/scripts/src/runner/classify-failure.ts";
import { ActivityRecord } from "../../orchestrating-long-tasks/scripts/src/runner/activity-record.ts";
import { pumpOutput } from "../../orchestrating-long-tasks/scripts/src/runner/output-pump.ts";
import {
  assertRunnerPlatform,
  reserveCommandRoot,
} from "../../orchestrating-long-tasks/scripts/src/runner/platform-policy.ts";
import { signalProcessGroup } from "../../orchestrating-long-tasks/scripts/src/runner/process-group.ts";
import { runCommand, waitForProcessExit } from "../unit/runner/run-command-fixture.ts";
import type { OutputPumpOptions } from "../../orchestrating-long-tasks/scripts/src/runner/types.ts";

const fixture = join(import.meta.dir, "..", "unit", "runner", "fixtures", "command-fixture.ts");
const roots: string[] = [];
async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "runner-bounds-"));
  roots.push(value);
  return value;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("runner resource bounds", () => {
  test("writes complete chunks even when the file accepts partial writes", async () => {
    const writes: Uint8Array[] = [];
    const file = {
      async write(data: Uint8Array, offset = 0, length = data.byteLength - offset) {
        const count = Math.min(2, length);
        writes.push(data.slice(offset, offset + count));
        return { bytesWritten: count, buffer: data };
      },
      async sync() {},
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("abcdef"));
        controller.close();
      },
    });
    const summary = await pumpOutput(stream, file as never, "out.log", () => undefined);
    expect(Buffer.concat(writes).toString()).toBe("abcdef");
    expect(summary.bytes).toBe(6);
  });

  test("enforces a combined output quota and records a terminal evidence failure", async () => {
    const runRoot = await root();
    await expect(
      runCommand({
        argv: [process.execPath, fixture, "flood", "20000"],
        cwd: runRoot,
        runRoot,
        commandDir: join(runRoot, "commands"),
        actor: "validator",
        maxOutputBytes: 1_024,
      }),
    ).rejects.toThrow("output quota");
    const [command] = await Array.fromAsync(new Bun.Glob("commands/*/record.json").scan(runRoot));
    const record = JSON.parse(await readFile(join(runRoot, command!), "utf8"));
    expect(record.status).toBe("failed");
    expect(record.evidence_error).toContain("output quota");
  });

  test("throttles durable activity writes while retaining final counters", async () => {
    const directory = await root();
    const started = new Date("2026-08-13T00:00:00.000Z");
    const activity = new ActivityRecord(directory, "C-throttle", 1, started.toISOString(), 100);
    activity.output("stdout", 4, new Date(started.valueOf() + 10));
    expect(JSON.parse(await readFile(activity.path, "utf8")).stdout_bytes).toBe(0);
    activity.output("stdout", 5, new Date(started.valueOf() + 110));
    expect(JSON.parse(await readFile(activity.path, "utf8")).stdout_bytes).toBe(9);
    activity.complete("completed", new Date(started.valueOf() + 120));
    expect(JSON.parse(await readFile(activity.path, "utf8")).stdout_bytes).toBe(9);
  });

  test("rejects unbounded policies before reserving a command", async () => {
    const runRoot = await root();
    await expect(
      runCommand({
        argv: ["true"],
        cwd: runRoot,
        runRoot,
        commandDir: join(runRoot, "commands"),
        actor: "validator",
        wallTimeoutMs: 86_400_001,
      }),
    ).rejects.toThrow("wallTimeoutMs");
    expect(await Array.fromAsync(new Bun.Glob("commands/*").scan(runRoot))).toEqual([]);
  });

  test("aborts the sibling pump when preserving either stream fails", async () => {
    const runRoot = await root();
    let siblingAborted = false;
    const pump = async (
      _stream: ReadableStream<Uint8Array>,
      _file: never,
      path: string,
      _activity: never,
      options: OutputPumpOptions = {},
    ) => {
      if (path.endsWith("stdout.log")) throw new Error("stdout storage failed");
      await new Promise<void>((resolve) => {
        options.signal!.addEventListener("abort", () => {
          siblingAborted = true;
          resolve();
        });
      });
      throw new Error("stderr cancelled");
    };
    await expect(
      runCommand({
        argv: [process.execPath, fixture, "hang"],
        cwd: runRoot,
        runRoot,
        commandDir: join(runRoot, "commands"),
        actor: "validator",
        pump: pump as never,
        graceMs: 10,
        drainTimeoutMs: 50,
      }),
    ).rejects.toThrow("stdout storage failed");
    expect(siblingAborted).toBeTrue();
  });

  test("bounds pipe drain when an escaped descendant inherits output", async () => {
    const runRoot = await root();
    const pidPath = join(runRoot, "escaped.pid");
    const started = Date.now();
    const result = await runCommand({
      argv: [process.execPath, fixture, "spawn-detached-pipe-holder", pidPath],
      cwd: runRoot,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      drainTimeoutMs: 100,
      graceMs: 40,
    });
    expect(Date.now() - started).toBeLessThan(1200);
    const pid = Number(await readFile(pidPath, "utf8"));
    expect(result.record.signals_sent).toContain("SIGTERM");
    await waitForProcessExit(pid);
  });

  test("refuses unsupported platforms and reserves command IDs create-only", async () => {
    expect(() => assertRunnerPlatform("win32")).toThrow("unsupported");
    const parent = await root();
    await writeFile(join(parent, "keep"), "safe");
    let call = 0;
    const ids = ["C-collision", "C-collision", "C-fresh"];
    const first = await reserveCommandRoot(parent, () => ids[call++]!);
    await writeFile(join(first.path, "marker"), "original");
    const second = await reserveCommandRoot(parent, () => ids[call++]!);
    expect(second.id).toBe("C-fresh");
    expect(await readFile(join(first.path, "marker"), "utf8")).toBe("original");
  });

  test("child text cannot spoof host interruption and hard failures remain dominant", () => {
    expect(classifySignals(130, inspectFailureText("explicit host interruption"), null)).toBe(
      "unknown",
    );
    expect(classifySignals(1, inspectFailureText("tests failed\nservice unavailable"), null)).toBe(
      "test_failure",
    );
  });

  test("contains a daemon that escapes before the first ancestry snapshot", async () => {
    const runRoot = await root();
    const pidPath = join(runRoot, "fast-escaped.pid");
    const result = await runCommand({
      argv: [process.execPath, fixture, "spawn-fast-detached-pipe-holder", pidPath],
      cwd: runRoot,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      drainTimeoutMs: 100,
      graceMs: 20,
    });
    const pid = Number(await readFile(pidPath, "utf8"));
    expect(result.record.status).toBe("succeeded");
    await waitForProcessExit(pid);
  });

  test("distinguishes a vanished process group from permission refusal", () => {
    const missing = Object.assign(new Error("missing"), { code: "ESRCH" });
    const denied = Object.assign(new Error("denied"), { code: "EPERM" });
    expect(
      signalProcessGroup(123, "SIGTERM", () => {
        throw missing;
      }),
    ).toBeFalse();
    expect(() =>
      signalProcessGroup(123, "SIGTERM", () => {
        throw denied;
      }),
    ).toThrow(/permission|refused/i);
  });
});
