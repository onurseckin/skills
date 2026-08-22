import { createHash } from "node:crypto";
import { HarnessError } from "../errors/harness-error.ts";
import { isJsonObject, type JsonObject } from "../contracts/json.ts";
import { loadCommonInstructions, verifyCommonInstructions } from "./common-instructions.ts";
import {
  isolateValidatorContext,
  excludeValidatorContamination,
  sanitizeLeanContext,
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

const READ_ONLY_BRANCH_ROLES: ReadonlySet<string> = new Set(["sub-investigator", "sub-validator"]);
const VALIDATION_ROLES: ReadonlySet<string> = new Set(["sub-validator", "validator"]);

function responsibilityChecklist(): string {
  return [
    "- [ ] 1. Pre-flight checks: Execute `whoami` and `doctor` to verify harness health and run state.",
    "- [ ] 2. Task claim & lease verification: Verify exclusive lease and assigned write scope before making modifications.",
    "- [ ] 3. Fresh verified proofs: Never assume prior completions or historical success; produce fresh counterfactual falsifiability proofs and concrete evidence.",
    "- [ ] 4. Ultra-lean context & on-demand inspection: Query heavy capsule metadata on disk on demand via CLI (`report:task`, `stream:events`, `explain`) rather than expecting large context dumps.",
    "- [ ] 5. Strict static invariants: Enforce zero TypeScript untyped references and zero compiler/linter suppressions.",
    "- [ ] 6. Mandatory test gate execution: Execute focused test gates and capture complete quantitative proof.",
    "- [ ] 7. Structured evidence submission: Submit structured results with valid lease token via harness CLI and report back to Coordinator.",
  ].join("\n");
}

function capsuleMemoryGuidance(runId: string, taskId: string | null): string {
  const taskFlag = taskId ? ` --task ${taskId}` : "";
  return [
    "Heavy metadata, full event streams, dependency graphs, and historical logs are decoupled into structured Capsule Memory on disk (`.capsules/`).",
    "Query detailed runtime information on demand using the following Harness CLI commands:",
    `- Inspect task status & review history: \`bun harness.ts report:task --run .capsules/${runId}${taskFlag}\``,
    `- Stream event timeline: \`bun harness.ts stream:events --run .capsules/${runId}\``,
    `- Inspect DAG topology & waves: \`bun harness.ts dag:view --run .capsules/${runId}\``,
    `- Query errors & remedies: \`bun harness.ts explain <ERROR_CODE>\``,
    `- Check run health & diagnostics: \`bun harness.ts doctor --run .capsules/${runId}\``,
  ].join("\n");
}

function roleContext(input: PacketInput): JsonObject {
  if (VALIDATION_ROLES.has(input.role)) return isolateValidatorContext(input.authoritativeContext);
  if (input.role === "completeness-critic") return criticContext(input);
  return sanitizeLeanContext(input.authoritativeContext);
}

function taskContract(input: PacketInput): JsonObject | null {
  const bound = input.task ?? input.subTask;
  if (!bound) return null;
  const contract = structuredClone(bound) as JsonObject;
  return VALIDATION_ROLES.has(input.role)
    ? validatorTaskContract(excludeValidatorContamination(contract), input.task)
    : (sanitizeLeanContext(contract) as JsonObject);
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
    : mappedRequirements.map((requirement) => sanitizeLeanContext(requirement));
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
  const { [VALIDATION_ROUND_KEY]: validationRound, ...remainingContext } = context;
  const sections = [
    `# ${input.role} packet`,
    section(
      "Identity",
      `Run: ${input.runId}\nTask: ${taskId ?? "none - run-level packet"}\nAttempt: ${input.attempt}`,
    ),
    section("Responsibility checklist", responsibilityChecklist()),
    section("Capsule memory on disk", capsuleMemoryGuidance(input.runId, taskId)),
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
