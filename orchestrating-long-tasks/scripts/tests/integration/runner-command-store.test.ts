import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executePreparedCommand, prepareCommand } from "../../src/runner/run-command.ts";
import { pumpOutput } from "../../src/runner/output-pump.ts";
import { runAttempt } from "../../src/runner/run-attempt.ts";
import { createCommandSigningCapability } from "../../src/runner/attempt-disposition-capability.ts";
import { createInternalCommandRunner } from "../../src/runner/internal-command-runner.ts";
import type { OutputPumpOptions } from "../../src/runner/types.ts";
import {
  reconcileCommandResult,
  reconcileStrandedCommands,
  recordCommandIntent,
  recordCommandResult,
  runAndRecordCommand,
} from "../../src/integration/record-command.ts";
import { runDoctor } from "../../src/reporting/doctor.ts";
import { initRun, loadRun } from "../../src/store/index.ts";

const fixture = join(import.meta.dir, "../runner/fixtures/command-fixture.ts");
const roots: string[] = [];

async function harness(): Promise<{ repo: string; runRoot: string }> {
  const repo = await mkdtemp(join(tmpdir(), "runner-store-"));
  roots.push(repo);
  return {
    repo,
    runRoot: initRun(repo, "runner-store", new TextEncoder().encode("prompt"), "file", true),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runner command store integration", () => {
  test("persists intent before spawn and reconciles the same aggregate identity", async () => {
    const { repo, runRoot } = await harness();
    const prepared = await prepareCommand({
      argv: ["bun", "--eval", "console.log('stored')"],
      cwd: repo,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      taskId: "T-1",
      gateId: "G-1",
    });
    recordCommandIntent(runRoot, "validator", prepared.record);
    expect(
      (loadRun(runRoot).state.commands as Record<string, { status?: string }>)[prepared.record.id]
        .status,
    ).toBe("running");

    const result = await executePreparedCommand(prepared);
    expect(
      (loadRun(runRoot).state.commands as Record<string, { status?: string }>)[result.record.id]
        .status,
    ).toBe("running");
    reconcileCommandResult(runRoot, "validator", result.record);

    const loaded = loadRun(runRoot);
    expect((loaded.state.commands as Record<string, unknown>)[result.record.id]).toEqual(
      result.record,
    );
    expect(loaded.events.slice(-2).map((event) => event.kind)).toEqual([
      "command-intent-recorded",
      "command-reconciled",
    ]);
  });

  test("recovers a stranded terminal result without replaying non-idempotent work", async () => {
    const { repo, runRoot } = await harness();
    const counter = join(repo, "counter");
    const prepared = await prepareCommand({
      argv: [process.execPath, fixture, "increment", counter],
      cwd: repo,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      idempotent: false,
    });
    recordCommandIntent(runRoot, "validator", prepared.record);
    await executePreparedCommand(prepared);

    expect(await readFile(counter, "utf8")).toBe("1");
    expect(
      (loadRun(runRoot).state.commands as Record<string, { status?: string }>)[prepared.record.id]
        .status,
    ).toBe("running");
    expect(reconcileStrandedCommands(runRoot, "validator")).toEqual({
      reconciled: [prepared.record.id],
      stranded: [],
    });
    expect(await readFile(counter, "utf8")).toBe("1");
    expect(
      (loadRun(runRoot).state.commands as Record<string, { status?: string }>)[prepared.record.id]
        .status,
    ).toBe("succeeded");
  });

  test("rebuilds an aggregate after a crash persisted its attempt first", async () => {
    const { repo, runRoot } = await harness();
    const counter = join(repo, "attempt-counter");
    const signer = createCommandSigningCapability();
    const runner = createInternalCommandRunner({
      inspectRepository: () => {
        throw new Error("non-gate observer must not run");
      },
      attempt: runAttempt,
      createCommandSigner: () => signer,
    });
    const prepared = await runner.prepareCommand({
      argv: [process.execPath, fixture, "increment", counter],
      cwd: repo,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      idempotent: false,
    });
    recordCommandIntent(runRoot, "validator", prepared.record);
    await runAttempt(prepared.options, 1, prepared.record.id, prepared.commandRoot, signer);

    expect(await readFile(counter, "utf8")).toBe("1");
    expect(reconcileStrandedCommands(runRoot, "validator")).toEqual({
      reconciled: [prepared.record.id],
      stranded: [],
    });
    expect(await readFile(counter, "utf8")).toBe("1");
    expect(
      (loadRun(runRoot).state.commands as Record<string, { status: string }>)[prepared.record.id]
        .status,
    ).toBe("succeeded");
  });

  test("rejects caller-forged records and doctor detects later artifact drift", async () => {
    const { repo, runRoot } = await harness();
    const result = await runAndRecordCommand(runRoot, {
      argv: [process.execPath, "--eval", "console.log('verified')"],
      cwd: repo,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
    });
    const forged = structuredClone(result.record);
    forged.fingerprint = "f".repeat(64);
    expect(() => recordCommandResult(runRoot, "attacker", forged)).toThrow("fingerprint");

    await writeFile(join(runRoot, result.record.logs!.stdout.path), "drift");
    const report = await runDoctor(runRoot);
    expect(report.healthy).toBeFalse();
    expect((report.issues as string[]).join("\n")).toContain("stdout log");
  });

  test("reconciles zero-test exit zero as failed and permits the next command", async () => {
    const { repo, runRoot } = await harness();
    const fakeGo = join(repo, "go");
    await writeFile(fakeGo, `#!${process.execPath}\nconsole.log('[no test files]');\n`, {
      mode: 0o700,
    });
    const failed = await runAndRecordCommand(runRoot, {
      argv: [fakeGo, "test", "./..."],
      cwd: repo,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
    });
    expect(failed.record.status).toBe("failed");
    expect(failed.record.exit_code).toBe(0);
    expect(
      (loadRun(runRoot).state.commands as Record<string, { status: string }>)[failed.record.id]
        .status,
    ).toBe("failed");

    const next = await runAndRecordCommand(runRoot, {
      argv: [process.execPath, "--eval", "console.log('next')"],
      cwd: repo,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
    });
    expect(next.record.status).toBe("succeeded");
  });

  test("reconciles evidence-pump failure after a transient attempt without retry-shape corruption", async () => {
    const { repo, runRoot } = await harness();
    let calls = 0;
    const pump = (
      stream: ReadableStream<Uint8Array>,
      file: never,
      path: string,
      onActivity: (text: string, bytes: number) => void | Promise<void>,
      options: OutputPumpOptions = {},
    ) => {
      calls += 1;
      if (calls === 3) return Promise.reject(new Error("second-attempt evidence storage failed"));
      return pumpOutput(stream, file, path, onActivity, options);
    };

    await expect(
      runAndRecordCommand(runRoot, {
        argv: [process.execPath, fixture, "network-always"],
        cwd: repo,
        commandDir: join(runRoot, "commands"),
        actor: "validator",
        retries: 2,
        idempotent: true,
        pump: pump as never,
      }),
    ).rejects.toThrow("second-attempt evidence storage failed");

    const commands = Object.values(
      loadRun(runRoot).state.commands as Record<
        string,
        { status: string; evidence_error?: string }
      >,
    );
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      status: "failed",
      evidence_error: "second-attempt evidence storage failed",
    });
  });
});
