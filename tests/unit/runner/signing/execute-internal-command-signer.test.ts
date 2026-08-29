import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepositoryBinding } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { createCommandSigningCapability } from "../../../../olt/scripts/src/engine/runner/execution/attempt-disposition-capability.ts";
import type { CommandRuntimeCapability } from "../../../../olt/scripts/src/engine/runner/models/execution/command-execution-snapshot.ts";
import { executeInternalPreparedCommand } from "../../../../olt/scripts/src/engine/runner/core/execute-internal-command.ts";
import { createInternalCommandRunner } from "../../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";

const roots: string[] = [];
const digest = (marker: string): string => marker.repeat(64);

function binding(): RepositoryBinding {
  return {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: digest("a"),
    git_identity_sha256: digest("a"),
    content_sha256: digest("a"),
    file_count: 1,
    total_bytes: 17,
  };
}

async function fixture(label: string) {
  const root = await mkdtemp(join(tmpdir(), `${label}-`));
  roots.push(root);
  await mkdir(join(root, "bin"));
  await mkdir(join(root, ".olt", "capsules", "commands"), { recursive: true });
  await writeFile(join(root, "bin", "verify"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  return {
    root,
    input: {
      argv: ["./bin/verify"],
      cwd: root,
      runRoot: join(root, ".olt", "capsules"),
      commandDir: join(root, ".olt", "capsules", "commands"),
      actor: "validator" as const,
      retries: 0,
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("executeInternalPreparedCommand direct integrity-failure reporting", () => {
  test("throws the record's integrity failure directly when the attempt itself did not throw", async () => {
    const { input } = await fixture("execute-internal-direct-integrity-failure");
    const empty = { path: "empty", bytes: 0, sha256: "e".repeat(64) };
    const dependencies = {
      inspectRepository: () => binding(),
      attempt: async (_options: unknown, attempt: number, id: string) => ({
        record: {
          id,
          attempt,
          status: "failed" as const,
          started_at: "2026-08-19T00:00:00.000Z",
          finished_at: "2026-08-19T00:00:01.000Z",
          exit_code: 1,
          signal: null,
          signals_sent: [],
          timeout_kind: null,
          failure_class: "unknown" as const,
          activity_path: "empty",
          activity: empty,
          logs: { stdout: empty, stderr: empty },
          integrity_failure: "injected direct integrity failure",
        },
        attempt,
        stdoutPath: "empty",
        stderrPath: "empty",
        activityPath: "empty",
        outputTail: "",
      }),
    };
    const runner = createInternalCommandRunner(dependencies);
    const prepared = await runner.prepareCommand(input);
    await expect(runner.executePreparedCommand(prepared)).rejects.toThrow(
      "injected direct integrity failure",
    );
  });
});

describe("executeInternalPreparedCommand signing capability guard", () => {
  test("rejects execution when the runtime signer does not match the durable intent's key", async () => {
    const { input } = await fixture("execute-internal-signer-mismatch");
    let invoked = false;
    const dependencies = {
      inspectRepository: () => binding(),
      attempt: async () => {
        invoked = true;
        throw new Error("must not run");
      },
    };
    const runner = createInternalCommandRunner(dependencies);
    const prepared = await runner.prepareCommand(input);

    // A fresh signing capability whose public key differs from the one embedded (and durably
    // persisted) in the prepared record; nothing else about the runtime capability changes.
    const mismatchedRuntime: CommandRuntimeCapability = {
      commandRoot: prepared.commandRoot,
      recordPath: prepared.recordPath,
      commandDir: prepared.options.commandDir,
      runRoot: prepared.options.runRoot,
      attemptSigner: createCommandSigningCapability(),
    };

    await expect(
      executeInternalPreparedCommand(prepared, mismatchedRuntime, dependencies),
    ).rejects.toThrow("prepared command signing capability does not match durable intent");
    expect(invoked).toBeFalse();
  });
});
