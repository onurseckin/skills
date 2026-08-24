import { HarnessError } from "../../core/errors/harness-error.ts";
import type { AgentGrantRecord } from "../../core/contracts/agents.ts";

export class MetaAuditorPolicy {
  public static isMandatoryTarget(repoRoot: string): boolean {
    return (
      repoRoot.includes("/skills") ||
      repoRoot.includes("orchestrating-long-tasks") ||
      repoRoot.includes("/olt")
    );
  }

  public static assertMetaAuditorRequired(
    repoRoot: string,
    activeAgents: readonly AgentGrantRecord[],
  ): void {
    if (!this.isMandatoryTarget(repoRoot)) return;

    const hasAuditor = activeAgents.some(
      (a) =>
        (a.role as string) === "meta-auditor" ||
        (a.role as string) === "mind-auditor" ||
        (a.role as string) === "skill-auditor",
    );

    if (!hasAuditor) {
      throw new HarnessError(
        "INVALID_STATE",
        "[META_AUDITOR_MANDATE_VIOLATION] Self-evolution of orchestrating-long-tasks skill requires an active Tier 2 Meta-Auditor companion to continuously audit behavioral forensics. You MUST deploy a meta-auditor via invoke_subagent.",
      );
    }
  }

  public static assertMindAuditorRequired(
    repoRoot: string,
    activeAgents: readonly AgentGrantRecord[],
  ): void {
    if (!this.isMandatoryTarget(repoRoot)) return;

    const hasMindAuditor = activeAgents.some(
      (a) => (a.role as string) === "mind-auditor" || (a.role as string) === "meta-auditor",
    );

    if (!hasMindAuditor) {
      throw new HarnessError(
        "INVALID_STATE",
        "[MIND_AUDITOR_MANDATE_VIOLATION] Starting Tier 0 Mind requires an active mind-auditor companion to continuously audit stagnation and candidate admission. You MUST deploy a mind-auditor via invoke_subagent.",
      );
    }
  }

  public static assertSkillAuditorRequired(
    repoRoot: string,
    activeAgents: readonly AgentGrantRecord[],
  ): void {
    if (!this.isMandatoryTarget(repoRoot)) return;

    const hasSkillAuditor = activeAgents.some(
      (a) => (a.role as string) === "skill-auditor" || (a.role as string) === "meta-auditor",
    );

    if (!hasSkillAuditor) {
      throw new HarnessError(
        "INVALID_STATE",
        "[SKILL_AUDITOR_MANDATE_VIOLATION] Starting Tier 1 Orchestrator requires an active skill-auditor companion to continuously audit skill compliance and telemetry. You MUST deploy a skill-auditor via invoke_subagent.",
      );
    }
  }
}
