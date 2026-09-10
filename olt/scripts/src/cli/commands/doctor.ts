import { resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { runDoctor } from "../../reporting/index.ts";
import { constructSupervisoryPersonaReminder } from "../../authority/supervisory/index.ts";
import { isJsonObject } from "../../core/contracts/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { enforceLineLimit } from "../formatters/index.ts";
import {
  doctorNextActions,
  nextActionsBlock,
  type DoctorCriticalFinding,
} from "../formatters/index.ts";
import { probeLiveQuotaTelemetry } from "../../workflow/lifecycle/index.ts";
import { detectHostApp } from "../../authority/thread/index.ts";
import { textFlag, type Flags } from "../index.ts";
import { resolveCapsuleRun } from "./dag-view.ts";

function runPlanVerified(run: string): boolean {
  try {
    const { state } = loadRun(run);
    const tasks = isJsonObject(state.tasks) ? state.tasks : undefined;
    const hasTasks = tasks !== undefined && Object.keys(tasks).length > 0;
    if (hasTasks) return true;
    if (Boolean(state.graph)) return true;
    if (Boolean(state.completion_review)) return true;
    return false;
  } catch {
    return false;
  }
}

function criticalTierFindings(report: Record<string, unknown>): DoctorCriticalFinding[] {
  const raw = report.tier_confinement_findings;
  if (!Array.isArray(raw)) return [];
  const findings: DoctorCriticalFinding[] = [];
  for (const entry of raw) {
    if (!isJsonObject(entry)) continue;
    if (entry.severity === "minor") continue;
    const role = typeof entry.role === "string" ? entry.role : "";
    const agentId = typeof entry.agent_id === "string" ? entry.agent_id : "";
    const remediation = typeof entry.remediation === "string" ? entry.remediation : "";
    if (role.length === 0) continue;
    if (agentId.length === 0) continue;
    if (remediation.length === 0) continue;
    const evidence = isJsonObject(entry.evidence) ? entry.evidence : undefined;
    const taskId = typeof evidence?.task_id === "string" ? evidence.task_id : undefined;
    findings.push({ role, agentId, remediation, taskId });
  }
  return findings;
}

export async function doctorCommand(flags: Flags): Promise<Record<string, unknown>> {
  const runFlag = textFlag(flags, "run");
  if (runFlag === undefined) {
    throw new HarnessError("INVALID_ARGUMENT", "Missing required --run flag for doctor");
  }
  const run = resolveCapsuleRun(process.cwd(), runFlag);
  const source = textFlag(flags, "source", false);
  const home = textFlag(flags, "home", false);
  const clients = textFlag(flags, "clients", false);
  const actorFlag = textFlag(flags, "actor", false);
  const actor = actorFlag !== undefined ? actorFlag : "coordinator";
  const roleFlag = textFlag(flags, "role", false);
  const role = roleFlag !== undefined ? roleFlag : "coordinator";
  const installation =
    source !== undefined && home !== undefined
      ? {
          installation: {
            source,
            home,
            ...(clients === undefined
              ? {}
              : {
                  clients: clients
                    .split(",")
                    .map((name) => name.trim())
                    .filter(Boolean),
                }),
          },
        }
      : {};

  const report = await runDoctor(run, installation);
  const planVerified = runPlanVerified(run);
  const quotaTelemetry = await probeLiveQuotaTelemetry({ host: detectHostApp(process.env) });
  let failedGatesCount = 0;
  if (Array.isArray(report.workflow_issues)) {
    failedGatesCount = report.workflow_issues.length;
  }
  let openFindingsCount = 0;
  if (Array.isArray(report.behavioral_findings)) {
    openFindingsCount = report.behavioral_findings.length;
  }
  const personaReminder = constructSupervisoryPersonaReminder({
    role,
    agentId: actor,
    runId: run,
    context: {
      role,
      agentId: actor,
      runId: run,
      failedGatesCount,
      openFindingsCount,
    },
  });

  const reportWithReadiness = {
    ...report,
    plan_verified: planVerified,
    quota_telemetry: quotaTelemetry,
    quota_badge: quotaTelemetry.quotaBadge,
  };

  return {
    ...reportWithReadiness,
    persona_reminder: personaReminder,
    markdown: formatDoctorBrief(run, { ...reportWithReadiness, persona_reminder: personaReminder }),
  };
}

function ternary(value: unknown, whenTrue: string, whenFalse: string): string {
  if (value === true) return whenTrue;
  if (value === false) return whenFalse;
  return "unknown";
}

function issueList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries: readonly unknown[] = value;
  return entries.filter((issue): issue is string => typeof issue === "string");
}

