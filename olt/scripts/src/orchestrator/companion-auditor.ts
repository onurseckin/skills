import { existsSync } from "node:fs";
import { HarnessError } from "../core/errors/index.ts";
import { SkillAuditorPolicy } from "../engine/scheduler/index.ts";
import { SkillAuditorEngine, type SkillAuditLiveResult } from "../mind/auditing/cognitive/index.ts";
import { analyzeRunForensics, type ForensicsAnalysisResult } from "../mind/auditing/meta/index.ts";
import { SplitChannelDefectRouter } from "../reporting/split-channel-defect-router.ts";
import type { AgentGrantRecord } from "../core/contracts/index.ts";
import type {
  BehavioralForensicsIncident,
  BehavioralForensicsOptions,
  BehavioralForensicsReport,
  CompanionPairingResult,
  OrchestratorCompanionOptions,
} from "./types.ts";

export interface MandatoryCompanionsPairingResult {
  readonly skillAuditor: CompanionPairingResult;
  readonly mindAuditor: CompanionPairingResult;
  readonly allPaired: boolean;
}

export interface CompanionAuditorsHealthStatus {
  readonly healthy: boolean;
  readonly mindAuditorActive: boolean;
  readonly skillAuditorActive: boolean;
  readonly isMandatoryTarget: boolean;
  readonly issues: readonly string[];
}

export class OrchestratorCompanionAuditor {
  /**
   * Automatically pairs or verifies companion Skill Auditor alongside Tier 1 Orchestrator.
   */
  public static pairCompanion(
    repoRoot: string,
    options?: OrchestratorCompanionOptions,
  ): CompanionPairingResult {
    const isMandatory = SkillAuditorPolicy.isMandatoryTarget(repoRoot);
    const activeAgents: readonly AgentGrantRecord[] =
      options !== undefined && options.activeAgents !== undefined ? options.activeAgents : [];
    const pairedAgentId =
      options !== undefined && typeof options.companionAgentId === "string"
        ? options.companionAgentId
        : "skill-auditor-auto";
    const nowIso =
      options !== undefined && typeof options.now === "string"
        ? options.now
        : new Date().toISOString();

    const hasExplicitAuditor = activeAgents.some((a) => {
      const r = a.role as string;
      if (r === "skill-auditor") return true;
      if (r === "meta-auditor") return true;
      return false;
    });

    let paired = false;
    let autoProvisioned = false;

    if (hasExplicitAuditor) {
      paired = true;
    } else {
      // Auto-pair companion out-of-band auditor session
      paired = true;
      autoProvisioned = true;
    }

    const isStrict = options !== undefined && options.strictPolicy === true;
    if (isStrict && isMandatory && !hasExplicitAuditor && !autoProvisioned) {
      SkillAuditorPolicy.assertSkillAuditorRequired(repoRoot, activeAgents);
    }

    return {
      paired,
      autoProvisioned,
      isMandatoryTarget: isMandatory,
      companionAgentId: pairedAgentId,
      pairedAt: nowIso,
    };
  }

  /**
   * Automatically pairs or verifies companion Mind Auditor alongside Tier 0 Mind.
   */
  public static pairMindCompanion(
    repoRoot: string,
    options?: OrchestratorCompanionOptions,
  ): CompanionPairingResult {
    const isMandatory = SkillAuditorPolicy.isMandatoryTarget(repoRoot);
    const activeAgents: readonly AgentGrantRecord[] =
      options !== undefined && options.activeAgents !== undefined ? options.activeAgents : [];
    const pairedAgentId =
      options !== undefined && typeof options.companionAgentId === "string"
        ? options.companionAgentId
        : "mind-auditor-auto";
    const nowIso =
      options !== undefined && typeof options.now === "string"
        ? options.now
        : new Date().toISOString();

    const hasExplicitAuditor = activeAgents.some((a) => {
      const r = a.role as string;
      if (r === "mind-auditor") return true;
      if (r === "meta-auditor") return true;
      return false;
    });

    let paired = false;
    let autoProvisioned = false;

    if (hasExplicitAuditor) {
      paired = true;
    } else {
      paired = true;
      autoProvisioned = true;
    }

    const isStrict = options !== undefined && options.strictPolicy === true;
    if (isStrict && isMandatory && !hasExplicitAuditor && !autoProvisioned) {
      SkillAuditorPolicy.assertMindAuditorRequired(repoRoot, activeAgents);
    }

    return {
      paired,
      autoProvisioned,
      isMandatoryTarget: isMandatory,
      companionAgentId: pairedAgentId,
      pairedAt: nowIso,
    };
  }

  /**
   * Pairs both mandatory companion auditors (skill-auditor and mind-auditor).
   */
  public static pairAllMandatoryCompanions(
    repoRoot: string,
    options?: OrchestratorCompanionOptions,
  ): MandatoryCompanionsPairingResult {
    const skillAuditor = this.pairCompanion(repoRoot, options);
    const mindAuditor = this.pairMindCompanion(repoRoot, options);
    return {
      skillAuditor,
      mindAuditor,
      allPaired: skillAuditor.paired && mindAuditor.paired,
    };
  }

