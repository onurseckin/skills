import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCommand } from "../../orchestrating-long-tasks/scripts/src/runner/run-command.ts";
import { classifyFailure } from "../../orchestrating-long-tasks/scripts/src/runner/classify-failure.ts";

const fixture = join(import.meta.dir, "fixtures/command-fixture.ts");
const roots: string[] = [];
async function root() {
  const value = await mkdtemp(join(tmpdir(), "harness-watchdog-"));
  roots.push(value);
  return value;
}
afterEach(async () =>
  Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);

describe("watchdog and retry policy", () => {
  test("idle timeout terminates a silent process group", async () => {
    const dir = await root();
    const result = await runCommand({
      argv: [process.execPath, fixture, "hang"],
      cwd: dir,
      commandDir: join(dir, "commands"),
      actor: "test",
      idleTimeoutMs: 80,
      wallTimeoutMs: 1_000,
      graceMs: 30,
    });
    expect(result.record.status).toBe("timed_out");
    expect(result.attempts[0]!.failureClass).toBe("timeout");
    expect(result.record.timeout_kind).toBe("idle");
    expect(result.record.signals_sent).toEqual(["SIGTERM"]);
  });

  test("output activity prevents idle timeout but not wall policy", async () => {
    const dir = await root();
    const result = await runCommand({
      argv: [process.execPath, fixture, "active"],
      cwd: dir,
      commandDir: join(dir, "commands"),
      actor: "test",
      idleTimeoutMs: 300,
      wallTimeoutMs: 1_200,
      graceMs: 30,
    });
    expect(result.record.status).toBe("succeeded");
  });

  test("active output reaches the genuine wall timeout", async () => {
    const dir = await root();
    const result = await runCommand({
      argv: [process.execPath, fixture, "active-hang"],
      cwd: dir,
      commandDir: join(dir, "commands"),
      actor: "test",
      idleTimeoutMs: 300,
      wallTimeoutMs: 100,
      graceMs: 30,
    });
    expect(result.record.status).toBe("timed_out");
    expect(result.record.timeout_kind).toBe("wall");
  });

  test("records TERM then KILL only when the process ignores TERM", async () => {
    const dir = await root();
    const result = await runCommand({
      argv: [process.execPath, fixture, "ignore-term"],
      cwd: dir,
      commandDir: join(dir, "commands"),
      actor: "test",
      idleTimeoutMs: 250,
      wallTimeoutMs: 1_000,
      graceMs: 50,
    });
    expect(result.record.signals_sent).toEqual(["SIGTERM", "SIGKILL"]);
    expect(result.record.signal).toBe("SIGKILL");
  });

  test("retries transient failures only when explicitly idempotent", async () => {
    const dir = await root();
    const state = join(dir, "once");
    const result = await runCommand({
      argv: [process.execPath, fixture, "network-once", state],
      cwd: dir,
      commandDir: join(dir, "commands"),
      actor: "test",
      retries: 2,
      idempotent: true,
    });
    expect(result.attempts).toHaveLength(2);
    expect(result.record.status).toBe("succeeded");
    expect(new Set(result.attempts.map((attempt) => attempt.record.id))).toEqual(
      new Set([result.record.id]),
    );
    expect(result.record.attempts).toHaveLength(2);
  });

  test("does not trust child output claiming a host interruption", async () => {
    const dir = await root();
    const result = await runCommand({
      argv: [process.execPath, fixture, "host-interruption-once", join(dir, "host")],
      cwd: dir,
      commandDir: join(dir, "commands"),
      actor: "test",
      retries: 1,
      idempotent: true,
    });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.failureClass).toBe("unknown");
    expect(result.record.status).toBe("failed");
  });

  test("records an actual host-owned abort and keeps retries bounded", async () => {
    const dir = await root();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 40);
    const result = await runCommand({
      argv: [process.execPath, fixture, "hang"],
      cwd: dir,
      commandDir: join(dir, "commands"),
      actor: "test",
      retries: 1,
      idempotent: true,
      signal: controller.signal,
      graceMs: 10,
    });
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts.every((entry) => entry.failureClass === "host_interruption")).toBeTrue();
    expect(result.record.retry_exhausted).toBeTrue();
    expect(result.record.signals_sent).toContain("SIGTERM");
  });

  test("persists terminal exhaustion after bounded transient retries", async () => {
    const dir = await root();
    const result = await runCommand({
      argv: [process.execPath, fixture, "network-always"],
      cwd: dir,
      commandDir: join(dir, "commands"),
      actor: "test",
      retries: 2,
      idempotent: true,
    });
    expect(result.attempts).toHaveLength(3);
    expect(result.record.status).toBe("failed");
    expect(result.record.retry_exhausted).toBeTrue();
    expect(JSON.parse(await readFile(result.recordPath, "utf8")).attempts).toHaveLength(3);
  });

  test("hard failures take precedence over transient-looking output", () => {
    expect(classifyFailure(1, "connection reset; tests failed", null)).toBe("test_failure");
    expect(classifyFailure(1, "service unavailable; permission denied", null)).toBe(
      "authorization",
    );
    expect(classifyFailure(1, "temporary failure", null)).toBe("network_transient");
  });

  test("preserves early hard-failure evidence beyond the bounded output tail", async () => {
    const dir = await root();
    const result = await runCommand({
      argv: [process.execPath, fixture, "hard-then-transient-flood"],
      cwd: dir,
      commandDir: join(dir, "commands"),
      actor: "test",
      retries: 2,
      idempotent: true,
    });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.failureClass).toBe("test_failure");
  });

  test("never retries test failures or non-idempotent network failures", async () => {
    const dir = await root();
    const testResult = await runCommand({
      argv: [process.execPath, fixture, "test-failure"],
      cwd: dir,
      commandDir: join(dir, "test-commands"),
      actor: "test",
      retries: 2,
      idempotent: true,
    });
    expect(testResult.attempts).toHaveLength(1);
    expect(testResult.attempts[0]!.failureClass).toBe("test_failure");
    const network = await runCommand({
      argv: [process.execPath, fixture, "network-once", join(dir, "network")],
      cwd: dir,
      commandDir: join(dir, "network-commands"),
      actor: "test",
      retries: 2,
      idempotent: false,
    });
    expect(network.attempts).toHaveLength(1);
  });

  test("kills fixture children with the detached process group", async () => {
    const dir = await root();
    const pidPath = join(dir, "child.pid");
    await runCommand({
      argv: [process.execPath, fixture, "spawn-child", pidPath],
      cwd: dir,
      commandDir: join(dir, "commands"),
      actor: "test",
      idleTimeoutMs: 250,
      wallTimeoutMs: 1_000,
      graceMs: 50,
    });
    const pid = Number(await readFile(pidPath, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  test("kills TERM-resistant descendants after a cooperative leader exits", async () => {
    const dir = await root();
    const pidPath = join(dir, "resistant-child.pid");
    const result = await runCommand({
      argv: [process.execPath, fixture, "spawn-resistant-child", pidPath],
      cwd: dir,
      commandDir: join(dir, "commands"),
      actor: "test",
      idleTimeoutMs: 80,
      wallTimeoutMs: 1_000,
      graceMs: 50,
    });
    const pid = Number(await readFile(pidPath, "utf8"));
    expect(result.record.signals_sent).toEqual(["SIGTERM", "SIGKILL"]);
    expect(() => process.kill(pid, 0)).toThrow();
  });
});
