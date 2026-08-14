import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RepositoryBinding } from "../../src/contracts/repository.ts";
import { createInternalCommandRunner } from "../../src/runner/internal-command-runner.ts";
import { embeddedCommandIssues } from "../../src/runner/command-shape.ts";
import type { AttemptResult } from "../../src/runner/types.ts";

const roots: string[] = [];
const digest = (marker: string): string => marker.repeat(64);

function binding(marker: string): RepositoryBinding {
  return {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: digest(marker),
    git_identity_sha256: digest(marker),
    content_sha256: digest(marker),
    file_count: 1,
    total_bytes: 17,
  };
}

function succeeded(id: string, attempt: number, commandRoot: string): AttemptResult {
  const base = `commands/${id}/attempt-${attempt}`;
  const metadata = (name: string) => ({ path: `${base}/${name}`, bytes: 0, sha256: digest("0") });
  const record = {
    id,
    attempt,
    status: "succeeded" as const,
    started_at: "2026-08-14T00:00:00.000Z",
    finished_at: "2026-08-14T00:00:01.000Z",
    exit_code: 0,
    signal: null,
    signals_sent: [],
    timeout_kind: null,
    failure_class: null,
    activity_path: `${base}/activity.json`,
    activity: metadata("activity.json"),
    logs: { stdout: metadata("stdout.log"), stderr: metadata("stderr.log") },
  };
  return {
    record,
    attempt,
    stdoutPath: join(commandRoot, `attempt-${attempt}`, "stdout.log"),
    stderrPath: join(commandRoot, `attempt-${attempt}`, "stderr.log"),
    activityPath: join(commandRoot, `attempt-${attempt}`, "activity.json"),
    outputTail: "",
  };
}