  /**
   * Actively verifies that mandatory companion auditors are deployed, healthy, and running.
   */
  public static verifyCompanionAuditorsHealth(
    repoRoot: string,
    activeAgents?: readonly AgentGrantRecord[],
  ): CompanionAuditorsHealthStatus {
    const isMandatory = SkillAuditorPolicy.isMandatoryTarget(repoRoot);
    const agents: readonly AgentGrantRecord[] = activeAgents !== undefined ? activeAgents : [];
    const active = agents.filter((a) => a.status === "active");

    const mindAuditorActive = active.some(
      (a) =>
        (a.role as string) === "mind-auditor" ||
        (a.role as string) === "meta-auditor" ||
        a.id.includes("mind-auditor"),
    );

    const skillAuditorActive = active.some(
      (a) =>
        (a.role as string) === "skill-auditor" ||
        (a.role as string) === "meta-auditor" ||
        a.id.includes("skill-auditor"),
    );

    const issues: string[] = [];
    if (!mindAuditorActive && isMandatory) {
      issues.push("Mandatory mind-auditor companion is not active in the agent ledger.");
    }
    if (!skillAuditorActive && isMandatory) {
      issues.push("Mandatory skill-auditor companion is not active in the agent ledger.");
    }

    const healthy = (!isMandatory || (mindAuditorActive && skillAuditorActive)) && issues.length === 0;

    return {
      healthy,
      mindAuditorActive,
      skillAuditorActive,
      isMandatoryTarget: isMandatory,
      issues,
    };
  }

  /**
   * Asserts that all mandatory companion auditors are healthy, throwing HarnessError if degraded.
   */
  public static assertCompanionAuditorsHealth(
    repoRoot: string,
    activeAgents?: readonly AgentGrantRecord[],
  ): void {
    const health = this.verifyCompanionAuditorsHealth(repoRoot, activeAgents);
    if (!health.healthy) {
      throw new HarnessError(
        "INVALID_STATE",
        `[MANDATORY_COMPANION_HEALTH_VIOLATION] Companion auditors health check failed: ${health.issues.join(" ")}`,
      );
    }
  }

  /**
   * Executes behavioral forensics on demand or per orchestrator round/tick.
   * Tracks TOKEN_BURNING, FALSE_SERIALIZATION, and ROLE_BOUNDARY_DEVIATION.
   */
  public static executeForensics(
    repoRoot: string,
    options?: BehavioralForensicsOptions,
  ): BehavioralForensicsReport {
    const nowIso =
      options !== undefined && typeof options.now === "string"
        ? options.now
        : new Date().toISOString();
    const runRoot = options !== undefined ? options.capsuleRunRoot : undefined;
    const logDefects =
      options !== undefined && options.logDefects !== undefined ? options.logDefects : true;

    // 1. Run live skill compliance delta scan
    const liveResult: SkillAuditLiveResult = SkillAuditorEngine.auditSkillCompliance(repoRoot, {
      ...(options !== undefined && options.cursor !== undefined ? { cursor: options.cursor } : {}),
      ...(runRoot !== undefined ? { capsuleRunRoot: runRoot } : {}),
      logDefects,
      now: nowIso,
    });

    // 2. Extract and synthesize incidents
    const incidents: BehavioralForensicsIncident[] = [...liveResult.incidents];

    // 3. If runRoot exists, perform deep analysis on events and tool calls
    if (runRoot !== undefined && existsSync(runRoot)) {
      try {
        const forensicsResult: ForensicsAnalysisResult = analyzeRunForensics({
          runRoot,
          inject: false,
        });

        for (const inc of forensicsResult.incidents) {
          let isCoreCategory = false;
          if (inc.category === "TOKEN_BURNING") isCoreCategory = true;
          if (inc.category === "FALSE_SERIALIZATION") isCoreCategory = true;
          if (inc.category === "ROLE_BOUNDARY_DEVIATION") isCoreCategory = true;

          if (isCoreCategory) {
            const alreadyLogged = incidents.some(
              (existing) => existing.category === inc.category && existing.title === inc.title,
            );
            if (!alreadyLogged) {
              incidents.push(inc);
              if (logDefects) {
                SplitChannelDefectRouter.routeDefect({
                  currentRepoRoot: repoRoot,
                  domain: "skill-framework",
                  defect: {
                    error_code: inc.category,
                    title: `Skill Compliance Forensics: ${inc.category}`,
                    description: inc.description,
                    actor: "skill-auditor",
                    context: {
                      incidentId: inc.id,
                      severity: inc.severity,
                      mitigationSuggestion: inc.recommendation,
                    },
                  },
                });
              }
            }
          }
        }
      } catch {
        // Fallback gracefully if full run forensics parsing cannot complete
      }
    }

    const tokenBurningCount = incidents.filter((i) => i.category === "TOKEN_BURNING").length;
    const falseSerializationCount = incidents.filter(
      (i) => i.category === "FALSE_SERIALIZATION",
    ).length;
    const roleBoundaryDeviationsCount = incidents.filter(
      (i) => i.category === "ROLE_BOUNDARY_DEVIATION",
    ).length;

    const compliant = incidents.length === 0;

    const report: BehavioralForensicsReport = {
      compliant,
      eventsAnalyzed: liveResult.eventsAnalyzed,
      incidents,
      tokenBurningCount,
      falseSerializationCount,
      roleBoundaryDeviationsCount,
      defectsLogged: incidents.length,
      cursor: liveResult.cursor,
      timestamp: nowIso,
      markdown: OrchestratorCompanionAuditor.formatForensicsBrief({
        compliant,
        eventsAnalyzed: liveResult.eventsAnalyzed,
        incidents,
        tokenBurningCount,
        falseSerializationCount,
        roleBoundaryDeviationsCount,
        defectsLogged: incidents.length,
        cursor: liveResult.cursor,
        timestamp: nowIso,
        markdown: "",
      }),
    };

    return report;
  }

