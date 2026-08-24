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

    const hasMetaAuditor = activeAgents.some(
      (a) => a.role === "meta-auditor" || a.role === "mind-auditor",
    );

    if (!hasMetaAuditor) {
      throw new HarnessError(
        "INVALID_STATE",
        "[META_AUDITOR_MANDATE_VIOLATION] Self-evolution of orchestrating-long-tasks skill requires an active Tier 2 Meta-Auditor companion to continuously audit behavioral forensics. You MUST deploy a meta-auditor via invoke_subagent.",
      );
    }
  }
}
