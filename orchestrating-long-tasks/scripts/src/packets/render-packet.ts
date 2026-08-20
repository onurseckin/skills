import { createHash } from "node:crypto";
import { HarnessError } from "../errors/harness-error.ts";
import { isJsonObject, type JsonObject } from "../contracts/json.ts";
import { loadCommonInstructions, verifyCommonInstructions } from "./common-instructions.ts";
import {
  isolateValidatorContext,
  excludeValidatorContamination,
  VALIDATOR_EXCLUSIONS,
} from "./validator-context.ts";
import type { BuiltPacket, PacketInput } from "./types.ts";
import { authenticatePacket } from "./authenticate-packet.ts";
import { criticIntegrityDigest } from "./critic-integrity-digest.ts";
import { loadRoleContract } from "./role-contract.ts";
import { criticContext } from "./critic-context.ts";
import { validateRepositoryInspectionPair } from "./repository-inspection.ts";
import { CONCLUSION_EXCLUSIONS, validatorTaskContract } from "./prior-round-demands.ts";
import { renderValidationRound } from "./render-validation-round.ts";
import { VALIDATION_ROUND_KEY } from "./validation-round.ts";

function section(title: string, content: string): string {
  return `## ${title}\n\n${content.trim()}\n`;
}

function jsonSection(title: string, value: unknown): string {
  return section(title, `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``);
}

/**
 * A read-only branch role's contract forbids touching repository files, so its sub-task paths are
 * handed over as the resources it is scoped to rather than as a write scope the contract denies in
 * the very same packet.
 */
const READ_ONLY_BRANCH_ROLES: ReadonlySet<string> = new Set(["sub-investigator", "sub-validator"]);
const VALIDATION_ROLES: ReadonlySet<string> = new Set(["sub-validator", "validator"]);

function roleContext(input: PacketInput): JsonObject {
  // A sub-validator inherits the validator's isolation: it is dispatched to verify, so implementer
  // narrative would contaminate its findings exactly as it would the parent's.
  if (VALIDATION_ROLES.has(input.role)) return isolateValidatorContext(input.authoritativeContext);
  if (input.role === "completeness-critic") return criticContext(input);
  return structuredClone(input.authoritativeContext);
}

function taskContract(input: PacketInput): JsonObject | null {
  const bound = input.task ?? input.subTask;
  if (!bound) return null;
  const contract = structuredClone(bound) as JsonObject;
  // A validator's copy of the contract keeps every fact of the task and none of the last round's
  // conclusions: the findings it recorded arrive as the demands they carry, not as verdicts.
  return VALIDATION_ROLES.has(input.role)
    ? validatorTaskContract(excludeValidatorContamination(contract), input.task)
    : contract;
}

function allowedScope(input: PacketInput): JsonObject {
  if (input.role === "planner")
    return { write_scope: input.planningWriteScope ?? [], resource_scope: [] };
  if (input.subTask) {
    const scope = [...input.subTask.write_scope];
    return READ_ONLY_BRANCH_ROLES.has(input.role)
      ? { write_scope: [], resource_scope: scope }
      : { write_scope: scope, resource_scope: [] };
  }
  if (input.role === "implementer" || input.role === "repairer")
    return {
      write_scope: input.task?.write_scope ?? [],
      resource_scope: input.task?.resource_scope ?? [],
    };
  return { write_scope: [], resource_scope: [] };
}

export function buildPacket(input: PacketInput): BuiltPacket {
  const roleContract = input.roleContract ?? loadRoleContract(input.role);
  if (roleContract.role !== input.role)
    throw new HarnessError("INTEGRITY", "packet role contract does not match the packet role");
  const task = authenticatePacket(input);
  input = task ? { ...input, task } : input;
  if (input.role !== "planner") validateRepositoryInspectionPair(input.authoritativeContext);
  const context = roleContext(input);
  const common = verifyCommonInstructions(input.commonInstructions);
  const taskId = input.task?.id ?? input.subTask?.id ?? null;
  const requirementIds = input.task?.requirement_ids ?? [];
  const mappedRequirements = input.state.requirements.filter((requirement) =>
    requirementIds.includes(requirement.id),
  );
  const mapped = VALIDATION_ROLES.has(input.role)
    ? mappedRequirements.map((requirement) => excludeValidatorContamination(requirement))
    : mappedRequirements;
  const metadata: JsonObject = {
    schema: "harness.packet",
    version: 1,
    run_id: input.runId,
    graph_revision: input.graphRevision,
    role: input.role,
    agent_id: input.agentId,
    task_id: taskId,
    attempt: input.attempt,
    requirement_ids: requirementIds,
    // What the packet withheld, named: the prose exclusions and the conclusion-bearing fields a
    // validation role never receives.
    excluded_fields: VALIDATION_ROLES.has(input.role)
      ? [...new Set([...VALIDATOR_EXCLUSIONS, ...CONCLUSION_EXCLUSIONS])].sort()
      : [],
    common_instructions_sha256: common.canonical.sha256,
    role_contract_sha256: roleContract.sha256,
    packet_sha256: "",
    ...(input.role === "completeness-critic"
      ? {
          repository_command_ids: (context.repository_evidence as JsonObject)
            .command_ids as string[],
          integrity_evidence_sha256: criticIntegrityDigest(
            context.integrity_evidence as JsonObject[],
          ),
          readiness_sha256: (context.completion_readiness as JsonObject).sha256 as string,
          repository_binding: (context.completion_readiness as JsonObject).repository_binding,
        }
      : {}),
  };
  // The round-N record is lifted out of the context so it is rendered as demands and measurements
  // rather than dumped as a JSON blob a reader would scan as one more set of prior conclusions.
  const { [VALIDATION_ROUND_KEY]: validationRound, ...remainingContext } = context;
  const sections = [
    `# ${input.role} packet`,
    section(
      "Identity",
      `Run: ${input.runId}\nTask: ${taskId ?? "run-level"}\nAttempt: ${input.attempt}`,
    ),
    section("Role contract", roleContract.text),
    jsonSection("Task contract", taskContract(input)),
    jsonSection("Mapped requirements", mapped),
    jsonSection("Allowed scope", allowedScope(input)),
    jsonSection("Expected evidence schema", input.evidenceSchema),
    jsonSection("Targeted commands", input.targetedCommands),
    jsonSection("Authoritative context", remainingContext),
    ...(isJsonObject(validationRound) ? [renderValidationRound(validationRound)] : []),
  ].join("\n");
  const markdown = `${sections}\n## Common instructions\n\n${common.text}`;
  metadata.packet_sha256 = createHash("sha256").update(markdown).digest("hex");
  return { markdown, metadata };
}

export async function buildPacketFromPinnedRuntime(
  runRoot: string,
  input: Omit<PacketInput, "commonInstructions">,
): Promise<BuiltPacket> {
  const commonInstructions = await loadCommonInstructions(runRoot);
  return buildPacket({ ...input, commonInstructions });
}