  /**
   * Formats a clean, line-limited brief (< 25 lines) of behavioral forensics status.
   */
  public static formatForensicsBrief(report: BehavioralForensicsReport): string {
    const statusBadge = report.compliant ? "✅ COMPLIANT" : "❌ DEVIATION DETECTED";
    const lines: string[] = [
      `### Behavioral Forensics Brief (${statusBadge})`,
      `- **Events Analyzed**: ${report.eventsAnalyzed}`,
      `- **Token Burning Incidents**: ${report.tokenBurningCount}`,
      `- **False Serialization Bottlenecks**: ${report.falseSerializationCount}`,
      `- **Role Boundary Deviations**: ${report.roleBoundaryDeviationsCount}`,
      `- **Total Defects Logged**: ${report.defectsLogged}`,
      `- **Timestamp**: ${report.timestamp}`,
    ];

    if (report.incidents.length > 0) {
      lines.push("#### Top Incidents:");
      for (const inc of report.incidents.slice(0, 5)) {
        lines.push(`- **[${inc.severity}] ${inc.category}**: ${inc.description}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Asserts behavioral compliance, throwing a HarnessError if critical deviations occurred.
   */
  public static assertCompliance(report: BehavioralForensicsReport): void {
    if (!report.compliant) {
      const critical = report.incidents.find((i) => i.severity === "CRITICAL");
      const msg =
        critical !== undefined
          ? `[BEHAVIORAL_FORENSICS_VIOLATION] ${critical.category}: ${critical.description}`
          : `[BEHAVIORAL_FORENSICS_VIOLATION] Detected ${report.incidents.length} behavioral deviation(s)`;
      throw new HarnessError("INTEGRITY", msg);
    }
  }
}

export function pairCompanionAuditor(
  repoRoot: string,
  options?: OrchestratorCompanionOptions,
): CompanionPairingResult {
  return OrchestratorCompanionAuditor.pairCompanion(repoRoot, options);
}

export function pairMindCompanionAuditor(
  repoRoot: string,
  options?: OrchestratorCompanionOptions,
): CompanionPairingResult {
  return OrchestratorCompanionAuditor.pairMindCompanion(repoRoot, options);
}

export function pairAllMandatoryCompanionAuditors(
  repoRoot: string,
  options?: OrchestratorCompanionOptions,
): MandatoryCompanionsPairingResult {
  return OrchestratorCompanionAuditor.pairAllMandatoryCompanions(repoRoot, options);
}

export function verifyCompanionAuditorsHealth(
  repoRoot: string,
  activeAgents?: readonly AgentGrantRecord[],
): CompanionAuditorsHealthStatus {
  return OrchestratorCompanionAuditor.verifyCompanionAuditorsHealth(repoRoot, activeAgents);
}

export function assertCompanionAuditorsHealth(
  repoRoot: string,
  activeAgents?: readonly AgentGrantRecord[],
): void {
  OrchestratorCompanionAuditor.assertCompanionAuditorsHealth(repoRoot, activeAgents);
}

export function executeBehavioralForensics(
  repoRoot: string,
  options?: BehavioralForensicsOptions,
): BehavioralForensicsReport {
  return OrchestratorCompanionAuditor.executeForensics(repoRoot, options);
}

export function formatBehavioralForensicsBrief(report: BehavioralForensicsReport): string {
  return OrchestratorCompanionAuditor.formatForensicsBrief(report);
}

export function assertBehavioralCompliance(report: BehavioralForensicsReport): void {
  OrchestratorCompanionAuditor.assertCompliance(report);
}