async function setup(name: string) {
  const root = await mkdtemp(join(tmpdir(), name));
  roots.push(root);
  const runRoot = join(root, ".harness");
  await mkdir(join(runRoot, "commands"), { recursive: true });
  await mkdir(join(root, "bin"));
  await writeFile(join(root, "bin", "verify"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  return { root, runRoot };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("gate attempt observation integrity", () => {
  test("terminalizes preflight drift without inventing an attempt", async () => {
    const { root, runRoot } = await setup("attempt-preflight-failure-");
    let observations = 0;
    let attempted = false;
    const runner = createInternalCommandRunner({
      inspectRepository: () => binding(++observations === 1 ? "a" : "b"),
      attempt: async (_options, attempt, id, commandRoot) => {
        attempted = true;
        return succeeded(id, attempt, commandRoot);
      },
    });
    const prepared = await runner.prepareCommand({
      argv: ["./bin/verify"],
      cwd: root,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      gateId: "G-preflight-failure",
    });

    await expect(runner.executePreparedCommand(prepared)).rejects.toThrow(
      "repository observation changed before gate attempt",
    );
    const aggregate = JSON.parse(await readFile(prepared.recordPath, "utf8"));
    expect(attempted).toBeFalse();
    expect(aggregate).toMatchObject({
      status: "failed",
      repository_after: binding("b"),
      attempts: [],
    });
    expect(aggregate.evidence_error).toContain("repository observation changed");
    expect(aggregate.preflight_failure).toBe(aggregate.evidence_error);
    expect(await readdir(prepared.commandRoot)).toEqual(["record.json"]);
    expect(embeddedCommandIssues(aggregate)).toEqual([]);
  });

  test("retains prior attempts when a retry preflight fails", async () => {
    const { root, runRoot } = await setup("attempt-retry-preflight-");
    let observations = 0;
    let attempts = 0;
    const runner = createInternalCommandRunner({
      inspectRepository: () => binding(++observations < 4 ? "a" : "b"),
      attempt: async (_options, attempt, id, commandRoot) => {
        attempts += 1;
        const result = succeeded(id, attempt, commandRoot);
        result.record.status = "failed";
        result.record.exit_code = 1;
        result.record.failure_class = "network_transient";
        result.failureClass = "network_transient";
        return result;
      },
    });
    const prepared = await runner.prepareCommand({
      argv: ["./bin/verify"],
      cwd: root,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      gateId: "G-retry-preflight",
      idempotent: true,
      retries: 1,
    });

    await expect(runner.executePreparedCommand(prepared)).rejects.toThrow(
      "repository observation changed before gate attempt",
    );
    const aggregate = JSON.parse(await readFile(prepared.recordPath, "utf8"));
    expect(attempts).toBe(1);
    expect(aggregate).toMatchObject({
      status: "failed",
      repository_after: binding("b"),
      attempts: [{ attempt: 1 }],
    });
    expect(embeddedCommandIssues(aggregate)).toEqual([]);
  });

  test("does not reuse the prior binding when a retry preflight observer throws", async () => {
    const { root, runRoot } = await setup("attempt-retry-observer-error-");
    let observations = 0;
    const runner = createInternalCommandRunner({
      inspectRepository: () => {
        if (++observations === 4) throw new Error("retry observer unavailable");
        return binding("a");
      },
      attempt: async (_options, attempt, id, commandRoot) => {
        const result = succeeded(id, attempt, commandRoot);
        result.record.status = "failed";
        result.record.exit_code = 1;
        result.record.failure_class = "network_transient";
        result.failureClass = "network_transient";
        return result;
      },
    });
    const prepared = await runner.prepareCommand({
      argv: ["./bin/verify"],
      cwd: root,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      gateId: "G-retry-observer-error",
      idempotent: true,
      retries: 1,
    });

    await expect(runner.executePreparedCommand(prepared)).rejects.toThrow("observer unavailable");
    const aggregate = JSON.parse(await readFile(prepared.recordPath, "utf8"));
    expect(aggregate).toMatchObject({ status: "failed", repository_after: null });
    expect(aggregate.preflight_failure).toContain("observer unavailable");
    expect(embeddedCommandIssues(aggregate)).toEqual([]);
  });

  test("retains the current binding when attempt setup fails before its marker", async () => {
    const { root, runRoot } = await setup("attempt-pre-marker-failure-");
    const runner = createInternalCommandRunner({
      inspectRepository: () => binding("a"),
      attempt: async () => { throw new Error("attempt setup failed"); },
    });
    const prepared = await runner.prepareCommand({
      argv: ["./bin/verify"],
      cwd: root,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      gateId: "G-pre-marker-failure",
    });

    await expect(runner.executePreparedCommand(prepared)).rejects.toThrow("attempt setup failed");
    const aggregate = JSON.parse(await readFile(prepared.recordPath, "utf8"));
    expect(aggregate).toMatchObject({
      status: "failed",
      repository_after: binding("a"),
      attempts: [],
    });
    expect(aggregate.preflight_failure).toBe(aggregate.evidence_error);
    expect(await readdir(prepared.commandRoot)).toEqual(["record.json"]);
  });

  test("leaves raw evidence recoverable when post-observation throws", async () => {
    const { root, runRoot } = await setup("attempt-observer-error-");
    let observations = 0;
    const runner = createInternalCommandRunner({
      inspectRepository: () => {
        observations += 1;
        if (observations === 3) throw new Error("observer unavailable");
        return binding("a");
      },
      attempt: async (_options, attempt, id, commandRoot) => succeeded(id, attempt, commandRoot),
    });
    const prepared = await runner.prepareCommand({
      argv: ["./bin/verify"],
      cwd: root,
      runRoot,
      commandDir: join(runRoot, "commands"),
      actor: "validator",
      gateId: "G-observer-error",
    });

    await expect(runner.executePreparedCommand(prepared)).rejects.toThrow("observer unavailable");
    const aggregate = JSON.parse(await readFile(prepared.recordPath, "utf8"));
    expect(aggregate).toMatchObject({ status: "running", repository_after: null });
    expect(aggregate.attempts[0]).not.toHaveProperty("gate_finalized_at");
    expect(aggregate.attempts[0]).not.toHaveProperty("repository_after");
  });
});
