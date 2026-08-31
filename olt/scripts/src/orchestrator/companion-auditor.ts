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
  public static pairCompanion(
    repoRoot: string,
    options?: OrchestratorCompanionOptions,
  ): CompanionPairingResult {
    const isMandatory = SkillAuditorPolicy.isMandatoryTarget(repoRoot);
    const activeAgents: readonly AgentGrantRecord[] = options?.activeAgents ?? [];
    const explicitAuditor = activeAgents.find(
      (a) => a.role === "skill-auditor" || (a.role as string) === "meta-auditor",
    );
    const pairedAgentId = explicitAuditor
      ? explicitAuditor.id
      : (options?.companionAgentId ?? "skill-auditor-auto");
    const nowIso = options?.now ?? new Date().toISOString();
    const hasExplicitAuditor = explicitAuditor !== undefined;
    const paired = true;
    const autoProvisioned = !hasExplicitAuditor;

    if (options?.strictPolicy === true && isMandatory && !hasExplicitAuditor && !autoProvisioned) {
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

  public static pairMindCompanion(
    repoRoot: string,
    options?: OrchestratorCompanionOptions,
  ): CompanionPairingResult {
    const isMandatory = SkillAuditorPolicy.isMandatoryTarget(repoRoot);
    const activeAgents: readonly AgentGrantRecord[] = options?.activeAgents ?? [];
    const explicitAuditor = activeAgents.find(
      (a) => a.role === "mind-auditor" || (a.role as string) === "meta-auditor",
    );
    const pairedAgentId = explicitAuditor
      ? explicitAuditor.id
      : (options?.companionAgentId ?? "mind-auditor-auto");
    const nowIso = options?.now ?? new Date().toISOString();
    const hasExplicitAuditor = explicitAuditor !== undefined;
    const paired = true;
    const autoProvisioned = !hasExplicitAuditor;

    if (options?.strictPolicy === true && isMandatory && !hasExplicitAuditor && !autoProvisioned) {
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

  public static pairAllMandatoryCompanions(
    repoRoot: string,
    options?: OrchestratorCompanionOptions,
  ): MandatoryCompanionsPairingResult {
    const skillAuditor = this.pairCompanion(repoRoot, options);
    const mindAuditor = this.pairMindCompanion(repoRoot, options);
    return { skillAuditor, mindAuditor, allPaired: skillAuditor.paired && mindAuditor.paired };
  }

  public static verifyCompanionAuditorsHealth(
    repoRoot: string,
    activeAgents?: readonly AgentGrantRecord[],
  ): CompanionAuditorsHealthStatus {
    const isMandatory = SkillAuditorPolicy.isMandatoryTarget(repoRoot);
    const agents: readonly AgentGrantRecord[] = activeAgents ?? [];
    const active = agents.filter((a) => a.status === "active");
    const mindAuditorActive = active.some(
      (a) =>
        a.role === "mind-auditor" ||
        (a.role as string) === "meta-auditor" ||
        a.id.includes("mind-auditor"),
    );
    const skillAuditorActive = active.some(
      (a) =>
        a.role === "skill-auditor" ||
        (a.role as string) === "meta-auditor" ||
        a.id.includes("skill-auditor"),
    );

    const issues: string[] = [];
    if (!mindAuditorActive && isMandatory)
      issues.push("Mandatory mind-auditor companion is not active in the agent ledger.");
    if (!skillAuditorActive && isMandatory)
      issues.push("Mandatory skill-auditor companion is not active in the agent ledger.");

    return {
      healthy: (!isMandatory || (mindAuditorActive && skillAuditorActive)) && issues.length === 0,
      mindAuditorActive,
      skillAuditorActive,
      isMandatoryTarget: isMandatory,
      issues,
    };
  }

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

  public static executeForensics(
    repoRoot: string,
    options?: BehavioralForensicsOptions,
  ): BehavioralForensicsReport {
    const nowIso = options?.now ?? new Date().toISOString();
    const runRoot = options?.capsuleRunRoot;
    const logDefects = options?.logDefects ?? true;

    const liveResult: SkillAuditLiveResult = SkillAuditorEngine.auditSkillCompliance(repoRoot, {
      ...(options?.cursor !== undefined ? { cursor: options.cursor } : {}),
      ...(runRoot !== undefined ? { capsuleRunRoot: runRoot } : {}),
      logDefects,
      now: nowIso,
    });

    const incidents: BehavioralForensicsIncident[] = [...liveResult.incidents];

    if (runRoot !== undefined && existsSync(runRoot)) {
      try {
        const forensicsResult: ForensicsAnalysisResult = analyzeRunForensics({
          runRoot,
          inject: false,
        });
        for (const inc of forensicsResult.incidents) {
          if (
            inc.category === "TOKEN_BURNING" ||
            inc.category === "FALSE_SERIALIZATION" ||
            inc.category === "ROLE_BOUNDARY_DEVIATION"
          ) {
            const alreadyLogged = incidents.some(
              (e) => e.category === inc.category && e.title === inc.title,
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
      } catch {}
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

  public static formatForensicsBrief(report: BehavioralForensicsReport): string {
    const statusBadge = report.compliant ? "✅ COMPLIANT" : "❌ DEVIATION DETECTED";
    const lines = [
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

export const pairCompanionAuditor = OrchestratorCompanionAuditor.pairCompanion.bind(
  OrchestratorCompanionAuditor,
);
export const pairMindCompanionAuditor = OrchestratorCompanionAuditor.pairMindCompanion.bind(
  OrchestratorCompanionAuditor,
);
export const pairAllMandatoryCompanionAuditors =
  OrchestratorCompanionAuditor.pairAllMandatoryCompanions.bind(OrchestratorCompanionAuditor);
export const verifyCompanionAuditorsHealth =
  OrchestratorCompanionAuditor.verifyCompanionAuditorsHealth.bind(OrchestratorCompanionAuditor);
export const assertCompanionAuditorsHealth =
  OrchestratorCompanionAuditor.assertCompanionAuditorsHealth.bind(OrchestratorCompanionAuditor);
export const executeBehavioralForensics = OrchestratorCompanionAuditor.executeForensics.bind(
  OrchestratorCompanionAuditor,
);
export const formatBehavioralForensicsBrief =
  OrchestratorCompanionAuditor.formatForensicsBrief.bind(OrchestratorCompanionAuditor);
export const assertBehavioralCompliance = OrchestratorCompanionAuditor.assertCompliance.bind(
  OrchestratorCompanionAuditor,
);
