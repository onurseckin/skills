import { HarnessError } from "../../../core/errors/index.ts";
import type { AgentGrantRecord } from "../../../core/contracts/index.ts";

export class SkillAuditorPolicy {
  public static isMandatoryTarget(_repoRoot?: string): boolean {
    return true;
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

  public static assertMetaAuditorRequired(
    repoRoot: string,
    activeAgents: readonly AgentGrantRecord[],
  ): void {
    this.assertSkillAuditorRequired(repoRoot, activeAgents);
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
}

export const MetaAuditorPolicy = SkillAuditorPolicy;