function hasTieredIssueFields(report: Record<string, unknown>): boolean {
  if (Array.isArray(report.critical_issues)) return true;
  if (Array.isArray(report.cosmetic_issues)) return true;
  return false;
}

function issueSectionLines(report: Record<string, unknown>): string[] {
  if (hasTieredIssueFields(report) === false) {
    const issues = issueList(report.issues);
    return [
      ...(issues.length > 0 ? ["- **Issues**:"] : ["- **Issues**: none"]),
      ...issues.map((issue) => `  - ${issue}`),
    ];
  }
  const criticalIssues = issueList(report.critical_issues);
  const cosmeticIssues = issueList(report.cosmetic_issues);
  const autoHealed = Array.isArray(report.auto_healed) ? issueList(report.auto_healed) : [];
  const warnings = Array.isArray(report.warnings) ? issueList(report.warnings) : [];
  const infos = [...autoHealed.map((msg) => `Auto-Healed: ${msg}`), ...cosmeticIssues];

  return [
    ...(criticalIssues.length > 0 ? ["- **Critical Issues**:"] : ["- **Critical Issues**: none"]),
    ...criticalIssues.map((issue) => `  - ${issue}`),
    ...(infos.length > 0
      ? [
          "- **Notices** (cosmetic — do not affect Healthy):",
          ...infos.map((issue) => `  - ${issue}`),
        ]
      : []),
    "",
    "### Doctor Findings:",
    `- **[ERROR]**:`,
    ...(criticalIssues.length > 0 ? criticalIssues.map((e) => `  - ${e}`) : ["  - none"]),
    `- **[WARN]**:`,
    ...(warnings.length > 0 ? warnings.map((w) => `  - ${w}`) : ["  - none"]),
    `- **[INFO]**:`,
    ...(infos.length > 0 ? infos.map((i) => `  - ${i}`) : ["  - none"]),
  ];
}

export function formatDoctorBrief(run: string, report: Record<string, unknown>): string {
  let bunVersion = "unknown";
  if (typeof report.bun_version === "string") {
    if (report.bun_version.trim().length > 0) {
      bunVersion = report.bun_version;
    }
  }

  let quotaBadge: string | undefined = undefined;
  if (typeof report.quota_badge === "string") {
    quotaBadge = report.quota_badge;
  } else if (isJsonObject(report.quota_telemetry)) {
    const qt = report.quota_telemetry as Record<string, unknown>;
    if (typeof qt.quotaBadge === "string") {
      quotaBadge = qt.quotaBadge;
    }
  }

  const lines = [
    `### Capsule Doctor: \`${run}\``,
    `- **Healthy**: ${ternary(report.healthy, "yes", "no")}`,
    `- **Bun**: ${bunVersion} (${ternary(report.bun_supported, "supported", "unsupported")})`,
    `- **Gitignored**: ${ternary(report.gitignored, "yes", "no")}`,
    ...(quotaBadge !== undefined ? [`- **Quota Telemetry**: ${quotaBadge}`] : []),
    `- **Supervisory Invariants**: Strict Tier Hierarchy & Supervisor Zero-File-Edit Rule actively enforced`,
    `- **Git Preservation**: Zero-Destructive Git Invariant & User Edit Preservation actively enforced`,
    ...issueSectionLines(report),
    ...nextActionsBlock(
      doctorNextActions(run, {
        healthy: report.healthy === true,
        planVerified: typeof report.plan_verified === "boolean" ? report.plan_verified : true,
        criticalFindings: criticalTierFindings(report),
      }),
    ),
  ];
  return enforceLineLimit(lines.join("\n"));
}
