import { UNKNOWN } from "./markdown-primitives.ts";

export interface AsciiSubTask {
  id: string;
  label: string;
  status: string;
  agentId: string | null;
}

export interface AsciiBranch {
  id: string;
  reason: string;
  status: string;
  subTasks: AsciiSubTask[];
}

export interface AsciiTask {
  id: string;
  label: string | null;
  status: string;
  agentId: string | null;
  dependencies: string[];
  branches: AsciiBranch[];
}

export interface AsciiWave {
  /** `null` when no topology recorded the task; the drawing says so instead of inventing a wave. */
  wave: number | null;
  taskIds: string[];
}

export interface AsciiGraphInput {
  waves: readonly AsciiWave[];
  tasks: readonly AsciiTask[];
}

const BOX_PADDING = 2;

function boxRows(task: AsciiTask): string[] {
  return [
    `${task.id}  ${task.label ?? UNKNOWN}`,
    `status: ${task.status}   agent: ${task.agentId ?? UNKNOWN}`,
    `after: ${task.dependencies.length === 0 ? "(nothing)" : task.dependencies.join(", ")}`,
  ];
}

function drawBox(rows: readonly string[], width: number, indent: string): string[] {
  const border = `${indent}+${"-".repeat(width + BOX_PADDING)}+`;
  return [border, ...rows.map((row) => `${indent}| ${row.padEnd(width, " ")} |`), border];
}

function drawBranches(branches: readonly AsciiBranch[], indent: string): string[] {
  const lines: string[] = [];
  for (const branch of branches) {
    lines.push(`${indent}\\__ branch ${branch.id} [${branch.status}] :: ${branch.reason}`);
    for (const subTask of branch.subTasks) {
      lines.push(
        `${indent}     +-- ${subTask.id} ${subTask.label} [${subTask.status}] by ${subTask.agentId ?? UNKNOWN}`,
      );
    }
  }
  return lines;
}

/**
 * The run's shape as a terminal reader sees it: waves top to bottom, every task of one wave under
 * that wave's header, branch excursions hanging off the task that opened them. Deliberately ASCII
 * and deliberately in the document — a diagram that needs a renderer is not a report.
 */
export function renderTaskGraphAscii(input: AsciiGraphInput): string[] {
  const tasks = new Map(input.tasks.map((task) => [task.id, task]));
  if (input.tasks.length === 0) return ["(no tasks were compiled into this run)"];

  const allRows = input.tasks.flatMap(boxRows);
  const width = Math.max(...allRows.map((row) => row.length));

  const lines: string[] = [];
  const waves = [...input.waves];
  for (const [index, wave] of waves.entries()) {
    const header = wave.wave === null ? "[ WAVE unknown ]" : `[ WAVE ${wave.wave} ]`;
    const parallel = wave.taskIds.length > 1 ? ` ${wave.taskIds.length} tasks in parallel` : "";
    lines.push(`${header}${parallel}`);
    for (const taskId of wave.taskIds) {
      const task = tasks.get(taskId);
      if (task === undefined) {
        lines.push(`  (task ${taskId} is listed in the topology but absent from the run state)`);
        continue;
      }
      lines.push(...drawBox(boxRows(task), width, "  "));
      lines.push(...drawBranches(task.branches, "     "));
    }
    if (index < waves.length - 1) {
      lines.push("        |");
      lines.push("        v");
    }
  }

  const edges = input.tasks.flatMap((task) =>
    task.dependencies.map((dependency) => `  ${dependency} --> ${task.id}`),
  );
  lines.push("");
  lines.push("Dependency edges:");
  lines.push(...(edges.length === 0 ? ["  (none)"] : edges));
  return lines;
}
