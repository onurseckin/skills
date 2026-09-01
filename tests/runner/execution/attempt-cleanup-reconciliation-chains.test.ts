import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { generateKeyPairSync, sign } from "node:crypto";
import { join } from "node:path";
import type { CommandRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  reconcileStrandedCommands,
  runAndRecordCommand,
} from "../../../olt/scripts/src/integration/record-command.ts";
import {
  attemptStartedBaseDigest,
  cleanupDispositionEntryDigest,
  cleanupDispositionSigningBytes,
  type CleanupDispositionPayload,
} from "../../../olt/scripts/src/engine/runner/execution/attempt-cleanup-disposition.ts";
import { createCommandSigningCapability } from "../../../olt/scripts/src/engine/runner/execution/attempt-disposition-capability.ts";
import {
  attemptStartedIssues,
  ownershipTokenDigest,
  settledAttemptTerminalProof,
  startAttemptIntent,
} from "../../../olt/scripts/src/engine/runner/execution/attempt-intent.ts";
import { createInternalCommandRunner } from "../../../olt/scripts/src/engine/runner/models/execution/internal-command-runner.ts";
import { OWNERSHIP_ENV } from "../../../olt/scripts/src/engine/runner/core/pipe-ownership.ts";
import { initRun, loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { tempRoot, cleanupTempRoots } from "../command/fixture.ts";

afterEach(cleanupTempRoots);

describe("cleanup disposition history and chains", () => {
  test("rejects a validly signed disposition appended after terminal proof", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const verificationPublicKey = Buffer.from(
      publicKey.export({ format: "der", type: "spki" }),
    ).toString("base64");
    const token = "12345678-1234-4234-8234-123456789abc";
    const base = {
      schema: "harness.command-attempt-started" as const,
      version: 1 as const,
      command_id: "C-post-terminal",
      attempt: 1,
      status: "running" as const,
      started_at: "2026-08-14T00:00:00.000Z",
      ownership_token_sha256: ownershipTokenDigest(token),
      verification_public_key: verificationPublicKey,
    };
    const baseSha256 = attemptStartedBaseDigest(base);
    const history: Array<ReturnType<typeof signed>> = [];
    const signed = (status: CleanupDispositionPayload["status"]) => {
      const previous = history.at(-1);
      const payload: CleanupDispositionPayload = {
        status,
        sequence: history.length + 1,
        recorded_at: `2026-08-14T00:00:00.00${history.length + 1}Z`,
        reason: `${status} fixture`,
        signals_sent: [],
        root_pid_identity: null,
        proof_kind: status === "terminal_proof" ? "settled" : null,
        previous_sha256: previous?.sha256 ?? baseSha256,
        previous_signature: previous?.signature ?? null,
      };
      const signature = sign(
        null,
        cleanupDispositionSigningBytes(baseSha256, payload),
        privateKey,
      ).toString("base64");
      return {
        ...payload,
        signature,
        sha256: cleanupDispositionEntryDigest(baseSha256, payload, signature),
      };
    };
    for (const status of ["uncertain", "record_pending", "terminal_proof", "uncertain"] as const)
      history.push(signed(status));
    const latest = history.at(-1)!;
    const marker = {
      ...base,
      root_pid_identity: null,
      base_sha256: baseSha256,
      disposition_head_sha256: latest.sha256,
      cleanup_disposition: latest,
      cleanup_history: history,
    };

    expect(
      attemptStartedIssues(marker, "C-post-terminal", 1, token, verificationPublicKey).join("\n"),
    ).toMatch(/terminal.*final|after terminal/i);
  });

  test("keeps a full signed disposition history within the marker read bound", async () => {
    const attemptDir = tempRoot("cleanup-disposition-bound");
    const token = "12345678-1234-4234-8234-123456789abc";
    const signer = createCommandSigningCapability();
    const controller = startAttemptIntent(
      attemptDir,
      "C-bound",
      1,
      "2026-08-14T00:00:00.000Z",
      token,
      () => undefined,
      signer,
    );
    for (let index = 0; index < 9; index += 1)
      controller.beginCleanupUncertain(["x".repeat(2_048)]);
    controller.markRecordPending("x".repeat(2_048));
    controller.markTerminalProof("x".repeat(2_048), settledAttemptTerminalProof(undefined));

    const raw = await readFile(join(attemptDir, "attempt-started.json"));
    const marker = JSON.parse(raw.toString("utf8"));
    expect(raw.byteLength).toBeLessThan(16 * 1024);
    expect(marker.cleanup_history).toHaveLength(12);
    expect(attemptStartedIssues(marker, "C-bound", 1, token, signer.verificationPublicKey)).toEqual(
      [],
    );
  });

  test("immediate reconciliation leaves a cleanup-uncertain attempt stranded", async () => {
    const repositoryRoot = tempRoot("cleanup-uncertain-reconcile");
    const runRoot = initRun(
      repositoryRoot,
      "cleanup-uncertain",
      new TextEncoder().encode("prompt"),
      "file",
      true,
    );
    const original = new Error("descendant absence was not proven");
    let commandId = "";
    let executions = 0;
    let reconciliations = 0;
    const runner = createInternalCommandRunner({
      inspectRepository: () => {
        throw new Error("non-gate observer must not run");
      },
      attempt: async (options, attempt, id, commandRoot, signer) => {
        executions += 1;
        commandId = id;
        const attemptDir = join(commandRoot, `attempt-${attempt}`);
        await mkdir(attemptDir);
        const started = startAttemptIntent(
          attemptDir,
          id,
          attempt,
          "2026-08-14T00:00:00.000Z",
          options.environment[OWNERSHIP_ENV]!,
          () => undefined,
          signer,
        );
        started.bindRoot({ pid: 4242, parent: 100, group: 4242, birth: "root" });
        started.beginCleanupUncertain([original.message]);
        started.recordSignal("SIGTERM");
        throw original;
      },
    });

    let caught: unknown;
    try {
      await runAndRecordCommand(
        runRoot,
        {
          argv: ["tool"],
          cwd: repositoryRoot,
          commandDir: join(runRoot, "commands"),
          actor: "validator",
        },
        {
          prepare: (input) => runner.prepareCommand(input),
          execute: (prepared) => runner.executePreparedCommand(prepared),
          reconcile: (root, actor) => {
            reconciliations += 1;
            return reconcileStrandedCommands(root, actor, {
              probeProcess: () => {
                throw new Error("cleanup uncertainty must preclude a root process probe");
              },
            });
          },
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(original);
    expect(executions).toBe(1);
    expect(reconciliations).toBe(2);
    const state = loadRun(runRoot).state.commands as Record<string, CommandRecord>;
    expect(state[commandId]?.status).toBe("running");
    const aggregate = JSON.parse(
      await readFile(join(runRoot, "commands", commandId, "record.json"), "utf8"),
    );
    expect(aggregate).toMatchObject({ status: "running", attempts: [] });
    const marker = JSON.parse(
      await readFile(
        join(runRoot, "commands", commandId, "attempt-1", "attempt-started.json"),
        "utf8",
      ),
    );
    expect(marker.cleanup_disposition).toMatchObject({
      status: "uncertain",
      reason: original.message,
      signals_sent: ["SIGTERM"],
    });
    expect(marker.ownership_token_sha256).toBe(
      ownershipTokenDigest(aggregate.environment[OWNERSHIP_ENV]),
    );
    expect(
      attemptStartedIssues(
        marker,
        commandId,
        1,
        aggregate.environment[OWNERSHIP_ENV],
        aggregate.attempt_signing_public_key,
      ),
    ).toEqual([]);
  });
});
