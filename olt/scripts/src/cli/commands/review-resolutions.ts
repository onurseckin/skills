import type { Finding } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { findingClassOf, type FindingClass } from "../../workflow/review/index.ts";
import type { RevalidationProof } from "../../workflow/review/index.ts";
import { listFlag, type Flags } from "../index.ts";

const METHOD_BY_CLASS: Record<FindingClass, string> = {
  defect: "verification_passed",
  probe_demand: "probe_demand_answered",
};

function extractCheckCommands(flags: Flags): string[] {
  const raw = [...(listFlag(flags, "checks") ?? []), ...(listFlag(flags, "evidence") ?? [])];
  const commandIds: string[] = [];
  for (const item of raw) {
    for (const part of item.split(",")) {
      const trimmed = part.trim();
      if (trimmed) commandIds.push(trimmed);
    }
  }
  return [...new Set(commandIds)];
}

function splitPair(entry: string, flag: string): [string, string] {
  const index = entry.indexOf("=");
  if (index <= 0 || index === entry.length - 1) {
    throw new HarnessError("INVALID_ARGUMENT", `--${flag} must be given as <finding-id>=<value>`);
  }
  return [entry.slice(0, index), entry.slice(index + 1)];
}

function methodFor(
  finding: Finding,
  explicit: string | undefined,
  globalMethod: string | undefined,
): string {
  if (explicit !== undefined && explicit !== "") return explicit;
  if (globalMethod !== undefined && globalMethod !== "") return globalMethod;
  const declared = findingClassOf(finding);
  if (declared === null) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `finding ${finding.id} declares no class; pass --resolution-method ${finding.id}=<how it was answered>`,
    );
  }
  return METHOD_BY_CLASS[declared];
}

export function resolutionProofs(
  flags: Flags,
  taskId: string,
  openFindings: readonly Finding[],
): RevalidationProof[] {
  const methods = new Map<string, string>();
  let globalMethod: string | undefined;

  for (const entry of listFlag(flags, "resolution-method") ?? []) {
    if (!entry.includes("=")) {
      globalMethod = entry.trim();
    } else {
      const [findingId, method] = splitPair(entry, "resolution-method");
      if (methods.has(findingId)) {
        throw new HarnessError(
          "INVALID_ARGUMENT",
          `finding ${findingId} has two --resolution-method`,
        );
      }
      methods.set(findingId, method);
    }
  }

  const defaultCommands = extractCheckCommands(flags);
  const evidence = new Map<string, string[]>();
  let resolveAll = Boolean(flags["resolve-all"]);

  for (const entry of listFlag(flags, "resolve") ?? []) {
    if (!entry.includes("=")) {
      const findingId = entry.trim();
      if (findingId === "all") {
        resolveAll = true;
      } else {
        if (defaultCommands.length === 0) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `--resolve ${findingId} cites no command id; pass <finding-id>=<command-id> or specify --checks/--evidence`,
          );
        }
        evidence.set(findingId, [...(evidence.get(findingId) ?? []), ...defaultCommands]);
      }
    } else {
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
  }

  if (resolveAll) {
    if (openFindings.length > 0 && defaultCommands.length === 0) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "--resolve all requires command ids from --checks or --evidence",
      );
    }
    for (const finding of openFindings) {
      if (!evidence.has(finding.id)) {
        evidence.set(finding.id, [...defaultCommands]);
      }
    }
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
      method: methodFor(finding, methods.get(findingId), globalMethod),
      evidence: commandIds.map((commandId) => ({ command_id: commandId })),
    };
  });
}

export function assertNoResolutions(flags: Flags): void {
  const given = [
    ...(listFlag(flags, "resolve") ?? []),
    ...(listFlag(flags, "resolution-method") ?? []),
  ];
  if (given.length > 0 || Boolean(flags["resolve-all"])) {
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
