import { createHash } from "node:crypto";
import { HarnessError } from "../core/errors/harness-error.ts";
import { promptLines } from "./prompt-lines.ts";
import { validateRequirements } from "./validate-requirements.ts";

export interface TaskDeclaration {
  id: string;
  label: string;
  writeScope: readonly string[];
  gate: string | readonly string[];
  deps?: readonly string[] | undefined;
  depReasons?: Readonly<Record<string, string>> | undefined;
  goal?: string | undefined;
  criteria?: readonly string[] | undefined;
  priority?: number | undefined;
  effort?: number | undefined;
  requirementLines?: readonly number[] | undefined;
}

export interface CompiledRequirementsResult {
  requirementsDocument: Record<string, unknown>;
  atomicRequirements: Record<string, unknown>[];
  requirementIdsByTask: Map<string, string[]>;
  warnings: string[];
}

function gateArgvOf(task: TaskDeclaration): string[] {
  return typeof task.gate === "string" ? task.gate.split(" ") : [...task.gate];
}

function gateText(task: TaskDeclaration): string {
  return typeof task.gate === "string" ? task.gate : task.gate.join(" ");
}

function hasAcceptanceCriteria(
  task: TaskDeclaration,
): task is TaskDeclaration & { criteria: readonly string[] } {
  return Array.isArray(task.criteria) && task.criteria.length > 0;
}

function unboundTasksRefusal(taskIds: readonly string[]): HarnessError {
  const message =
    taskIds.length === 1
      ? `task ${taskIds[0]} has no prompt line to bind to and cannot be folded into another requirement; pass --requirement-lines to bind it to the lines it actually implements`
      : `tasks ${taskIds.join(", ")} have no prompt line to bind to and cannot be folded into another requirement; pass --requirement-lines to bind each one to the lines it actually implements`;
  return new HarnessError("INTEGRITY", message);
}

export function compileRequirementsFromPrompt(
  prompt: string,
  tasks: readonly TaskDeclaration[],
): CompiledRequirementsResult {
  const promptSha256 = createHash("sha256").update(prompt, "utf8").digest("hex");
  const lines = promptLines(prompt);

  const nonBlankLineIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim().length > 0) {
      nonBlankLineIndices.push(i + 1);
    }
  }

  if (nonBlankLineIndices.length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "prompt must contain at least one non-blank line");
  }

  const atomicRequirements: Record<string, unknown>[] = [];
  const requirementIdsByTask = new Map<string, string[]>();
  const warnings: string[] = [];
  const claims = new Map<number, string[]>();
  const unboundTaskIds: string[] = [];

  const declared = new Set<number>();
  for (const task of tasks) for (const line of task.requirementLines ?? []) declared.add(line);

  const nextPositionalLine = (): number | undefined =>
    nonBlankLineIndices.find((line) => !declared.has(line) && !claims.has(line));

  tasks.forEach((task) => {
    const explicit = task.requirementLines ?? [];
    const assignedLines = explicit.length > 0 ? [...explicit] : [];
    if (assignedLines.length === 0) {
      const positional = nextPositionalLine();
      if (positional !== undefined) {
        assignedLines.push(positional);
        warnings.push(
          `task ${task.id} was glued to prompt line ${positional} by position, not by declaration; pass --requirement-lines to bind it to the lines it actually implements`,
        );
      }
    }

    if (assignedLines.length === 0) {
      unboundTaskIds.push(task.id);
      return;
    }

    const reqId = `req-${task.id.replace(/^task-?/, "")}`;
    for (const line of assignedLines) {
      claims.set(line, [...(claims.get(line) ?? []), reqId]);
    }

    const excerpt = assignedLines.map((line) => lines[line - 1]!).join("\n");

    if (!hasAcceptanceCriteria(task)) {
      warnings.push(
        `task ${task.id}'s requirement ${reqId} has no declared acceptance criteria; its own gate passing is the only proof of done, which is unfalsifiable — pass --criteria to give it real acceptance criteria`,
      );
    }
    const criteriaList = hasAcceptanceCriteria(task)
      ? task.criteria
      : [`Task gate \`${gateText(task)}\` passes with exit code 0`];

    const acceptance = criteriaList.map((crit, critIdx) => ({
      id: `crit-${reqId}-${critIdx + 1}`,
      criterion: crit,
      evidence: [`Gate execution output for \`${task.id}\``],
    }));

    const reqObj: Record<string, unknown> = {
      id: reqId,
      source_lines: assignedLines,
      source_excerpt: excerpt,
      instruction: task.goal ?? task.label,
      implementation: `Implement requirements for ${task.label} within scope ${task.writeScope.join(", ")}`,
      subsystem: "runtime/planning",
      acceptance,
      candidate_gates: [{ argv: gateArgvOf(task), cwd: "." }],
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

  if (unboundTaskIds.length > 0) {
    throw unboundTasksRefusal(unboundTaskIds);
  }

  const dispositions: Record<string, unknown>[] = [];
  for (const lineNum of nonBlankLineIndices) {
    const linked = claims.get(lineNum);
    if (linked === undefined) {
      dispositions.push({
        line: lineNum,
        kind: "context",
        rationale: "Contextual background, architectural guidance, or specification constraints",
      });
    } else if (linked.length === 1) {
      dispositions.push({ line: lineNum, kind: "requirement", requirement_id: linked[0] });
    } else {
      dispositions.push({ line: lineNum, kind: "requirement", requirement_ids: [...linked] });
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

  return { requirementsDocument: document, atomicRequirements, requirementIdsByTask, warnings };
}
