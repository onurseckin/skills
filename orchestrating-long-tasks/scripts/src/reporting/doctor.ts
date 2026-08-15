import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { verifyIntegrity } from "../store/index.ts";
import { MINIMUM_BUN_VERSION } from "../config/constants.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import { loadRun } from "../store/index.ts";
import { verifyCommandRecord } from "../runner/verify-command.ts";
import type { PacketRecord } from "../workflow/types.ts";
import { packetEvidenceIssues } from "./packet-evidence.ts";
import { workflowView } from "./workflow-view.ts";
import { installationStatus } from "../installer/installation-status.ts";
import { trustedHostEvidence, trustedHostLimitations } from "../contracts/trusted-host.ts";
import { repositoryGit, type RepositoryGitCommand } from "../packets/repository-git-command.ts";

export interface DoctorOptions {
  installation?: {
    source: string;
    home: string;
    clients?: string[];
  };
}

function versionAtLeast(actual: string, minimum: string): boolean {
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
  const repository = dirname(dirname(runRoot));
  if (!existsSync(join(repository, ".git"))) return null;
  try {
    return command(repository, ["check-ignore", "--quiet", runRoot], 1024, [0, 1]).status === 0;
  } catch {
    return false;
  }
}

export async function runDoctor(
  runRoot: string,
  options: DoctorOptions = {},
): Promise<Record<string, unknown>> {
  const integrityIssues = verifyIntegrity(runRoot);
  const gitignored = ignoredByGit(runRoot);
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
  const issues = [
    ...integrityIssues.map(({ code, message }) => `${code}: ${message}`),
    ...(gitignored === false ? ["run capsule is not gitignored"] : []),
    ...(!bunSupported ? [`Bun ${Bun.version} is below ${MINIMUM_BUN_VERSION}`] : []),
    ...commandIssues,
    ...packetIssues,
    ...workflowIssues,
    ...installationIssues,
  ];
  return {
    healthy: issues.length === 0,
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
    installation: installation ?? null,
    installation_issues: installationIssues,
    issues,
  };
}
