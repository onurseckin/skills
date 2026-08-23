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
import { pruneNonUiPayload } from "../workflow/review/role-evidence.ts";
import { uiDomainApplies } from "../contracts/workflow.ts";

import type { AgentRole } from "../contracts/packets.ts";

function isUiTaskPacket(input: PacketInput): boolean {
  if (input.task) {
    const texts: string[] = [];
    if (typeof input.task.label === "string" && input.task.label.length > 0) {
      texts.push(input.task.label);
    }
    if (Array.isArray(input.task.requirement_ids)) {
      texts.push(...input.task.requirement_ids);
    }
    return uiDomainApplies(input.task.write_scope ?? [], texts);
  }
  if (input.subTask) {
    return uiDomainApplies(input.subTask.write_scope ?? []);
  }
  return false;
}

function section(title: string, content: string): string {
  return `## ${title}\n\n${content.trim()}\n`;
}

function jsonSection(title: string, value: unknown): string {
  return section(title, `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``);
}

const READ_ONLY_BRANCH_ROLES: ReadonlySet<string> = new Set(["sub-investigator", "sub-validator"]);
const VALIDATION_ROLES: ReadonlySet<string> = new Set([
  "sub-validator",
  "validator",
  "mechanic-validator",
]);

function responsibilityChecklist(role: AgentRole): string {
  if (role === "validator" || role === "sub-validator") {
    return [
      "- [ ] 1. Pre-flight verification & independence: Execute `whoami` and `doctor` to verify harness health; confirm independence from task author.",
      "- [ ] 2. Anti-rubber-stamping & direct validation: Devote 100% bandwidth to cognitive analysis, code reading, and architectural contract enforcement; strictly prohibited from executing bash/shell commands or running test suites (`run:exec`); forbid superficial sign-offs or mock rubber-stamping.",
      "- [ ] 3. Adversarial Gate Proofs (AGP) & falsifiability: Verify gate counterfactual falsifiability (`gate:prove` / manual negative checks) proving the gate fails on broken logic.",
      "- [ ] 4. Direct end-to-end command verification: Inspect deterministic test receipts, command outputs, and gate results produced by mechanic validators alongside direct source inspections; validate actual runtime command behavior, not isolated mocks or superficial unit tests.",
      "- [ ] 5. Strict quantitative metric floors: Enforce 0 TypeScript `any` types, 0 compiler/linter suppressions, 100% test pass rate in mechanic receipts, and exact execution timings.",
      "- [ ] 6. Anti-boundary-leak rule: Never edit repository files directly to fix defects; record structured findings via `task:reject` and delegate repair to an assigned repairer.",
      "- [ ] 7. Disk-backed evidence submission: Save all proof artifacts and screenshots strictly under `.capsules/<run>/evidence/` and record structured review verdict.",
    ].join("\n");
  }
  if (role === "mechanic-validator") {
    return [
      "- [ ] 1. Pre-flight verification & independence: Execute `whoami` and `doctor` to verify harness health; confirm independence from task author.",
      "- [ ] 2. 100% Mechanical Execution Ownership: Execute task-specific unit tests, compilation checks, and gate commands via `run:exec`.",
      "- [ ] 3. Adversarial Gate Proofs (AGP) & Falsifiability: Prove gate commands are discriminative by verifying that defective logic or reverted write scope produces non-zero exit codes.",
      "- [ ] 4. Structured Test Receipts & Evidence Generation: Produce structured execution receipts, exit codes, and timing logs under `.capsules/<run>/evidence/`.",
      "- [ ] 5. Static Invariant & Metric Enforcement: Mechanically verify 0 TypeScript `any` types, 0 compiler/linter suppressions, and 100% gate pass rate.",
      "- [ ] 6. Anti-boundary-leak rule: Never edit repository files directly; record structured findings via `task:reject` and delegate repair to an assigned repairer.",
      "- [ ] 7. Disk-backed test receipt submission: Store all command logs and test receipts under `.capsules/<run>/evidence/` and report execution results.",
    ].join("\n");
  }
  if (role === "completeness-critic") {
    return [
      "- [ ] 1. Pre-flight snapshot & prompt verification: Verify readiness digest and immutable original prompt against whole repository state.",
      "- [ ] 2. Whole-run AGP & gate discrimination: Verify run-level gates discriminate counterfactually between working and defective states.",
      "- [ ] 3. Comprehensive requirement proof: Provide direct, critic-executed command proof for every requirement; unproven requirements block completion.",
      "- [ ] 4. End-to-end integration & anti-fragmentation: Verify cohesive user-facing interfaces with zero fragmented options, disconnected flags, or half-baked stubs.",
      "- [ ] 5. Strict repository invariants: Enforce 0 TypeScript `any` types, 0 suppressions, and 100% gate pass rate across the whole codebase.",
      "- [ ] 6. Sealed commit history: Verify clean, coherent commit history proportionate to work without WIP commits.",
      "- [ ] 7. Disk-backed completion verdict: Record approval or structured rejection findings strictly under `.capsules/<run>/evidence/`.",
    ].join("\n");
  }
  if (role === "implementer" || role === "repairer" || role === "sub-implementer") {
    return [
      "- [ ] 1. Pre-flight verification: Execute `whoami` and `doctor` to verify harness health and active run lease.",
      "- [ ] 2. Exclusive write scope: Verify and respect assigned write scope lease; never edit or stage files outside assigned paths.",
      "- [ ] 3. Direct end-to-end implementation & tests: Write focused, high-quality code and tests; avoid superficial unit tests and mock-only shortcuts.",
      "- [ ] 4. Strict static invariants: Enforce zero TypeScript untyped references (0 `any`) and zero compiler/linter suppressions.",
      "- [ ] 5. Mandatory test gate execution: Execute focused test gates and capture complete quantitative proof (100% pass, exit code 0).",
      "- [ ] 6. Ultra-lean context & on-demand inspection: Query heavy capsule metadata on disk on demand via CLI (`report:task`, `stream:events`, `explain`) rather than expecting large context dumps.",
      "- [ ] 7. Structured evidence submission: Submit structured results with valid lease token via harness CLI and report back to Coordinator.",
    ].join("\n");
  }
  return [
    "- [ ] 1. Pre-flight checks: Execute `whoami` and `doctor` to verify harness health and run state.",
    "- [ ] 2. Task claim & lease verification: Verify exclusive lease and assigned scope before acting.",
    "- [ ] 3. Fresh verified proofs: Never assume prior completions or historical success; produce fresh counterfactual falsifiability proofs and concrete evidence.",
    "- [ ] 4. Ultra-lean context & on-demand inspection: Query heavy capsule metadata on disk on demand via CLI (`report:task`, `stream:events`, `explain`) rather than expecting large context dumps.",
    "- [ ] 5. Strict static invariants: Enforce zero TypeScript untyped references and zero compiler/linter suppressions.",
    "- [ ] 6. Mandatory gate execution: Execute required gates and capture complete quantitative proof.",
    "- [ ] 7. Structured evidence submission: Submit structured results with valid credentials via harness CLI and report back to parent.",
  ].join("\n");
}

function capsuleMemoryGuidance(runId: string, taskId: string | null): string {
  const taskFlag = taskId ? ` --task ${taskId}` : "";
  return [
    "Heavy metadata, full event streams, dependency graphs, historical logs, and error dumps are decoupled into structured Capsule Memory on disk (`.capsules/`).",
    "Query detailed runtime information on demand using the following Harness CLI commands:",
    `- Inspect task status & review history: \`bun harness.ts report:task --run .capsules/${runId}${taskFlag}\``,
    `- Stream event timeline: \`bun harness.ts stream:events --run .capsules/${runId}\``,
    `- Inspect DAG topology & waves: \`bun harness.ts dag:view --run .capsules/${runId}\``,
    `- Verify gate falsifiability (AGP): \`bun harness.ts gate:prove --run .capsules/${runId}${taskFlag}\``,
    `- Query errors & remedies: \`bun harness.ts explain <ERROR_CODE>\``,
    `- Check run health & diagnostics: \`bun harness.ts doctor --run .capsules/${runId}\``,
    `- Retrieve recorded evidence artifacts: \`bun harness.ts evidence:get --run .capsules/${runId} --evidence <ID>\``,
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
  const raw = VALIDATION_ROLES.has(input.role)
    ? validatorTaskContract(excludeValidatorContamination(contract), input.task)
    : (sanitizeLeanContext(contract) as JsonObject);
  return isUiTaskPacket(input) ? raw : pruneNonUiPayload(raw, false);
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
  const { [VALIDATION_ROUND_KEY]: validationRound, ...rawRemainingContext } = context;
  const remainingContext = isUiTaskPacket(input)
    ? rawRemainingContext
    : pruneNonUiPayload(rawRemainingContext, false);
  const sections = [
    `# ${input.role} packet`,
    section(
      "Identity",
      `Run: ${input.runId}\nTask: ${taskId ?? "none - run-level packet"}\nAttempt: ${input.attempt}`,
    ),
    section("Responsibility checklist", responsibilityChecklist(input.role)),
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
