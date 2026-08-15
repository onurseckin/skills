import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalCommandFingerprint } from "../../../orchestrating-long-tasks/scripts/src/runner/command-id.ts";
import { runCommand } from "../../../orchestrating-long-tasks/scripts/src/runner/run-command.ts";
import { verifyCommandRecord } from "../../../orchestrating-long-tasks/scripts/src/runner/verify-command.ts";
import { embeddedCommandIssues } from "../../../orchestrating-long-tasks/scripts/src/runner/command-shape.ts";
import { commandMatchesGate } from "../../../orchestrating-long-tasks/scripts/src/workflow/gates/gate-policy.ts";

const fixture = join(import.meta.dir, "fixtures/command-fixture.ts");
const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "runner-evidence-"));
  roots.push(value);
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("command identity and evidence integrity", () => {
  test("binds the canonical cwd and argv into one fingerprint", async () => {
    const first = await root();
    const second = await root();
    const argv = ["bun", "test"];
    expect(canonicalCommandFingerprint(first, argv)).not.toBe(
      canonicalCommandFingerprint(second, argv),
    );
    expect(canonicalCommandFingerprint(first, argv)).toBe(
      canonicalCommandFingerprint(`${first}/.`, argv),
    );
  });

  test("keeps all artifact references portable and verifies their bytes", async () => {
    const runRoot = await root();
    const result = await runCommand({
      argv: [process.execPath, fixture, "success", "evidence"],
      cwd: runRoot,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
    });

    const attempt = result.record.attempts![0]!;
    for (const path of [
      attempt.activity_path,
      attempt.logs.stdout.path,
      attempt.logs.stderr.path,
    ]) {
      expect(path.startsWith("/")).toBeFalse();
      expect(path.includes("\\")).toBeFalse();
      expect(path.split("/")).not.toContain("..");
    }
    expect(verifyCommandRecord(runRoot, result.record)).toEqual([]);

    await writeFile(join(runRoot, attempt.logs.stdout.path), "tampered");
    expect(verifyCommandRecord(runRoot, result.record).join("\n")).toContain("stdout log");
  });

  test("rejects forged digest, attempt, activity, and aggregate identity", async () => {
    const runRoot = await root();
    const result = await runCommand({
      argv: [process.execPath, fixture, "success", "checked"],
      cwd: runRoot,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
    });
    const attempt = result.record.attempts![0]!;
    const activityPath = join(runRoot, attempt.activity_path);
    const originalActivity = await readFile(activityPath);

    const forged = structuredClone(result.record);
    forged.fingerprint = "0".repeat(64);
    forged.logs!.stdout.sha256 = "f".repeat(64);
    expect(verifyCommandRecord(runRoot, forged).join("\n")).toMatch(/fingerprint|stdout log/);

    await writeFile(activityPath, JSON.stringify({ status: "completed" }));
    expect(verifyCommandRecord(runRoot, result.record).join("\n")).toContain("activity");
    await writeFile(activityPath, originalActivity);

    const attemptPath = join(runRoot, "commands", result.record.id, "attempt-1", "record.json");
    await writeFile(attemptPath, "{}\n");
    expect(verifyCommandRecord(runRoot, result.record).join("\n")).toContain("attempt record");
  });

  test("binds gate evidence to its canonical repository-relative cwd", async () => {
    const repositoryRoot = await root();
    const runRoot = join(repositoryRoot, ".capsules", "gate");
    await mkdir(join(runRoot, "commands"), { recursive: true });
    const cwd = join(repositoryRoot, "packages", "api");
    await mkdir(cwd, { recursive: true });
    await writeFile(join(cwd, "marker"), "gate\n");
    const result = await runCommand({
      argv: ["test", "-f", "marker"],
      cwd,
      repositoryRoot,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      taskId: "T-api",
      gateId: "G-api",
    });
    const gate = {
      id: "G-api",
      command: result.record.argv,
      cwd: "packages/api",
      scope: "task" as const,
      requirement_ids: ["R-1"],
      mandatory: true,
    };
    expect(commandMatchesGate(result.record, gate)).toBeTrue();
    expect(commandMatchesGate(result.record, { ...gate, cwd: "." })).toBeFalse();

    await writeFile(join(cwd, "marker"), "changed\n");
    expect(commandMatchesGate(result.record, gate)).toBeFalse();
    expect(verifyCommandRecord(runRoot, result.record).join("\n")).toMatch(
      /identity|digest|changed/i,
    );
  });

  test("requires actor identity and validates aggregate quota and retry semantics", async () => {
    const runRoot = await root();
    const result = await runCommand({
      argv: [process.execPath, fixture, "success", "actor"],
      cwd: runRoot,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
    });
    const missingActor = structuredClone(result.record) as Record<string, unknown>;
    delete missingActor.actor;
    expect(embeddedCommandIssues(missingActor as never).join("\n")).toMatch(/actor/i);

    const overCombined = structuredClone(result.record);
    const logs = overCombined.attempts![0]!.logs;
    overCombined.policy!.max_output_bytes = logs.stdout.bytes + logs.stderr.bytes - 1;
    expect(verifyCommandRecord(runRoot, overCombined).join("\n")).toMatch(/combined.*quota/i);

    const impossibleRetry = structuredClone(result.record);
    impossibleRetry.attempts![0]!.failure_class = "network_transient";
    expect(embeddedCommandIssues(impossibleRetry).join("\n")).toMatch(/succeeded|transient/i);

    const stoppedEarly = structuredClone(result.record);
    const attempt = stoppedEarly.attempts![0]!;
    attempt.status = "failed";
    attempt.exit_code = 75;
    attempt.failure_class = "network_transient";
    stoppedEarly.status = "failed";
    stoppedEarly.exit_code = 75;
    stoppedEarly.policy!.idempotent = true;
    stoppedEarly.policy!.max_retries = 2;
    expect(embeddedCommandIssues(stoppedEarly).join("\n")).toMatch(/retry.*remaining|exhaust/i);
  });

  test("authenticates zero-test output as terminal failed evidence when the process exits zero", async () => {
    const runRoot = await root();
    const fakeGo = join(runRoot, "go");
    await writeFile(
      fakeGo,
      `#!${process.execPath}\nconsole.log('? module/package [no test files]'); console.log('x'.repeat(16384));\n`,
      { mode: 0o700 },
    );
    const result = await runCommand({
      argv: [fakeGo, "test", "./..."],
      cwd: runRoot,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
    });

    expect(result.record.status).toBe("failed");
    expect(result.record.exit_code).toBe(0);
    expect(result.record.evidence_issues).toEqual(["test command discovered zero tests"]);
    expect(result.record.attempts![0]!.evidence_issues).toEqual([
      "test command discovered zero tests",
    ]);
    expect(result.record.attempts![0]!.failure_class).toBe("test_failure");
    expect(embeddedCommandIssues(result.record)).toEqual([]);
    expect(verifyCommandRecord(runRoot, result.record)).toEqual([]);
  });
});
