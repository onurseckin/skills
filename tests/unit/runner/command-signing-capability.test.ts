import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandAttemptStartedRecord } from "../../../olt/scripts/src/core/contracts/commands.ts";
import {
  CREATE_ATTEMPT_DISPOSITION,
  createCommandSigningCapability,
} from "../../../olt/scripts/src/engine/runner/command-signing-capability.ts";
import type { ProcessIdentity } from "../../../olt/scripts/src/engine/runner/process-identity.ts";

const mockIdentity: ProcessIdentity = {
  pid: 1234,
  parent: 1,
  group: 1234,
  birth: "2026-08-14T00:00:00.000Z",
};

function createBaseRecord(): CommandAttemptStartedRecord {
  return {
    schema: "harness.command-attempt-started",
    version: 1,
    command_id: "cmd-1",
    attempt: 1,
    status: "started",
    started_at: "2026-08-14T00:00:00.000Z",
    command_sha256: "0".repeat(64),
    base_sha256: "0".repeat(64),
    root_pid_identity: null,
    cleanup_disposition: null,
    cleanup_history: [],
    disposition_head_sha256: null,
  };
}

describe("command-signing-capability", () => {
  test("creates capability and manages full disposition lifecycle", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "disposition-"));
    const recordPath = join(tempDir, "record.json");
    const capability = createCommandSigningCapability();
    expect(capability.verificationPublicKey).toBeDefined();

    const cap = capability[CREATE_ATTEMPT_DISPOSITION](recordPath);
    let observedIdentity: ProcessIdentity | undefined;

    const { record: initial, controller } = cap.initialize(
      createBaseRecord(),
      (rec, identity) => ({ ...rec, root_pid_identity: identity }),
      (id) => (observedIdentity = id),
    );

    expect(initial.cleanup_disposition?.status).toBe("uncertain");
    expect(initial.cleanup_disposition?.reason).toContain("no durable terminal proof");

    // Bind root
    controller.bindRoot(mockIdentity);
    expect(observedIdentity?.pid).toBe(1234);

    // Double bind should fail
    expect(() => controller.bindRoot(mockIdentity)).toThrow(
      "attempt root identity transition is invalid",
    );

    // Begin cleanup uncertain
    controller.beginCleanupUncertain(["process timed out", "drain error"]);

    // Record signals (SIGTERM then SIGKILL)
    controller.recordSignal("SIGTERM");
    controller.recordSignal("SIGTERM"); // idempotent
    controller.recordSignal("SIGKILL");

    // Invalid signal order or unsupported signal
    expect(() => controller.recordSignal("SIGINT" as never)).toThrow(
      "unsupported attempt cleanup signal",
    );

    // Mark record pending
    controller.markRecordPending("all descendants dead");

    // Terminal proof transition
    controller.markTerminalProof("root and descendants proven absent", {
      kind: "strong_absence",
      rootIdentity: mockIdentity,
      childSettled: true,
      rootAbsent: true,
      descendantsAbsent: true,
    });

    // Cannot mutate after terminal proof
    expect(() => controller.beginCleanupUncertain(["more work"])).toThrow(
      "attempt terminal proof is final",
    );
    expect(() => controller.recordSignal("SIGTERM")).toThrow("attempt terminal proof is final");
    expect(() => controller.markRecordPending("again")).toThrow("attempt terminal proof is final");
    expect(() =>
      controller.markTerminalProof("again", {
        kind: "strong_absence",
        rootIdentity: mockIdentity,
        childSettled: true,
        rootAbsent: true,
        descendantsAbsent: true,
      }),
    ).toThrow("attempt terminal proof is final");
  });

  test("validates signal ordering and invalid transitions", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "disposition-"));
    const recordPath = join(tempDir, "record.json");
    const capability = createCommandSigningCapability();
    const cap = capability[CREATE_ATTEMPT_DISPOSITION](recordPath);

    const { controller } = cap.initialize(
      createBaseRecord(),
      (rec, identity) => ({ ...rec, root_pid_identity: identity }),
      () => undefined,
    );

    // SIGKILL before SIGTERM
    expect(() => controller.recordSignal("SIGKILL")).toThrow(
      "attempt cleanup signal order is invalid",
    );

    // Terminal proof directly from uncertain (requires record_pending)
    expect(() =>
      controller.markTerminalProof("terminal", {
        kind: "settled",
        childSettled: true,
        rootAbsent: false,
        descendantsAbsent: true,
      }),
    ).toThrow("terminal-proof transition requires record-pending");

    // Move to record pending
    controller.markRecordPending("ready");

    // Signal delivery when not uncertain
    expect(() => controller.recordSignal("SIGTERM")).toThrow(
      "signal delivery lacks cleanup uncertainty",
    );

    // Record pending when already record_pending
    expect(() => controller.markRecordPending("ready again")).toThrow(
      "record-pending transition requires uncertainty",
    );

    // Invalid terminal proof shape (mismatched root or flags)
    expect(() =>
      controller.markTerminalProof("terminal", {
        kind: "strong_absence",
        childSettled: false, // Invalid!
        rootAbsent: true,
        descendantsAbsent: true,
      }),
    ).toThrow("terminal process proof is invalid");
  });
});
