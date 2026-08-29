import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { verifyIntegrity } from "../engine/store/index.ts";
import { verifyCapsuleDeep } from "../engine/store/index.ts";
import { MINIMUM_BUN_VERSION } from "../core/config/contracts.ts";
import { HarnessError } from "../core/errors/index.ts";
import { findRepoRoot } from "../core/shared/paths.ts";
import type { CommandRecord } from "../core/contracts/index.ts";
import type { IntegrityIssue } from "../core/contracts/index.ts";
import type { JsonObject } from "../core/contracts/index.ts";
import { loadRun } from "../engine/store/index.ts";
import { verifyCommandRecord } from "../engine/runner/signing/verify-command";
import type { PacketRecord } from "../workflow/types.ts";
import { packetEvidenceIssues } from "./packet-evidence.ts";
import { workflowView } from "./workflow-view.ts";
import { installationStatus } from "../installer/installation-status.ts";
import { trustedHostEvidence, trustedHostLimitations } from "../core/contracts/index.ts";
import { repositoryGit, type RepositoryGitCommand } from "../packets/repository-git-command.ts";
import { inspectRepoPolicy } from "../policy/repo-policy.ts";
import {
  auditBehavioralHealth,
  formatBehavioralRoleHealthSection,
  type BehavioralFinding,
  type BehavioralSeverity,
  type BehavioralViolationType,
} from "./behavioral-auditor/index.ts";
import {
  auditTierConfinement,
  summarizeTierConfinement,
  assertSupervisorRoleConfinement,
  type TierConfinementFinding,
  type TierConfinementSummary,
  type TierViolationSeverity,
  type TierViolationType,
} from "./doctor/tier-confinement/index.ts";
import {
  evaluateSocraticSelfQuestioning,
  formatSocraticAuditSection,
  type SocraticAuditReport,
  type SocraticDimension,
  type SocraticQuestionEvaluation,
} from "./socratic-validator.ts";
import {
  StateMachineAuditor,
  type LifecycleFinding,
  type LifecycleAuditSummary,
} from "./doctor/state-machine-auditor.ts";
import {
  runDoctorDiagnostics,
  type HarnessHealthCheck,
} from "./doctor/adversarial-doctor/index.ts";
import {
  checkPlanningDag,
  checkAstPurity,
  checkAntiMockMutation,
  checkAntiBatchingIsolation,
  checkDualChannelUi,
  checkCognitiveValidatorCommandLock,
  checkRoleBoundaryInterlock,
  checkPushbackQuotas,
  checkPolicyDoctor,
  auditPolicyDoctor,
  autoHealCapsule,
  MIN_ADVERSARIAL_PROBES,
  MANDATORY_COGNITIVE_PUSHBACKS,
  type DoctorSeverity,
  type DoctorDiagnosticFinding,
  type DoctorCheckEngineResult,
  type DoctorAutoHealResult,
  type PlanningDagCheckOptions,
  type AstPurityCheckOptions,
  type AntiMockMutationCheckOptions,
  type AntiBatchingIsolationOptions,
  type DualChannelUiCheckOptions,
  type CognitiveValidatorCommandLockOptions,
  type RoleBoundaryInterlockOptions,
  type PushbackQuotasCheckOptions,
  type PolicyDoctorOptions,
  type AutoHealOptions,
} from "./doctor/engines.ts";

export {
  auditBehavioralHealth,
  formatBehavioralRoleHealthSection,
  type BehavioralFinding,
  type BehavioralSeverity,
  type BehavioralViolationType,
  auditTierConfinement,
  summarizeTierConfinement,
  assertSupervisorRoleConfinement,
  type TierConfinementFinding,
  type TierConfinementSummary,
  type TierViolationSeverity,
  type TierViolationType,
  evaluateSocraticSelfQuestioning,
  formatSocraticAuditSection,
  type SocraticAuditReport,
  type SocraticDimension,
  type SocraticQuestionEvaluation,
  StateMachineAuditor,
  type LifecycleFinding,
  type LifecycleAuditSummary,
  runDoctorDiagnostics,
  type HarnessHealthCheck,
  checkPlanningDag,
  checkAstPurity,
  checkAntiMockMutation,
  checkAntiBatchingIsolation,
  checkDualChannelUi,
  checkCognitiveValidatorCommandLock,
  checkRoleBoundaryInterlock,
  checkPushbackQuotas,
  checkPolicyDoctor,
  auditPolicyDoctor,
  autoHealCapsule,
  MIN_ADVERSARIAL_PROBES,
  MANDATORY_COGNITIVE_PUSHBACKS,
  type DoctorSeverity,
  type DoctorDiagnosticFinding,
  type DoctorCheckEngineResult,
  type DoctorAutoHealResult,
  type PlanningDagCheckOptions,
  type AstPurityCheckOptions,
  type AntiMockMutationCheckOptions,
  type AntiBatchingIsolationOptions,
  type DualChannelUiCheckOptions,
  type CognitiveValidatorCommandLockOptions,
  type RoleBoundaryInterlockOptions,
  type PushbackQuotasCheckOptions,
  type PolicyDoctorOptions,
  type AutoHealOptions,
};

