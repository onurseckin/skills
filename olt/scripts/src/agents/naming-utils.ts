import type { ExecutionTier } from "./naming-types.ts";

export function roleToTier(role: string): ExecutionTier {
  const normalized = role.toLowerCase().trim();
  if (
    normalized === "mind" ||
    normalized === "human" ||
    normalized === "user" ||
    normalized === "lead"
  ) {
    return 0;
  }
  if (
    normalized === "orchestrator" ||
    normalized.startsWith("orch-") ||
    normalized.startsWith("orchestrator-") ||
    normalized === "orch" ||
    normalized === "mind-auditor" ||
    normalized === "auditor"
  ) {
    return 1;
  }
  if (
    normalized === "coordinator" ||
    normalized.startsWith("coord-") ||
    normalized.startsWith("coordinator-") ||
    normalized === "coord"
  ) {
    return 2;
  }
  return 3;
}

export function agentIdToTier(agentId: string): ExecutionTier | null {
  const normalized = agentId.toLowerCase().trim();
  if (/^mind[-_]audit|^audit/i.test(normalized)) return 1;
  if (/^mind|^human/i.test(normalized)) return 0;
  if (/^orch/i.test(normalized)) return 1;
  if (/^coord/i.test(normalized)) return 2;
  if (
    /^(impl|val|critic|completeness[-_]critic|repair|worker|sub|plan|mechanic|ui[-_]mechanic|ui[-_]val)/i.test(
      normalized,
    )
  )
    return 3;
  return null;
}

export function agentIdToRole(agentId: string): string | null {
  const normalized = agentId.toLowerCase().trim();
  if (/^mind[-_]audit|^audit/i.test(normalized)) return "mind-auditor";
  if (/^mind/i.test(normalized)) return "mind";
  if (/^human/i.test(normalized)) return "human";
  if (/^orch/i.test(normalized)) return "orchestrator";
  if (/^coord/i.test(normalized)) return "coordinator";
  if (/^ui[-_]mechanic[-_]validator/i.test(normalized)) return "ui-mechanic-validator";
  if (/^ui[-_]validator/i.test(normalized)) return "ui-validator";
  if (/^mechanic[-_]validator/i.test(normalized)) return "mechanic-validator";
  if (/^validator[-_]code[-_]quality/i.test(normalized)) return "validator-code-quality";
  if (/^validator[-_]ui[-_]design/i.test(normalized)) return "validator-ui-design";
  if (/^validator[-_]security/i.test(normalized)) return "validator-security";
  if (/^validator[-_]product/i.test(normalized)) return "validator-product";
  if (/^validator[-_]system[-_]design/i.test(normalized)) return "validator-system-design";
  if (/^sub[-_]implementer/i.test(normalized)) return "sub-implementer";
  if (/^sub[-_]validator/i.test(normalized)) return "sub-validator";
  if (/^sub[-_]investigator/i.test(normalized)) return "sub-investigator";
  if (/^impl/i.test(normalized)) return "implementer";
  if (/^val/i.test(normalized)) return "validator";
  if (/^(completeness[-_]critic|critic)/i.test(normalized)) return "completeness-critic";
  if (/^repair/i.test(normalized)) return "repairer";
  if (/^plan[-_]val/i.test(normalized)) return "plan-validator";
  if (/^plan/i.test(normalized)) return "planner";
  return null;
}
