import {
  expandExternalPromptToPlan,
  synthesizeAutonomousTasks,
  type SmartTaskPlan,
  type SmartTaskSynthesisResult,
} from "../../mind/smart-task-manager.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export interface SmartTaskSynthesizeResult {
  readonly markdown: string;
  readonly mode: "feedback_intake" | "self_evolution";
  readonly tasksCount: number;
  readonly tasks: readonly SmartTaskPlan[];
  readonly [key: string]: unknown;
}

export interface SmartTaskIngestResult {
  readonly markdown: string;
  readonly task: SmartTaskPlan;
  readonly [key: string]: unknown;
}

export function smartTaskSynthesizeCommand(flags: Flags, _context?: CommandContext): SmartTaskSynthesizeResult {
  const capsulesDir = textFlag(flags, "capsules-dir", false);
  const maxTasks = integerFlag(flags, "max-tasks", { minimum: 1 }) ?? 5;
  const goal = textFlag(flags, "goal", false);
  const charterGoals = goal ? [goal.trim()] : undefined;

  const result: SmartTaskSynthesisResult = synthesizeAutonomousTasks({
    ...(capsulesDir ? { capsulesDir } : {}),
    maxTasks,
    ...(charterGoals ? { charterGoals } : {}),
  });

  const lines: string[] = [
    `### Smart Task Autonomous Synthesizer [${result.mode.toUpperCase()}]`,
    `- **Summary**: ${result.summary}`,
    `- **Source Items Evaluated**: ${result.source_items_count}`,
    `- **Generated Tasks**: ${result.tasks.length}`,
  ];

  if (result.tasks.length > 0) {
    lines.push("");
    lines.push("| Task ID | Label | Write Scope | Gate |");
    lines.push("| :--- | :--- | :--- | :--- |");
    for (const t of result.tasks) {
      const scopeSummary = t.write_scope.join(", ");
      lines.push(`| \`${t.id}\` | ${t.label} | \`${scopeSummary.length > 40 ? scopeSummary.slice(0, 37) + "..." : scopeSummary}\` | \`${t.gate}\` |`);
    }
  }

  const markdown = enforceLineLimit(lines.join("\n"), 30);

  return {
    markdown,
    mode: result.mode,
    tasksCount: result.tasks.length,
    tasks: result.tasks,
  };
}

export function smartTaskIngestCommand(flags: Flags, _context?: CommandContext): SmartTaskIngestResult {
  const prompt = textFlag(flags, "prompt", true)!;
  const id = textFlag(flags, "id", false);
  const goal = textFlag(flags, "goal", false);

  const plan = expandExternalPromptToPlan(prompt, {
    ...(id ? { baseId: id.trim() } : {}),
    ...(goal ? { charterGoals: [goal.trim()] } : {}),
  });

  const lines: string[] = [
    `### External Prompt Ingested & Plan Enhanced`,
    `- **Task ID**: \`${plan.id}\``,
    `- **Label**: ${plan.label}`,
    `- **Write Scope**: \`${plan.write_scope.join(", ")}\``,
    `- **Gate**: \`${plan.gate}\``,
    `- **Rationale**: ${plan.rationale}`,
  ];

  const markdown = enforceLineLimit(lines.join("\n"), 25);

  return {
    markdown,
    task: plan,
  };
}