export interface DoctorOptions {
  installation?: {
    source: string;
    home: string;
    clients?: string[];
  };
  autoHeal?: boolean;
  writeScope?: readonly string[];
  testPaths?: readonly string[];
}

export function versionAtLeast(actual: string, minimum: string): boolean {
  const left = actual.split(".").map(Number);
  const right = minimum.split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

export function ignoredByGit(
  runRoot: string,
  command: RepositoryGitCommand = repositoryGit,
): boolean | null {
  let repository: string;
  try {
    repository = findRepoRoot(runRoot);
  } catch (error) {
    if (error instanceof HarnessError && error.code === "PATH_SAFETY") return null;
    throw error;
  }
  if (!existsSync(join(repository, ".git"))) return null;
  try {
    return command(repository, ["check-ignore", "--quiet", runRoot], 1024, [0, 1]).status === 0;
  } catch {
    return null;
  }
}

export type DoctorIssueSeverity = "critical" | "cosmetic";

const COSMETIC_ISSUE_CODES: ReadonlySet<string> = new Set(["LAYOUT_UNDECLARED"]);

export function classifyIssueSeverity(issue: string): DoctorIssueSeverity {
  const code = issue.split(":", 1)[0];
  if (code !== undefined && COSMETIC_ISSUE_CODES.has(code)) return "cosmetic";
  if (issue.startsWith("[INFO]") || issue.includes("[minor]")) return "cosmetic";
  return "critical";
}

export interface DoctorIssueTiering {
  readonly criticalIssues: readonly string[];
  readonly cosmeticIssues: readonly string[];
  readonly healthy: boolean;
}

export function tierDoctorIssues(issues: readonly string[]): DoctorIssueTiering {
  const criticalIssues = issues.filter((issue) => classifyIssueSeverity(issue) === "critical");
  const cosmeticIssues = issues.filter((issue) => classifyIssueSeverity(issue) === "cosmetic");
  return { criticalIssues, cosmeticIssues, healthy: criticalIssues.length === 0 };
}

export interface CapsuleDoctorFacts {
  readonly integrityIssues: readonly IntegrityIssue[];
  readonly criticalIntegrityIssues: readonly IntegrityIssue[];
  readonly gitignored: boolean | null;
  readonly bunSupported: boolean;
  readonly issues: readonly string[];
  readonly criticalIssues: readonly string[];
  readonly cosmeticIssues: readonly string[];
  readonly healthy: boolean;
}

export function computeCapsuleDoctorFacts(
  runRoot: string,
  gitCommand: RepositoryGitCommand = repositoryGit,
): CapsuleDoctorFacts {
  const integrityIssues = [...verifyIntegrity(runRoot), ...verifyCapsuleDeep(runRoot)];
  const criticalIntegrityIssues = integrityIssues.filter(
    (issue) => classifyIssueSeverity(`${issue.code}: ${issue.message}`) === "critical",
  );
  const gitignored = ignoredByGit(runRoot, gitCommand);
  const bunSupported = versionAtLeast(Bun.version, MINIMUM_BUN_VERSION);
  const issues = [
    ...integrityIssues.map(({ code, message }) => `${code}: ${message}`),
    ...(gitignored === false ? ["run capsule is not gitignored"] : []),
    ...(bunSupported ? [] : [`Bun ${Bun.version} is below ${MINIMUM_BUN_VERSION}`]),
  ];
  const tiering = tierDoctorIssues(issues);
  return { integrityIssues, criticalIntegrityIssues, gitignored, bunSupported, issues, ...tiering };
}

export function formatDoctorReport(params: {
  runRoot: string;
  healthy: boolean;
  bunVersion: string;
  bunSupported: boolean;
  gitignored: boolean | null;
  issues: readonly string[];
  errors?: readonly string[];
  warnings?: readonly string[];
  infos?: readonly string[];
  autoHealed?: readonly string[];
  behavioralFindings?: readonly BehavioralFinding[] | readonly TierConfinementFinding[];
  tierConfinementFindings?: readonly TierConfinementFinding[];
  socraticReport?: SocraticAuditReport | undefined;
  lifecycleFindings?: readonly LifecycleFinding[] | undefined;
}): string {
  const issues = params.issues;
  const findings = (params.tierConfinementFindings ??
    params.behavioralFindings ??
    []) as unknown as readonly BehavioralFinding[];

  const errors = params.errors ?? issues.filter((i) => classifyIssueSeverity(i) === "critical");
  const warnings = params.warnings ?? [];
  const infos = [
    ...(params.autoHealed ?? []).map((h) => `Auto-Healed: ${h}`),
    ...(params.infos ?? issues.filter((i) => classifyIssueSeverity(i) === "cosmetic")),
  ];

  const lines = [
    `### Capsule Doctor: \`${params.runRoot}\``,
    `- **Healthy**: ${params.healthy ? "yes" : "no"}`,
    `- **Bun**: ${params.bunVersion} (${params.bunSupported ? "supported" : "unsupported"})`,
    `- **Gitignored**: ${
      params.gitignored === true ? "yes" : params.gitignored === false ? "no" : "unknown"
    }`,
    ...(issues.length > 0 ? ["- **Issues**:"] : ["- **Issues**: none"]),
    ...issues.map((issue) => `  - ${issue}`),
    "",
    "### Doctor Findings:",
    `- **[ERROR]**:`,
    ...(errors.length > 0 ? errors.map((e) => `  - ${e}`) : ["  - none"]),
    `- **[WARN]**:`,
    ...(warnings.length > 0 ? warnings.map((w) => `  - ${w}`) : ["  - none"]),
    `- **[INFO]**:`,
    ...(infos.length > 0 ? infos.map((i) => `  - ${i}`) : ["  - none"]),
    "",
    formatBehavioralRoleHealthSection(findings),
    "",
    ...(params.socraticReport ? [formatSocraticAuditSection(params.socraticReport)] : []),
  ];
  return lines.join("\n");
}

export interface DoctorRemedialAction {
  readonly issueCode: string;
  readonly command: string;
  readonly description: string;
}

const STATE_PROJECTION_ISSUE_CODE = "STATE_PROJECTION";

export function remedialActionsForIntegrityIssues(
  runRoot: string,
  integrityIssues: readonly IntegrityIssue[],
): readonly DoctorRemedialAction[] {
  const actions: DoctorRemedialAction[] = [];
  if (integrityIssues.some((issue) => issue.code === STATE_PROJECTION_ISSUE_CODE)) {
    actions.push({
      issueCode: STATE_PROJECTION_ISSUE_CODE,
      command: `bun harness.ts doctor:repair --run ${runRoot} --actor <ACTOR>`,
      description:
        "state.json no longer matches the event chain's final projection; doctor:repair re-derives it from the last complete event, quarantining any torn tail.",
    });
  }
  return actions;
}

export async function runDoctor(
  runRoot: string,
  options: DoctorOptions = {},
  gitCommand: RepositoryGitCommand = repositoryGit,
): Promise<Record<string, unknown>> {
  // 1. Auto-Healing: Auto-heal projection mismatches, torn event tails, and stale leases by default
  const autoHealEnabled = options.autoHeal ?? true;
  let autoHealResult: DoctorAutoHealResult = {
    autoHealed: [],
    recoveredLeases: [],
    projectionRecovered: false,
    quarantinedFragments: [],
  };

  if (autoHealEnabled) {
    autoHealResult = autoHealCapsule(runRoot);
  }

  // 2. Compute Capsule Doctor Facts post-healing
  const facts = computeCapsuleDoctorFacts(runRoot, gitCommand);
  const { integrityIssues, criticalIntegrityIssues, gitignored, bunSupported } = facts;

  const loaded = criticalIntegrityIssues.length === 0 ? loadRun(runRoot) : undefined;
  const commandIssues = loaded
    ? Object.values((loaded.state.commands ?? {}) as Record<string, CommandRecord>).flatMap(
        (record) =>
          verifyCommandRecord(runRoot, record).map((issue) => `command ${record.id}: ${issue}`),
      )
    : [];
  const packetIssues = loaded
    ? packetEvidenceIssues(runRoot, (loaded.state.packets ?? {}) as Record<string, PacketRecord>)
    : [];
  const view = loaded?.state.graph ? workflowView(runRoot) : undefined;
  const workflowIssues = view
    ? [
        ...((view.stale_evidence ?? []) as string[]),
        ...((view.completion_blockers ?? []) as string[]),
      ]
    : [];
  const installation = options.installation
    ? await installationStatus(
        options.installation.source,
        options.installation.home,
        options.installation.clients,
      )
    : undefined;
  const installationIssues = (installation?.issues ?? []).map((issue) => `installation: ${issue}`);

  let gitDiffs: string[] | undefined = undefined;
  let repository: string | undefined;
  try {
    repository = findRepoRoot(runRoot);
  } catch (error) {
    if (!(error instanceof HarnessError && error.code === "PATH_SAFETY")) throw error;
  }
  if (repository !== undefined && existsSync(join(repository, ".git"))) {
    try {
      const diffOutput = gitCommand(repository, ["diff", "--name-only"], 1024 * 64, [0]);
      if (diffOutput.status === 0) {
        const text = new TextDecoder().decode(diffOutput.bytes);
        gitDiffs = text
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
    } catch {
      // Graceful fallback if git probe fails
    }
  }

  const tierFindings = loaded ? auditTierConfinement(runRoot, loaded.state, gitDiffs) : [];
  const tierSummary = summarizeTierConfinement(tierFindings);
  const tierIssues = tierSummary.issues;

  const behavioralFindings = tierFindings;
  const behavioralIssues = tierIssues;

  const socraticReport = evaluateSocraticSelfQuestioning(
    runRoot,
    loaded?.state as JsonObject | undefined,
  );
  const socraticIssues = socraticReport.issues;

  const lifecycleFindings = loaded
    ? StateMachineAuditor.auditLifecycle(
        (loaded.state ?? {}) as Record<string, unknown>,
        (loaded.events ?? []) as readonly Record<string, unknown>[],
      )
    : [];
  const lifecycleSummary = StateMachineAuditor.summarizeLifecycle(lifecycleFindings);
  const lifecycleIssues = lifecycleSummary.issues;

  const policyInspection = inspectRepoPolicy(repository);
  const policyIssues =
    policyInspection.status === "invalid_custom"
      ? [
          `policy: .olt/policy.json is corrupted or invalid: ${policyInspection.error ?? "unknown error"}`,
        ]
      : [];

  const diagnosticChecks = await runDoctorDiagnostics({
    runRoot,
    ...(repository !== undefined ? { repoRoot: repository } : {}),
    state: (loaded?.state as Record<string, unknown> | undefined) ?? null,
    checkBunVersion: false,
    checkCapsuleRoot: true,
    checkUnifiedEvidence: true,
    checkTierConfinement: false,
    checkIntegrity: false,
  });
  const diagnosticIssues = diagnosticChecks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.category}: ${check.message}`);

  // 3. Run the 8 Diagnostic Engines
  const engine1 = checkPlanningDag({
    tasks: (loaded?.state?.tasks as Record<string, unknown> | undefined) ?? null,
    graph: (loaded?.state?.graph as { nodes?: []; edges?: [] } | undefined) ?? null,
  });

  const effectiveWriteScope = options.writeScope ?? gitDiffs ?? [];
  const engine2 = checkAstPurity({
    repoRoot: repository,
    writeScope: effectiveWriteScope,
  });

  const engine3 = checkAntiMockMutation({
    repoRoot: repository,
    targetPaths: options.testPaths,
  });

  const engine4 = checkAntiBatchingIsolation({
    state: (loaded?.state as Record<string, unknown> | undefined) ?? null,
    tasks: (loaded?.state?.tasks as Record<string, unknown> | undefined) ?? null,
    grants: (loaded?.state?.grants as readonly unknown[] | undefined) ?? null,
  });

  const engine5 = checkDualChannelUi();

  const engine6 = checkCognitiveValidatorCommandLock({
    state: (loaded?.state as Record<string, unknown> | undefined) ?? null,
    commands: (loaded?.state?.commands as Record<string, unknown> | undefined) ?? null,
    events: (loaded?.events as readonly Record<string, unknown>[] | undefined) ?? null,
    grants: (loaded?.state?.grants as readonly unknown[] | undefined) ?? null,
  });

  const engine7 = checkRoleBoundaryInterlock({
    state: (loaded?.state as Record<string, unknown> | undefined) ?? null,
    commands: (loaded?.state?.commands as Record<string, unknown> | undefined) ?? null,
    events: (loaded?.events as readonly Record<string, unknown>[] | undefined) ?? null,
    grants: (loaded?.state?.grants as readonly unknown[] | undefined) ?? null,
  });

  const engine8 = checkPushbackQuotas({
    state: (loaded?.state as Record<string, unknown> | undefined) ?? null,
    tasks: (loaded?.state?.tasks as Record<string, unknown> | undefined) ?? null,
    events: (loaded?.events as readonly Record<string, unknown>[] | undefined) ?? null,
    repoRoot: repository,
  });

  const engine9 = checkPolicyDoctor({
    repoRoot: repository,
    state: (loaded?.state as Record<string, unknown> | undefined) ?? null,
    tasks: (loaded?.state?.tasks as Record<string, unknown> | undefined) ?? null,
    commands: (loaded?.state?.commands as Record<string, unknown> | undefined) ?? null,
    events: (loaded?.events as readonly Record<string, unknown>[] | undefined) ?? null,
    grants: (loaded?.state?.grants as readonly unknown[] | undefined) ?? null,
  });

  const allEngineFindings = [
    ...engine1.findings,
    ...engine2.findings,
    ...engine3.findings,
    ...engine4.findings,
    ...engine5.findings,
    ...engine6.findings,
    ...engine7.findings,
    ...engine8.findings,
    ...engine9.findings,
  ];

  const engineErrorIssues = allEngineFindings
    .filter((f) => f.severity === "ERROR")
    .map((f) => `${f.engine}: ${f.message}`);

  const engineWarnIssues = allEngineFindings
    .filter((f) => f.severity === "WARN")
    .map((f) => `${f.engine}: ${f.message}`);

  const engineInfoIssues = allEngineFindings
    .filter((f) => f.severity === "INFO")
    .map((f) => `[INFO] ${f.engine}: ${f.message}`);

  const autoHealedNotices = autoHealResult.autoHealed.map((msg) => `[INFO] Auto-Healed: ${msg}`);

  const issues = [
    ...facts.issues,
    ...commandIssues,
    ...packetIssues,
    ...workflowIssues,
    ...tierIssues,
    ...socraticIssues,
    ...lifecycleIssues,
    ...installationIssues,
    ...policyIssues,
    ...diagnosticIssues,
    ...engineErrorIssues,
    ...engineWarnIssues,
    ...engineInfoIssues,
    ...autoHealedNotices,
  ];

  const { criticalIssues, cosmeticIssues, healthy } = tierDoctorIssues(issues);

  const errors = criticalIssues;
  const warnings = engineWarnIssues;
  const infos = [
    ...autoHealResult.autoHealed.map((msg) => `Auto-Healed: ${msg}`),
    ...cosmeticIssues,
    ...engineInfoIssues.map((msg) => msg.replace(/^\[INFO\]\s*/u, "")),
  ];

  const markdown = formatDoctorReport({
    runRoot,
    healthy,
    bunVersion: Bun.version,
    bunSupported,
    gitignored,
    issues,
    errors,
    warnings,
    infos,
    autoHealed: autoHealResult.autoHealed,
    behavioralFindings,
    tierConfinementFindings: tierFindings,
    socraticReport,
    lifecycleFindings,
  });

  return {
    healthy,
    gate_evidence: trustedHostEvidence(),
    gate_evidence_limitations: trustedHostLimitations(),
    run_root: runRoot,
    bun_version: Bun.version,
    bun_supported: bunSupported,
    gitignored,
    auto_healed: autoHealResult.autoHealed,
    auto_heal_result: autoHealResult,
    integrity_issues: integrityIssues,
    command_issues: commandIssues,
    packet_issues: packetIssues,
    workflow_issues: workflowIssues,
    behavioral_findings: behavioralFindings,
    behavioral_issues: behavioralIssues,
    tier_confinement_findings: tierFindings,
    tier_confinement_issues: tierIssues,
    socratic_audit: socraticReport,
    socratic_issues: socraticIssues,
    lifecycle_findings: lifecycleFindings,
    lifecycle_issues: lifecycleIssues,
    installation: installation ?? null,
    installation_issues: installationIssues,
    policy_inspection: policyInspection,
    diagnostic_checks: diagnosticChecks,
    diagnostic_issues: diagnosticIssues,
    engine_results: {
      checkPlanningDag: engine1,
      checkAstPurity: engine2,
      checkAntiMockMutation: engine3,
      checkAntiBatchingIsolation: engine4,
      checkDualChannelUi: engine5,
      checkCognitiveValidatorCommandLock: engine6,
      checkRoleBoundaryInterlock: engine7,
      checkPushbackQuotas: engine8,
      checkPolicyDoctor: engine9,
    },
    doctor_findings: allEngineFindings,
    errors,
    warnings,
    infos,
    remedial_actions: remedialActionsForIntegrityIssues(runRoot, integrityIssues),
    issues,
    critical_issues: criticalIssues,
    cosmetic_issues: cosmeticIssues,
    markdown,
  };
}
