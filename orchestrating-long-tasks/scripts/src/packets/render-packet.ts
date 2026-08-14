import { createHash } from "node:crypto";
import type { JsonObject } from "../contracts/json.ts";
import { canonicalJsonBytes } from "../core/json.ts";
import { loadCommonInstructions, verifyCommonInstructions } from "./common-instructions.ts";
import {
  isolateValidatorContext,
  excludeValidatorContamination,
  VALIDATOR_EXCLUSIONS,
} from "./validator-context.ts";
import type { BuiltPacket, PacketInput } from "./types.ts";
import { authenticatePacket } from "./authenticate-packet.ts";
import { criticContext } from "./critic-context.ts";
import { validateRepositoryInspectionPair } from "./repository-inspection.ts";

function section(title: string, content: string): string {
  return `## ${title}\n\n${content.trim()}\n`;
}

function jsonSection(title: string, value: unknown): string {
  return section(title, `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``);
}

function roleContext(input: PacketInput): JsonObject {
  if (input.role === "validator") return isolateValidatorContext(input.authoritativeContext);
  if (input.role === "completeness-critic") return criticContext(input);
  return structuredClone(input.authoritativeContext);
}

function taskContract(input: PacketInput): JsonObject | null {
  if (!input.task) return null;
  const contract = structuredClone(input.task);
  return input.role === "validator" ? excludeValidatorContamination(contract) : contract;
}

export function buildPacket(input: PacketInput): BuiltPacket {
  const task = authenticatePacket(input);
  input = task ? { ...input, task } : input;
  if (input.role !== "planner") validateRepositoryInspectionPair(input.authoritativeContext);
  const context = roleContext(input);
  const common = verifyCommonInstructions(input.commonInstructions);
  const taskId = input.task?.id ?? null;
  const taskRole = input.role === "implementer" || input.role === "repairer";
  const requirementIds = input.task?.requirement_ids ?? [];
  const mappedRequirements = input.state.requirements.filter((requirement) =>
    requirementIds.includes(requirement.id),
  );
  const mapped =
    input.role === "validator"
      ? mappedRequirements.map((requirement) => excludeValidatorContamination(requirement))
      : mappedRequirements;
  const allowedScope =
    input.role === "planner"
      ? { write_scope: input.planningWriteScope ?? [], resource_scope: [] }
      : taskRole
        ? {
            write_scope: input.task?.write_scope ?? [],
            resource_scope: input.task?.resource_scope ?? [],
          }
        : { write_scope: [], resource_scope: [] };
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
    excluded_fields: input.role === "validator" ? VALIDATOR_EXCLUSIONS : [],
    common_instructions_sha256: common.canonical.sha256,
    packet_sha256: "",
    ...(input.role === "completeness-critic"
      ? {
          repository_command_ids: (context.repository_evidence as JsonObject)
            .command_ids as string[],
          integrity_evidence_sha256: createHash("sha256")
            .update(canonicalJsonBytes(context.integrity_evidence!))
            .digest("hex"),
          readiness_sha256: (context.completion_readiness as JsonObject).sha256 as string,
          repository_binding: (context.completion_readiness as JsonObject).repository_binding,
        }
      : {}),
  };
  const sections = [
    `# ${input.role} packet`,
    section(
      "Identity",
      `Run: ${input.runId}\nTask: ${taskId ?? "run-level"}\nAttempt: ${input.attempt}`,
    ),
    section("Role instructions", input.roleInstructions),
    jsonSection("Task contract", taskContract(input)),
    jsonSection("Mapped requirements", mapped),
    jsonSection("Allowed scope", allowedScope),
    jsonSection("Expected evidence schema", input.evidenceSchema),
    jsonSection("Targeted commands", input.targetedCommands),
    jsonSection("Authoritative context", context),
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
