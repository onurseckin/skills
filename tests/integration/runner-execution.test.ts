import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCommand } from "../unit/runner/run-command-fixture.ts";

const fixture = join(import.meta.dir, "../unit/runner/fixtures/command-fixture.ts");
const roots: string[] = [];
async function root() {
  const value = await mkdtemp(join(tmpdir(), "harness-runner-"));
  roots.push(value);
  return value;
}

async function waitForActivity(commandDir: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const commands = await readdir(commandDir).catch(() => []);
    if (commands[0]) {
      const path = join(commandDir, commands[0], "attempt-1", "activity.json");
      if (await Bun.file(path).exists()) return path;
    }
    await Bun.sleep(10);
  }
  throw new Error("activity record was not created");
}
interface ActivitySnapshot {
  status: string;
  heartbeat_at: string;
  stdout_bytes: number;
}

async function readActivity(path: string): Promise<ActivitySnapshot> {
  return JSON.parse(await readFile(path, "utf8")) as ActivitySnapshot;
}

/**
 * Waits for the next heartbeat to land instead of sleeping past where one should have. A fixed sleep
 * has to guess how far behind the machine is: too short and the beat has not been written yet, too
 * long and the wall timeout has already ended the command this assertion needs still running.
 */
async function waitForHeartbeatAfter(path: string, previous: string): Promise<ActivitySnapshot> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const record = await readActivity(path);
    if (record.heartbeat_at > previous) return record;
    await Bun.sleep(5);
  }
  throw new Error("heartbeat never advanced");
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
);

describe("monitored command execution", () => {
  test("records successful output, timing, argv, and fingerprints", async () => {
    const dir = await root();
    const result = await runCommand({
      argv: [process.execPath, fixture, "success", "hello"],
      cwd: dir,
      commandDir: join(dir, "commands"),
      actor: "test",
    });
    expect(result.record.status).toBe("succeeded");
    expect(result.record.exit_code).toBe(0);
    expect(result.record.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const output = await readFile(result.attempts[0]!.stdoutPath);
    expect(output.toString()).toContain("hello");
    expect(result.attempts[0]!.record.id).toBe(result.record.id);
    expect(result.record.attempts).toHaveLength(1);
    expect(result.record.logs?.stdout).toEqual({
      path: result.record.attempts![0]!.logs.stdout.path,
      bytes: output.byteLength,
      sha256: createHash("sha256").update(output).digest("hex"),
    });
    expect(result.record.policy).toEqual({
      wall_timeout_ms: 600_000,
      idle_timeout_ms: 120_000,
      grace_ms: 1_000,
      drain_timeout_ms: 5_000,
      heartbeat_interval_ms: 1_000,
      max_output_bytes: 67_108_864,
      max_retries: 0,
      idempotent: false,
    });
    expect(JSON.parse(await readFile(result.attempts[0]!.activityPath, "utf8"))).toMatchObject({
      status: "completed",
      attempt: 1,
    });
    expect(JSON.parse(await readFile(result.recordPath, "utf8")).id).toBe(result.record.id);
  });

  test("persists heartbeat progress while a command remains active", async () => {
    const dir = await root();
    const commandDir = join(dir, "commands");
    const running = runCommand({
      argv: [process.execPath, fixture, "active-hang"],
      cwd: dir,
      commandDir,
      actor: "test",
      idleTimeoutMs: 1_200,
      wallTimeoutMs: 600,
      graceMs: 20,
      heartbeatIntervalMs: 20,
    });
    const activityPath = await waitForActivity(commandDir);
    const first = await readActivity(activityPath);
    const second = await waitForHeartbeatAfter(activityPath, first.heartbeat_at);

    expect(first.status).toBe("running");
    expect(second.status).toBe("running");
    expect(second.heartbeat_at > first.heartbeat_at).toBeTrue();
    expect(second.stdout_bytes).toBeGreaterThanOrEqual(first.stdout_bytes);
    expect((await running).record.timeout_kind).toBe("wall");
  });

  test("fails closed when an output pump cannot preserve evidence", async () => {
    const dir = await root();
    await expect(
      runCommand({
        argv: [process.execPath, fixture, "success", "evidence"],
        cwd: dir,
        commandDir: join(dir, "commands"),
        actor: "test",
        pump: async () => {
          throw new Error("log write failed");
        },
      }),
    ).rejects.toThrow("log write failed");
  });

  test("passes arguments literally without a shell", async () => {
    const dir = await root();
    const marker = join(dir, "should-not-exist");
    const literal = `; touch ${marker}`;
    const result = await runCommand({
      argv: [process.execPath, fixture, "success", literal],
      cwd: dir,
      commandDir: join(dir, "commands"),
      actor: "test",
    });
    expect(await readFile(result.attempts[0]!.stdoutPath, "utf8")).toContain(literal);
    await expect(readFile(marker)).rejects.toBeDefined();
  });

  test("rejects malformed policies before spawn", async () => {
    const dir = await root();
    await expect(
      runCommand({ argv: [], cwd: dir, commandDir: dir, actor: "test" }),
    ).rejects.toThrow();
    await expect(
      runCommand({
        argv: ["true"],
        cwd: dir,
        commandDir: dir,
        actor: "test",
        retries: true as never,
      }),
    ).rejects.toThrow();
  });
});
