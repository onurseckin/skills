import type { Finding } from "../../contracts/workflow.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { findingClassOf, type FindingClass } from "../../workflow/review/finding-class.ts";
import type { RevalidationProof } from "../../workflow/review/validate-review.ts";
import { listFlag, type Flags } from "../options.ts";

/**
 * How an answer is labelled once the validator has named the finding and cited the command that
 * answers it. The label restates the finding's own class; it never stands in for the naming, which
 * only the validator can do.
 */
const METHOD_BY_CLASS: Record<FindingClass, string> = {
  defect: "verification_passed",
  probe_demand: "probe_demand_answered",
};

function splitPair(entry: string, flag: string): [string, string] {
  const index = entry.indexOf("=");
  if (index <= 0 || index === entry.length - 1) {
    throw new HarnessError("INVALID_ARGUMENT", `--${flag} must be given as <finding-id>=<value>`);
  }
  return [entry.slice(0, index), entry.slice(index + 1)];
}

function methodFor(finding: Finding, explicit: string | undefined): string {
  if (explicit !== undefined) return explicit;
  const declared = findingClassOf(finding);
  if (declared === null) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `finding ${finding.id} declares no class; pass --resolution-method ${finding.id}=<how it was answered>`,
    );
  }
  return METHOD_BY_CLASS[declared];
}

/**
 * A probe demand asks the implementation to prove something and a defect asks it to be fixed;
 * neither is answered by the harness noticing that some validator command happened to succeed. The
 * validator names the finding and the command that answers it, or the finding stays open.
 */
export function resolutionProofs(
  flags: Flags,
  taskId: string,
  openFindings: readonly Finding[],
): RevalidationProof[] {
  const methods = new Map<string, string>();
  for (const entry of listFlag(flags, "resolution-method") ?? []) {
    const [findingId, method] = splitPair(entry, "resolution-method");
    if (methods.has(findingId)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `finding ${findingId} has two --resolution-method`,
      );
    }
    methods.set(findingId, method);
  }

  const evidence = new Map<string, string[]>();
  for (const entry of listFlag(flags, "resolve") ?? []) {
    const [findingId, commands] = splitPair(entry, "resolve");
    const commandIds = commands
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (commandIds.length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", `--resolve ${findingId} cites no command id`);
    }
    evidence.set(findingId, [...(evidence.get(findingId) ?? []), ...commandIds]);
  }

  for (const findingId of [...evidence.keys(), ...methods.keys()]) {
    if (!openFindings.some((finding) => finding.id === findingId)) {
      throw new HarnessError("INVALID_ARGUMENT", `${taskId} has no open finding ${findingId}`);
    }
  }

  return [...evidence].map(([findingId, commandIds]) => {
    const finding = openFindings.find((candidate) => candidate.id === findingId)!;
    return {
      finding_id: findingId,
      method: methodFor(finding, methods.get(findingId)),
      evidence: commandIds.map((commandId) => ({ command_id: commandId })),
    };
  });
}

/** A rejection records a finding; it closes none, so an answer given with one is a mistake. */
export function assertNoResolutions(flags: Flags): void {
  const given = [
    ...(listFlag(flags, "resolve") ?? []),
    ...(listFlag(flags, "resolution-method") ?? []),
  ];
  if (given.length > 0) {
    throw new HarnessError("INVALID_ARGUMENT", "--resolve applies to a passing verdict only");
  }
}

export function assertOpenFindingsAnswered(
  taskId: string,
  openFindings: readonly Finding[],
  proofs: readonly RevalidationProof[],
): void {
  const answered = new Set(proofs.map((proof) => proof.finding_id));
  const unanswered = openFindings
    .filter((finding) => !answered.has(finding.id))
    .map((finding) => finding.id);
  if (unanswered.length === 0) return;
  throw new HarnessError(
    "INVALID_STATE",
    `cannot pass ${taskId}: ${unanswered.length} open finding(s) unanswered: ${unanswered.join(", ")}; answer each with --resolve <finding-id>=<command-id>`,
  );
}
