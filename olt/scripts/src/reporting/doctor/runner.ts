import { existsSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import type { CommandRecord } from "../../core/contracts/index.ts";
import type { JsonObject } from "../../core/contracts/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { verifyCommandRecord } from "../../engine/runner/signing/verify-command";
import type { PacketRecord } from "../../workflow/types.ts";
import { packetEvidenceIssues } from "../packet-evidence.ts";
import { workflowView } from "../workflow-view.ts";
import { installationStatus } from "../../installer/installation-status.ts";
import { trustedHostEvidence, trustedHostLimitations } from "../../core/contracts/index.ts";
import { repositoryGit, type RepositoryGitCommand } from "../../packets/repository-git-command.ts";
import { inspectRepoPolicy } from "../../policy/repo-policy.ts";
import { auditTierConfinement, summarizeTierConfinement } from "./tier-confinement/index.ts";
import { evaluateSocraticSelfQuestioning } from "../socratic-validator.ts";
import { StateMachineAuditor } from "./state-machine-auditor.ts";
import { runDoctorDiagnostics } from "./adversarial-doctor/index.ts";
import { autoHealCapsule, type DoctorAutoHealResult } from "./engines.ts";
import { computeCapsuleDoctorFacts, tierDoctorIssues } from "./facts.ts";
import { formatDoctorReport } from "./report-formatter.ts";
import { generateRemedialGuidance, remedialActionsForIntegrityIssues } from "./guidance.ts";
import { checkPreCompletionDiagnostics } from "./pre-completion.ts";
import { collectDiagnosticEngines } from "./diagnostic-collector.ts";

export interface DoctorOptions {
  installation?: {
    source: string;
    home: string;
    clients?: string[];
  };
  autoHeal?: boolean;
  repoRoot?: string;
  writeScope?: readonly string[];
  testPaths?: readonly string[];
}

export async function runDoctor(
  runRoot: string,
  options: DoctorOptions = {},
  gitCommand: RepositoryGitCommand = repositoryGit,
): Promise<Record<string, unknown>> {
  let repository: string | undefined = options.repoRoot;
  if (repository === undefined) {
    try {
      repository = findRepoRoot(runRoot);
    } catch (error) {
      if (!(error instanceof HarnessError && error.code === "PATH_SAFETY")) throw error;
    }
  }

  const autoHealEnabled = options.autoHeal ?? true;
  let autoHealResult: DoctorAutoHealResult = {
    autoHealed: [],
    recoveredLeases: [],
    projectionRecovered: false,
    quarantinedFragments: [],
    danglingLocksCleared: [],
    migratedLedgers: [],
    gitIndexHealed: false,
    gitArtifactsStaged: [],
  };

  if (autoHealEnabled) {
    autoHealResult = autoHealCapsule(runRoot, { repoRoot: repository });
  }

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
    } catch {}
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

  const effectiveWriteScope = options.writeScope ?? gitDiffs ?? [];
  const {
    engineResults,
    allEngineFindings,
    engineErrorIssues,
    engineWarnIssues,
    engineInfoIssues,
  } = collectDiagnosticEngines({
    repoRoot: repository,
    writeScope: effectiveWriteScope,
    testPaths: options.testPaths,
    state: (loaded?.state as Record<string, unknown> | undefined) ?? null,
    events: (loaded?.events as readonly unknown[] | undefined) ?? null,
  });

  const preCompletion = checkPreCompletionDiagnostics({
    runRoot,
    repoRoot: repository,
    state: (loaded?.state as Record<string, unknown> | undefined) ?? null,
    events: (loaded?.events as readonly Record<string, unknown>[] | undefined) ?? null,
    autoHeal: autoHealEnabled,
  });

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

  const guidance = generateRemedialGuidance({
    runRoot,
    repoRoot: repository,
    findings: allEngineFindings,
    integrityIssues,
    completionBlockers: preCompletion.blockers.map((b) => b.message),
  });

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
    remedialGuidance: guidance.guidanceSummary,
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
    engine_results: engineResults,
    doctor_findings: allEngineFindings,
    pre_completion_diagnostics: preCompletion,
    guidance: guidance.guidanceSummary,
    remedial_actions: guidance.remedialActions.length > 0
      ? guidance.remedialActions
      : remedialActionsForIntegrityIssues(runRoot, integrityIssues),
    errors,
    warnings,
    infos,
    issues,
    critical_issues: criticalIssues,
    cosmetic_issues: cosmeticIssues,
    markdown,
  };
}
