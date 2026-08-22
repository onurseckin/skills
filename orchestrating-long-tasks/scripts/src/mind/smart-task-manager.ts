import { HarnessError } from "../errors/harness-error.ts";
import { readFeedbackQueue, type FeedbackItem } from "./feedback-queue.ts";
import { auditBlunderLog } from "./blunders.ts";

export interface SmartTaskPlan {
  readonly id: string;
  readonly label: string;
  readonly write_scope: readonly string[];
  readonly gate: string;
  readonly charter_goals: readonly string[];
  readonly dependencies: readonly string[];
  readonly source_type: "feedback_intake" | "self_evolution" | "blunder_remediation" | "direct_prompt";
  readonly rationale: string;
}

export interface SmartTaskSynthesisResult {
  readonly mode: "feedback_intake" | "self_evolution";
  readonly tasks: readonly SmartTaskPlan[];
  readonly summary: string;
  readonly source_items_count: number;
}

export function synthesizeAutonomousTasks(options: {
  readonly capsulesDir?: string;
  readonly charterGoals?: readonly string[];
  readonly maxTasks?: number;
} = {}): SmartTaskSynthesisResult {
  const maxTasks = options.maxTasks ?? 5;
  const feedbackItems = readFeedbackQueue(options.capsulesDir);
  const pendingFeedback = feedbackItems.filter((f) => f.status === "PENDING");

  // Mode 1: If pending user feedbacks exist, prioritize and expand them
  if (pendingFeedback.length > 0) {
    const selected = pendingFeedback.slice(0, maxTasks);
    const tasks: SmartTaskPlan[] = selected.map((fb, index) => {
      const scope = deriveWriteScopeForCategory(fb.category, fb.id);
      const gate = deriveGateForCategory(fb.category, scope);
      return {
        id: `task-${index + 1}-${sanitizeSlug(fb.id)}`,
        label: fb.title,
        write_scope: scope,
        gate,
        charter_goals: options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G1"],
        dependencies: [],
        source_type: "feedback_intake",
        rationale: `Ingested from feedback queue [${fb.priority}]: ${fb.content.slice(0, 150)}`,
      };
    });

    return {
      mode: "feedback_intake",
      tasks,
      summary: `Synthesized ${tasks.length} task(s) from pending user feedback queue.`,
      source_items_count: pendingFeedback.length,
    };
  }

  // Mode 2: Self-evolution tasks from blunder remediation & architectural audit
  const targetRoots = options.capsulesDir ? [options.capsulesDir] : [".capsules/"];
  const blunderAudit = auditBlunderLog(targetRoots);
  const openBlunders = blunderAudit.blunders.filter((b) => b.status === "open");

  const selfTasks: SmartTaskPlan[] = [];

  if (openBlunders.length > 0) {
    const blunder = openBlunders[0]!;
    selfTasks.push({
      id: "task-1-blunder-remediation",
      label: `Automated Blunder Remediation (${blunder.category})`,
      write_scope: [
        "orchestrating-long-tasks/scripts/src/workflow/",
        "tests/unit/workflow/",
      ],
      gate: "bun test tests/unit && bun run typecheck",
      charter_goals: options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G2"],
      dependencies: [],
      source_type: "blunder_remediation",
      rationale: `Autonomous remediation for open blunder ${blunder.id}: ${blunder.observation}`,
    });
  }

  // Add autonomic continuous optimization task
  selfTasks.push({
    id: `task-${selfTasks.length + 1}-autonomic-optimization`,
    label: "Continuous Architecture & Invariant Hardening",
    write_scope: [
      "orchestrating-long-tasks/scripts/src/mind/",
      "tests/unit/mind/",
    ],
    gate: "bun test tests/unit/mind && bun run typecheck",
    charter_goals: options.charterGoals && options.charterGoals.length > 0 ? [options.charterGoals[0]!] : ["G3"],
    dependencies: [],
    source_type: "self_evolution",
    rationale: "Autonomic self-evolution cycle maintaining 0 any, 0 suppressions, and continuous loop cadence.",
  });

  return {
    mode: "self_evolution",
    tasks: selfTasks.slice(0, maxTasks),
    summary: `Autonomous self-evolution synthesized ${selfTasks.length} task(s) on empty queue.`,
    source_items_count: openBlunders.length,
  };
}

export function expandExternalPromptToPlan(
  prompt: string,
  options: {
    readonly charterGoals?: readonly string[];
    readonly baseId?: string;
  } = {},
): SmartTaskPlan {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new HarnessError("INVALID_ARGUMENT", "Prompt cannot be empty for task expansion");
  }

  const baseId = options.baseId ?? "task-external-intake";
  const goals = options.charterGoals && options.charterGoals.length > 0 ? options.charterGoals : ["G1"];

  return {
    id: baseId,
    label: trimmed.split("\n")[0]!.slice(0, 80),
    write_scope: ["orchestrating-long-tasks/scripts/src/", "tests/unit/"],
    gate: "bun test tests/unit && bun run typecheck",
    charter_goals: goals,
    dependencies: [],
    source_type: "direct_prompt",
    rationale: `Expanded from direct prompt: ${trimmed.slice(0, 120)}`,
  };
}

function deriveWriteScopeForCategory(category: string, id: string): readonly string[] {
  const slug = sanitizeSlug(id);
  switch (category) {
    case "DOCUMENTATION":
      return ["docs/", "orchestrating-long-tasks/docs/"];
    case "AGENT_CONTRACTS":
      return ["orchestrating-long-tasks/agents/", "orchestrating-long-tasks/roles/", "orchestrating-long-tasks/references/"];
    case "CLI_TOOLING":
      return [
        `orchestrating-long-tasks/scripts/src/cli/commands/${slug}.ts`,
        `tests/unit/cli/${slug}.test.ts`,
      ];
    case "WATCHDOG":
      return [
        "orchestrating-long-tasks/scripts/src/authority/watchdog-manager.ts",
        "orchestrating-long-tasks/scripts/src/cli/commands/watchdog-ops.ts",
        "tests/unit/authority/watchdog-manager.test.ts",
      ];
    case "SCALING":
      return [
        "orchestrating-long-tasks/scripts/src/workflow/",
        "orchestrating-long-tasks/roles/",
        "tests/unit/workflow/",
      ];
    case "CORE_ENGINE":
    case "ARCHITECTURE":
    default:
      return [
        `orchestrating-long-tasks/scripts/src/mind/${slug}.ts`,
        `tests/unit/mind/${slug}.test.ts`,
      ];
  }
}

function deriveGateForCategory(_category: string, writeScope: readonly string[]): string {
  const testFile = writeScope.find((s) => s.includes("test.ts") || s.includes("tests/"));
  if (testFile) {
    return `bun test ${testFile} && bun run typecheck`;
  }
  return "bun test tests/unit && bun run typecheck";
}

function sanitizeSlug(val: string): string {
  return val.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
