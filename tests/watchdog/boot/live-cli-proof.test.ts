import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { BootGateEnforcer } from "../../../olt/scripts/src/watchdog/boot-gate-enforcer/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { LiveCliProof } from "../../../olt/scripts/src/watchdog/boot-gate-enforcer/types.ts";
import { cleanupVirtualWatchdogFS, setupVirtualWatchdogFS } from "../watchdog-fixture.ts";

beforeEach(() => {
  setupVirtualWatchdogFS();
});

afterEach(() => {
  cleanupVirtualWatchdogFS();
});

describe("BootGateEnforcer Live CLI Proof Processing", () => {
  it("captures, verifies, and accepts valid whoami and doctor CLI proofs", () => {
    const enforcer = new BootGateEnforcer();
    enforcer.registerSpawnedSubagent({ agentId: "impl-live-cli", role: "implementer", pid: 45678 });

    const whoamiProof: LiveCliProof = {
      gate: "whoami",
      actor: "impl-live-cli",
      argv: ["bun", "harness.ts", "whoami"],
      exitCode: 0,
      executedAt: "2026-08-22T05:00:00.000Z",
      pid: 45678,
      fingerprint: "fp-01",
      verified: true,
    };
    const doctorProof: LiveCliProof = {
      gate: "doctor",
      actor: "impl-live-cli",
      argv: ["bun", "harness.ts", "doctor"],
      exitCode: 0,
      executedAt: "2026-08-22T05:00:05.000Z",
      pid: 45678,
      fingerprint: "fp-02",
      verified: true,
    };

    enforcer.recordCliProof(whoamiProof);
    enforcer.recordCliProof(doctorProof);

    const verification = enforcer.verifyBootGates("impl-live-cli", true);
    expect(verification.passed).toBe(true);
    expect(verification.proofs.whoami?.fingerprint).toBe("fp-01");
    expect(verification.proofs.doctor?.fingerprint).toBe("fp-02");
  });

  it("rejects unverified proofs or non-zero exit codes when requireValidProof is enabled", () => {
    const failEnforcer = new BootGateEnforcer();
    failEnforcer.registerSpawnedSubagent({ agentId: "impl-failing-cli", role: "implementer" });

    failEnforcer.recordCliProof({
      gate: "doctor",
      actor: "impl-failing-cli",
      argv: ["bun", "harness.ts", "doctor"],
      exitCode: 1,
      executedAt: "2026-08-22T05:00:00.000Z",
      verified: false,
    });

    const findings = failEnforcer.auditFindings();
    expect(findings.length).toBe(1);
    expect(findings[0]?.violationType).toBe("invalid_boot_gate_proof");

    expect(() =>
      failEnforcer.assertBootGatesPassed("impl-failing-cli", "running gate", true),
    ).toThrow(HarnessError);
  });
});
