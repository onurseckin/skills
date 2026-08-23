import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { generateKeyPairSync, sign } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  attemptStartedBaseDigest,
  cleanupDispositionEntryDigest,
  cleanupDispositionSigningBytes,
  type CleanupDispositionPayload,
} from "../../../olt/scripts/src/engine/runner/attempt-cleanup-disposition.ts";
import { createCommandSigningCapability } from "../../../olt/scripts/src/engine/runner/attempt-disposition-capability.ts";
import {
  attemptStartedIssues,
  ownershipTokenDigest,
  settledAttemptTerminalProof,
  startAttemptIntent,
} from "../../../olt/scripts/src/engine/runner/attempt-intent.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("cleanup uncertainty reconciliation", () => {
  test("rejects an internally valid marker signed by a substituted command key", async () => {
    const attemptDir = await mkdtemp(join(tmpdir(), "cleanup-substituted-key-"));
    roots.push(attemptDir);
    const expected = createCommandSigningCapability();
    const substituted = createCommandSigningCapability();
    const token = "12345678-1234-4234-8234-123456789abc";
    startAttemptIntent(
      attemptDir,
      "C-substituted-key",
      1,
      "2026-08-14T00:00:00.000Z",
      token,
      () => undefined,
      substituted,
    );
    const marker = JSON.parse(await readFile(join(attemptDir, "attempt-started.json"), "utf8"));

    expect(
      attemptStartedIssues(
        marker,
        "C-substituted-key",
        1,
        token,
        expected.verificationPublicKey,
      ).join("\n"),
    ).toMatch(/public key.*command intent/i);
  });

  test("rejects a validly signed direct transition from uncertainty to terminal proof", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const verificationPublicKey = Buffer.from(
      publicKey.export({ format: "der", type: "spki" }),
    ).toString("base64");
    const base = {
      schema: "harness.command-attempt-started" as const,
      version: 1 as const,
      command_id: "C-direct-terminal",
      attempt: 1,
      status: "running" as const,
      started_at: "2026-08-14T00:00:00.000Z",
      ownership_token_sha256: ownershipTokenDigest("12345678-1234-4234-8234-123456789abc"),
      verification_public_key: verificationPublicKey,
    };
    const baseSha256 = attemptStartedBaseDigest(base);
    const signed = (payload: CleanupDispositionPayload) => {
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
    const initial = signed({
      status: "uncertain",
      sequence: 1,
      recorded_at: "2026-08-14T00:00:00.001Z",
      reason: "attempt has no durable terminal proof",
      signals_sent: [],
      root_pid_identity: null,
      proof_kind: null,
      previous_sha256: baseSha256,
      previous_signature: null,
    });
    const root = { pid: 4242, parent: 100, group: 4242, birth: "root" };
    const terminal = signed({
      status: "terminal_proof",
      sequence: 2,
      recorded_at: "2026-08-14T00:00:00.002Z",
      reason: "forged direct proof",
      signals_sent: [],
      root_pid_identity: root,
      proof_kind: "strong_absence",
      previous_sha256: initial.sha256,
      previous_signature: initial.signature,
    });
    const marker = {
      ...base,
      root_pid_identity: root,
      base_sha256: baseSha256,
      disposition_head_sha256: terminal.sha256,
      cleanup_disposition: terminal,
      cleanup_history: [initial, terminal],
    };

    expect(
      attemptStartedIssues(
        marker,
        "C-direct-terminal",
        1,
        "12345678-1234-4234-8234-123456789abc",
        verificationPublicKey,
      ).join("\n"),
    ).toMatch(/record.pending|transition/i);
  });

  test("hash-binds cleanup disposition state and its delivered signals", async () => {
    const attemptDir = await mkdtemp(join(tmpdir(), "cleanup-disposition-chain-"));
    roots.push(attemptDir);
    const token = "12345678-1234-4234-8234-123456789abc";
    const signer = createCommandSigningCapability();
    const controller = startAttemptIntent(
      attemptDir,
      "C-chain",
      1,
      "2026-08-14T00:00:00.000Z",
      token,
      () => undefined,
      signer,
    );
    controller.bindRoot({ pid: 4242, parent: 100, group: 4242, birth: "root" });
    controller.beginCleanupUncertain(["pump failed"]);
    controller.recordSignal("SIGTERM");
    const marker = JSON.parse(await readFile(join(attemptDir, "attempt-started.json"), "utf8"));

    expect(marker.base_sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(marker.verification_public_key).toMatch(/^[A-Za-z0-9+/]+=*$/u);
    expect(JSON.stringify(marker)).not.toMatch(/private|PRIVATE KEY/u);
    expect(marker.disposition_head_sha256).toBe(marker.cleanup_disposition.sha256);
    expect(marker.cleanup_history).toHaveLength(4);
    expect(attemptStartedIssues(marker, "C-chain", 1, token, signer.verificationPublicKey)).toEqual(
      [],
    );

    const stripped = structuredClone(marker);
    stripped.cleanup_disposition = null;
    expect(
      attemptStartedIssues(stripped, "C-chain", 1, token, signer.verificationPublicKey).join("\n"),
    ).toMatch(/disposition|hash|history/i);

    const fakeSignal = structuredClone(marker);
    fakeSignal.cleanup_disposition.signals_sent.push("SIGKILL");
    fakeSignal.cleanup_history.at(-1).signals_sent.push("SIGKILL");
    expect(
      attemptStartedIssues(fakeSignal, "C-chain", 1, token, signer.verificationPublicKey).join(
        "\n",
      ),
    ).toMatch(/signature/i);

    const wrongHash = structuredClone(marker);
    wrongHash.disposition_head_sha256 = "0".repeat(64);
    expect(
      attemptStartedIssues(wrongHash, "C-chain", 1, token, signer.verificationPublicKey).join("\n"),
    ).toMatch(/hash/i);

    const forged = structuredClone(marker);
    forged.cleanup_disposition.status = "terminal_proof";
    forged.cleanup_disposition.proof_kind = "strong_absence";
    forged.cleanup_history.at(-1).status = "terminal_proof";
    forged.cleanup_history.at(-1).proof_kind = "strong_absence";
    expect(
      attemptStartedIssues(forged, "C-chain", 1, token, signer.verificationPublicKey).join("\n"),
    ).toMatch(/signature/i);
  });

  test("rejects unsupported signals and terminal proof before record-pending", async () => {
    const attemptDir = await mkdtemp(join(tmpdir(), "cleanup-disposition-transitions-"));
    roots.push(attemptDir);
    const controller = startAttemptIntent(
      attemptDir,
      "C-transitions",
      1,
      "2026-08-14T00:00:00.000Z",
      "12345678-1234-4234-8234-123456789abc",
      () => undefined,
      createCommandSigningCapability(),
    );
    controller.bindRoot({ pid: 4242, parent: 100, group: 4242, birth: "root" });

    expect(() => controller.recordSignal("SIGFAKE" as NodeJS.Signals)).toThrow(/signal/i);
    expect(() => controller.recordSignal("SIGKILL")).toThrow(/order/i);
    expect(() =>
      (controller as never as { markTerminalProof(r: string, p: unknown): void }).markTerminalProof(
        "forged",
        {
          kind: "strong_absence",
          childSettled: true,
          descendantsAbsent: true,
          rootAbsent: true,
        },
      ),
    ).toThrow(/record.pending|transition/i);
  });

  test("treats terminal proof as final in the disposition controller", async () => {
    const attemptDir = await mkdtemp(join(tmpdir(), "cleanup-terminal-finality-"));
    roots.push(attemptDir);
    const signer = createCommandSigningCapability();
    const controller = startAttemptIntent(
      attemptDir,
      "C-terminal-finality",
      1,
      "2026-08-14T00:00:00.000Z",
      "12345678-1234-4234-8234-123456789abc",
      () => undefined,
      signer,
    );
    controller.markRecordPending("terminal evidence is ready");
    controller.markTerminalProof("child settlement proven", settledAttemptTerminalProof(undefined));
    const terminal = await readFile(join(attemptDir, "attempt-started.json"), "utf8");

    expect(() => controller.recordSignal("SIGTERM")).toThrow(/terminal|final|uncertainty/i);
    expect(() => controller.markRecordPending("again")).toThrow(/terminal|final|transition/i);
    expect(() =>
      controller.markTerminalProof("again", settledAttemptTerminalProof(undefined)),
    ).toThrow(/terminal|final|transition/i);
    expect(() => controller.beginCleanupUncertain(["evidence publication failed"])).toThrow(
      /terminal|final/i,
    );
    expect(await readFile(join(attemptDir, "attempt-started.json"), "utf8")).toBe(terminal);
  });
});
