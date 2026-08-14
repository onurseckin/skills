import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RepositoryBinding } from "../../orchestrating-long-tasks/scripts/src/contracts/repository.ts";
import { atomicWriteJson } from "../../orchestrating-long-tasks/scripts/src/core/durable-write.ts";
import {
  reconcileCommandResult,
  recordCommandIntent,
} from "../../orchestrating-long-tasks/scripts/src/integration/record-command.ts";
import { createInternalCommandRunner } from "../../orchestrating-long-tasks/scripts/src/runner/internal-command-runner.ts";
import { embeddedCommandIssues } from "../../orchestrating-long-tasks/scripts/src/runner/command-shape.ts";
import { initRun } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { createCommandSigningCapability } from "../../orchestrating-long-tasks/scripts/src/runner/attempt-disposition-capability.ts";

const roots: string[] = [];

function binding(marker: string): RepositoryBinding {
  return {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: marker.repeat(64),
    git_identity_sha256: marker.repeat(64),
    content_sha256: marker.repeat(64),
    file_count: 1,
    total_bytes: 17,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function preparedIntent() {
  const repo = await mkdtemp(join(tmpdir(), "command-intent-equality-"));
  roots.push(repo);
  await mkdir(join(repo, "bin"));
  await writeFile(join(repo, "bin", "verify"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const runRoot = initRun(
    repo,
    "intent-equality",
    new TextEncoder().encode("prompt"),
    "file",
    true,
  );
  const runner = createInternalCommandRunner({
    inspectRepository: () => binding("a"),
    attempt: async () => {
      throw new Error("must not run");
    },
  });
  const prepared = await runner.prepareCommand({
    argv: ["./bin/verify"],
    cwd: repo,
    runRoot,
    commandDir: join(runRoot, "commands"),
    actor: "validator",
    gateId: "G-observed",
  });
  recordCommandIntent(runRoot, "validator", prepared.record);
  return { prepared, repo, runRoot, runner };
}

function terminalRecord(prepared: Awaited<ReturnType<typeof preparedIntent>>["prepared"]) {
  return {
    ...structuredClone(prepared.record),
    status: "failed" as const,
    finished_at: "2026-08-14T13:00:00.000Z",
    evidence_error: "manual process-free terminal evidence",
  };
}

test("reconciliation accepts only the trusted-host terminal observation transition", async () => {
  const accepted = await preparedIntent();
  const terminal = terminalRecord(accepted.prepared);
  terminal.repository_after = binding("b");
  terminal.preflight_failure = terminal.evidence_error;
  atomicWriteJson(accepted.prepared.recordPath, terminal, 0o600);
  expect(() => reconcileCommandResult(accepted.runRoot, "validator", terminal)).not.toThrow();

  const unavailable = await preparedIntent();
  const preflight = terminalRecord(unavailable.prepared);
  preflight.preflight_failure = preflight.evidence_error;
  atomicWriteJson(unavailable.prepared.recordPath, preflight, 0o600);
  expect(() => reconcileCommandResult(unavailable.runRoot, "validator", preflight)).not.toThrow();

  const success = await preparedIntent();
  const forgedSuccess = terminalRecord(success.prepared);
  forgedSuccess.status = "succeeded";
  forgedSuccess.exit_code = 0;
  forgedSuccess.repository_after = binding("b");
  atomicWriteJson(success.prepared.recordPath, forgedSuccess, 0o600);
  expect(embeddedCommandIssues(forgedSuccess)).not.toEqual([]);
  expect(() => reconcileCommandResult(success.runRoot, "validator", forgedSuccess)).toThrow();

  for (const [label, mutate] of [
    [
      "attempt signing public key",
      (record: typeof terminal) => {
        record.attempt_signing_public_key =
          createCommandSigningCapability().verificationPublicKey;
      },
    ],
    [
      "assurance",
      (record: typeof terminal) => {
        record.assurance = "unknown" as never;
      },
    ],
    [
      "repository_before",
      (record: typeof terminal) => {
        record.repository_before = binding("c");
      },
    ],
    [
      "repository_after absent",
      (record: typeof terminal) => {
        delete record.repository_after;
      },
    ],
    [
      "repository_after invalid",
      (record: typeof terminal) => {
        record.repository_after = { ...binding("d"), version: 2 } as never;
      },
    ],
  ] as const) {
    const rejected = await preparedIntent();
    const forged = terminalRecord(rejected.prepared);
    forged.repository_after = binding("b");
    forged.preflight_failure = forged.evidence_error;
    mutate(forged);
    atomicWriteJson(rejected.prepared.recordPath, forged, 0o600);
    expect(() => reconcileCommandResult(rejected.runRoot, "validator", forged), label).toThrow();
  }
});

test("failed preflight path drift reconciles from durable evidence", async () => {
  const { prepared, repo, runRoot, runner } = await preparedIntent();
  await writeFile(join(repo, "bin", "verify"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
  await expect(runner.executePreparedCommand(prepared)).rejects.toThrow(/identity|digest/i);
  const failed = JSON.parse(await readFile(prepared.recordPath, "utf8"));
  expect(failed).toMatchObject({ status: "failed", attempts: [] });
  expect(failed.preflight_failure).toMatch(/identity|digest/i);
  expect(() => reconcileCommandResult(runRoot, "validator", failed)).not.toThrow();
});
