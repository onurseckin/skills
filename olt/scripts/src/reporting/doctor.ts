import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { verifyCapsuleDeep, verifyIntegrity } from "../engine/store/index.ts";
import { MINIMUM_BUN_VERSION } from "../core/config/constants.ts";
import { findRepoRoot } from "../core/shared/paths.ts";
import type { CommandRecord } from "../core/contracts/commands.ts";
import type { JsonObject } from "../core/contracts/json.ts";
import { loadRun } from "../engine/store/index.ts";
import { verifyCommandRecord } from "../engine/runner/verify-command.ts";
import type { PacketRecord } from "../workflow/types.ts";
import { packetEvidenceIssues } from "./packet-evidence.ts";
import { workflowView } from "./workflow-view.ts";
import { installationStatus } from "../installer/installation-status.ts";
import { trustedHostEvidence, trustedHostLimitations } from "../core/contracts/trusted-host.ts";
import { repositoryGit, type RepositoryGitCommand } from "../packets/repository-git-command.ts";
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
  const repository = findRepoRoot(runRoot);
  if (!existsSync(join(repository, ".git"))) return null;
  try {
    return command(repository, ["check-ignore", "--quiet", runRoot], 1024, [0, 1]).status === 0;
  } catch {
    return null;
  }
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

export async function runDoctor(
  runRoot: string,
  options: DoctorOptions = {},
  gitCommand: RepositoryGitCommand = repositoryGit,
): Promise<Record<string, unknown>> {
  const integrityIssues = [...verifyIntegrity(runRoot), ...verifyCapsuleDeep(runRoot)];
  const gitignored = ignoredByGit(runRoot, gitCommand);
  const bunSupported = versionAtLeast(Bun.version, MINIMUM_BUN_VERSION);
  const loaded = integrityIssues.length === 0 ? loadRun(runRoot) : undefined;
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
  const repository = findRepoRoot(runRoot);
  if (existsSync(join(repository, ".git"))) {
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

  const issues = [
    ...integrityIssues.map(({ code, message }) => `${code}: ${message}`),
    ...(gitignored === false ? ["run capsule is not gitignored"] : []),
    ...(bunSupported ? [] : [`Bun ${Bun.version} is below ${MINIMUM_BUN_VERSION}`]),
    ...commandIssues,
    ...packetIssues,
    ...workflowIssues,
    ...tierIssues,
    ...socraticIssues,
    ...installationIssues,
  ];

  const healthy = issues.length === 0;

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
    installation: installation ?? null,
    installation_issues: installationIssues,
    issues,
    markdown,
  };
}
