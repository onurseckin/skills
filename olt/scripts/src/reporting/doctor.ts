import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { verifyCapsuleDeep, verifyIntegrity } from "../engine/store/index.ts";
import { MINIMUM_BUN_VERSION } from "../core/config/constants.ts";
import { HarnessError } from "../core/errors/index.ts";
import { findRepoRoot } from "../core/shared/paths.ts";
import type { CommandRecord } from "../core/contracts/index.ts";
import type { IntegrityIssue } from "../core/contracts/index.ts";
import type { JsonObject } from "../core/contracts/index.ts";
import { loadRun } from "../engine/store/index.ts";
import { verifyCommandRecord } from "../engine/runner/verify-command.ts";
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
} from "./behavioral-auditor.ts";
import {
  auditTierConfinement,
  summarizeTierConfinement,
  assertSupervisorRoleConfinement,
  type TierConfinementFinding,
  type TierConfinementSummary,
  type TierViolationSeverity,
  type TierViolationType,
} from "./doctor/tier-confinement.ts";
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
import { runDoctorDiagnostics, type HarnessHealthCheck } from "./doctor/adversarial-doctor.ts";

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
};

export interface DoctorOptions {
  installation?: {
    source: string;
    home: string;
    clients?: string[];
  };
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

// Issue codes an operator can safely ignore: they describe layout/naming noise, not data
// loss, a broken invariant, or an operational failure. Everything else defaults to
// "critical" — an issue this classifier does not recognize must never silently vanish
// from Healthy, only a deliberately reviewed code may downgrade to cosmetic.
const COSMETIC_ISSUE_CODES: ReadonlySet<string> = new Set(["LAYOUT_UNDECLARED"]);

export function classifyIssueSeverity(issue: string): DoctorIssueSeverity {
  const code = issue.split(":", 1)[0];
  if (code !== undefined && COSMETIC_ISSUE_CODES.has(code)) return "cosmetic";
  // Behavioral/tier-confinement findings embed their own severity as "[critical]",
  // "[important]" or "[minor]" (see TierViolationSeverity); only "minor" is cosmetic —
  // "critical" and "important" both keep Healthy false, matching prior behaviour.
  if (issue.includes("[minor]")) return "cosmetic";
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
  // The subset of integrityIssues serious enough that loading and auditing the rest of
  // the capsule (state, tier confinement, socratic self-questioning, lifecycle) is unsafe
  // or meaningless — e.g. a broken hash chain. A cosmetic issue such as an undeclared
  // capsule entry does NOT belong here: it has no bearing on whether the run is loadable,
  // and gating the load on it would silently skip every other audit, masking whatever
  // those audits would have found — trading a false red for a worse false green.
  readonly criticalIntegrityIssues: readonly IntegrityIssue[];
  readonly gitignored: boolean | null;
  readonly bunSupported: boolean;
  readonly issues: readonly string[];
  readonly criticalIssues: readonly string[];
  readonly cosmeticIssues: readonly string[];
  readonly healthy: boolean;
}

// The integrity/gitignored/bun-support facts are asked for twice — once by the `doctor`
// command and once by the `report` (unified) command's embedded doctor section. Both
// used to call ignoredByGit/verifyIntegrity/verifyCapsuleDeep independently, which let the
// two surfaces silently disagree about the same capsule. This is the single computation
// both call, so the fields cannot drift apart by construction.
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
  behavioralFindings?: readonly BehavioralFinding[] | readonly TierConfinementFinding[];
  tierConfinementFindings?: readonly TierConfinementFinding[];
  socraticReport?: SocraticAuditReport | undefined;
  lifecycleFindings?: readonly LifecycleFinding[] | undefined;
}): string {
  const issues = params.issues;
  const findings = (params.tierConfinementFindings ??
    params.behavioralFindings ??
    []) as unknown as readonly BehavioralFinding[];
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
  const facts = computeCapsuleDoctorFacts(runRoot, gitCommand);
  const { integrityIssues, criticalIntegrityIssues, gitignored, bunSupported } = facts;
  // Gate on CRITICAL integrity issues only: a cosmetic one (e.g. an undeclared capsule
  // entry) must never suppress loadRun and, with it, every loaded-dependent audit below
  // (tier confinement, socratic, lifecycle, command/packet/workflow) — see
  // CapsuleDoctorFacts.criticalIntegrityIssues.
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
  ];

  // Re-tier over the FULL issue set, not just facts.issues: commandIssues/tierIssues/etc.
  // can themselves carry a "[critical]"/"[minor]" tag (see classifyIssueSeverity) or a
  // cosmetic layout code, and Healthy must reflect all of them, not only the base facts.
  const { criticalIssues, cosmeticIssues, healthy } = tierDoctorIssues(issues);

  const markdown = formatDoctorReport({
    runRoot,
    healthy,
    bunVersion: Bun.version,
    bunSupported,
    gitignored,
    issues,
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
    remedial_actions: remedialActionsForIntegrityIssues(runRoot, integrityIssues),
    issues,
    critical_issues: criticalIssues,
    cosmetic_issues: cosmeticIssues,
    markdown,
  };
}
