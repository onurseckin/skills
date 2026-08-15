import { createHash } from "node:crypto";
import { HarnessError } from "../errors/harness-error.ts";
import { validateRequirements } from "./validate-requirements.ts";

export interface TaskDeclaration {
  id: string;
  label: string;
  writeScope: readonly string[];
  gate: string | readonly string[];
  deps?: readonly string[] | undefined;
  goal?: string | undefined;
  criteria?: readonly string[] | undefined;
  priority?: number | undefined;
  effort?: number | undefined;
}

export interface CompiledRequirementsResult {
  requirementsDocument: Record<string, unknown>;
  atomicRequirements: Record<string, unknown>[];
  requirementIdsByTask: Map<string, string[]>;
}

export function compileRequirementsFromPrompt(
  prompt: string,
  tasks: readonly TaskDeclaration[],
): CompiledRequirementsResult {
  const promptSha256 = createHash("sha256").update(prompt, "utf8").digest("hex");
  const promptLines = prompt.split(/\r?\n/);

  const nonBlankLineIndices: number[] = [];
  for (let i = 0; i < promptLines.length; i++) {
    if (promptLines[i]!.trim().length > 0) {
      nonBlankLineIndices.push(i + 1);
    }
  }

  if (nonBlankLineIndices.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "prompt must contain at least one non-blank line");
  }

  const atomicRequirements: Record<string, unknown>[] = [];
  const requirementIdsByTask = new Map<string, string[]>();
  const assignedLines = new Map<number, string>();

  tasks.forEach((task, taskIdx) => {
    let assignedLine: number | undefined;
    for (const lineNum of nonBlankLineIndices) {
      if (!assignedLines.has(lineNum)) {
        assignedLine = lineNum;
        break;
      }
    }

    if (assignedLine === undefined) {
      const fallbackLine = nonBlankLineIndices[taskIdx % nonBlankLineIndices.length]!;
      const existingReqId = assignedLines.get(fallbackLine)!;
      const existingReq = atomicRequirements.find((r) => r.id === existingReqId);
      if (existingReq && Array.isArray(existingReq.acceptance)) {
        const critIdx = existingReq.acceptance.length + 1;
        const gateArgv = typeof task.gate === "string" ? task.gate.split(" ") : [...task.gate];
        (existingReq.acceptance as Record<string, unknown>[]).push({
          id: `crit-${existingReqId}-${critIdx}`,
          criterion:
            task.criteria?.[0] ??
            `Task gate \`${typeof task.gate === "string" ? task.gate : task.gate.join(" ")}\` passes with exit code 0`,
          evidence: [`Gate execution output for \`${task.id}\``],
        });
        if (Array.isArray(existingReq.candidate_gates)) {
          (existingReq.candidate_gates as Record<string, unknown>[]).push({
            argv: gateArgv,
            cwd: ".",
          });
        }
      }
      requirementIdsByTask.set(task.id, [existingReqId]);
      return;
    }

    const reqId = `req-${task.id.replace(/^task-?/, "")}`;
    assignedLines.set(assignedLine, reqId);

    const excerpt = promptLines[assignedLine - 1]!;
    const gateArgv = typeof task.gate === "string" ? task.gate.split(" ") : [...task.gate];

    const criteriaList =
      task.criteria && task.criteria.length > 0
        ? task.criteria
        : [
            `Task gate \`${typeof task.gate === "string" ? task.gate : task.gate.join(" ")}\` passes with exit code 0`,
          ];

    const acceptance = criteriaList.map((crit, critIdx) => ({
      id: `crit-${reqId}-${critIdx + 1}`,
      criterion: crit,
      evidence: [`Gate execution output for \`${task.id}\``],
    }));

    const reqObj: Record<string, unknown> = {
      id: reqId,
      source_lines: [assignedLine],
      source_excerpt: excerpt,
      instruction: task.goal ?? task.label,
      implementation: `Implement requirements for ${task.label} within scope ${task.writeScope.join(", ")}`,
      subsystem: "runtime/planning",
      acceptance,
      candidate_gates: [{ argv: gateArgv, cwd: "." }],
      priority: task.priority ?? 50,
      risk: "medium",
      ambiguity: [],
      dependencies: (task.deps ?? []).map((d) => `req-${d.replace(/^task-?/, "")}`),
      disposition: "actionable",
      status: "planned",
    };

    atomicRequirements.push(reqObj);
    requirementIdsByTask.set(task.id, [reqId]);
  });

  const dispositions: Record<string, unknown>[] = [];
  for (const lineNum of nonBlankLineIndices) {
    const linkedReqId = assignedLines.get(lineNum);
    if (linkedReqId) {
      dispositions.push({
        line: lineNum,
        kind: "requirement",
        requirement_id: linkedReqId,
      });
    } else {
      dispositions.push({
        line: lineNum,
        kind: "context",
        rationale: "Contextual background, architectural guidance, or specification constraints",
      });
    }
  }

  const document: Record<string, unknown> = {
    schema: "harness.requirements",
    version: 1,
    prompt_sha256: promptSha256,
    requirements: atomicRequirements,
    dispositions,
  };

  const issues = validateRequirements(prompt, document);
  if (issues.length > 0) {
    throw new HarnessError(
      "INTEGRITY",
      `compiled requirements failed validation: ${issues.join("; ")}`,
    );
  }

  return { requirementsDocument: document, atomicRequirements, requirementIdsByTask };
}
