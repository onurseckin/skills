import { HarnessError } from "../../core/errors/index.ts";
import type {
  BootGateVerificationResult,
  LiveCliProof,
  MandatoryBootGate,
  SubagentBootGateRecord,
  WatchdogFinding,
} from "./types.ts";

export function verifyBootGates(
  record: SubagentBootGateRecord | undefined,
  agentId: string,
  requireValidProof = false,
): BootGateVerificationResult {
  if (!record) {
    return {
      passed: false,
      missingGates: ["whoami", "doctor"],
      violations: [`Subagent "${agentId}" has no recorded pre-flight boot gates.`],
      record: undefined,
    };
  }

  const missingGates: MandatoryBootGate[] = [];
  const violations: string[] = [];
  const proofs: Partial<Record<MandatoryBootGate, LiveCliProof>> = {};

  if (record.whoamiProof) {
    proofs.whoami = record.whoamiProof;
  }
  if (record.doctorProof) {
    proofs.doctor = record.doctorProof;
  }

  if (!record.whoamiExecuted) {
    missingGates.push("whoami");
    violations.push(`Subagent "${agentId}" has not executed mandatory pre-flight 'whoami'`);
  } else if (requireValidProof && record.whoamiProof?.verified === false) {
    missingGates.push("whoami");
    violations.push(`Subagent "${agentId}" pre-flight 'whoami' CLI proof failed verification`);
  }

  if (!record.doctorExecuted) {
    missingGates.push("doctor");
    violations.push(`Subagent "${agentId}" has not executed mandatory pre-flight 'doctor'`);
  } else if (requireValidProof && record.doctorProof?.verified === false) {
    missingGates.push("doctor");
    violations.push(`Subagent "${agentId}" pre-flight 'doctor' CLI proof failed verification`);
  }

  const passed = missingGates.length === 0;

  return {
    passed,
    missingGates,
    violations,
    proofs,
    record,
  };
}

export function assertBootGatesPassed(
  record: SubagentBootGateRecord | undefined,
  agentId: string,
  operationDescription = "performing task operations",
  requireValidProof = false,
): void {
  const verification = verifyBootGates(record, agentId, requireValidProof);
  if (!verification.passed) {
    const missing = verification.missingGates.join(", ");
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Pre-flight boot gate violation: Subagent "${agentId}" attempted ${operationDescription} without completing mandatory pre-flight boot gates: [${missing}]. Every spawned subagent must execute 'whoami' and 'doctor' before claiming tasks or modifying files.`,
    );
  }
}

export function auditFindings(
  records: readonly SubagentBootGateRecord[],
  timestamp: string,
): readonly WatchdogFinding[] {
  const findings: WatchdogFinding[] = [];

  for (const rec of records) {
    if (!rec.bootGatePassed) {
      const missing: string[] = [];
      if (!rec.whoamiExecuted) missing.push("whoami");
      if (!rec.doctorExecuted) missing.push("doctor");

      const isUnverified =
        (rec.whoamiProof && !rec.whoamiProof.verified) ||
        (rec.doctorProof && !rec.doctorProof.verified);

      const violationType = isUnverified ? "invalid_boot_gate_proof" : "boot_gate_missing";

      findings.push({
        id: `finding-bootgate-${rec.agentId}`,
        agentId: rec.agentId,
        role: rec.role,
        taskId: rec.taskId ?? undefined,
        violationType,
        severity: "critical",
        observation: `Spawned subagent "${rec.agentId}" (Tier ${rec.tier} ${rec.role}) failed mandatory pre-flight boot gates: missing [${missing.join(", ")}]`,
        remediation:
          "Enforce immediate pre-flight execution of `whoami` and `doctor` commands prior to performing any task operations or file modifications.",
        timestamp,
        evidence: {
          agentId: rec.agentId,
          role: rec.role,
          tier: rec.tier,
          whoamiExecuted: rec.whoamiExecuted,
          whoamiExecutedAt: rec.whoamiExecutedAt,
          whoamiProof: rec.whoamiProof,
          doctorExecuted: rec.doctorExecuted,
          doctorExecutedAt: rec.doctorExecutedAt,
          doctorProof: rec.doctorProof,
          missingGates: missing,
        },
      });
    }
  }

  return findings;
}
