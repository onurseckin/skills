import { detectScopeOverlap } from "../planner/collisions.ts";
import { enrichTaskPlanWithExactAnchors } from "../planner/anti-batching.ts";
import type { SmartTaskPlan, SmartWavePlanResult } from "../planner/models.ts";
import type { TaskPriority } from "../../queue/index.ts";
import type { FeedbackItem } from "../../../feedback/queue/index.ts";
import { planWaveExecution } from "../planner/waves.ts";
import { HarnessError } from "../../../../core/errors/index.ts";

export function expandExternalPromptToWavePlan(
  prompt: string,
  options: {
    readonly charterGoals?: readonly string[] | undefined;
    readonly baseIdPrefix?: string | undefined;
  } = {},
): SmartWavePlanResult {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new HarnessError("INVALID_ARGUMENT", "Prompt cannot be empty for wave expansion");
  }

  const lines = trimmed
    .split("\n")
    .map((l: string) => l.trim())
    .filter((l: string) => l.length > 0 && !l.startsWith("#"));

  const prefix = typeof options.baseIdPrefix === "string" ? options.baseIdPrefix : "wave-task";
  const goals =
    options.charterGoals && options.charterGoals.length > 0 ? options.charterGoals : ["G1"];

  const tasks: SmartTaskPlan[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const slug = sanitizeSlug(line.slice(0, 25));
    const id = `${prefix}-${i + 1}-${slug}`;
    const scope = [
      `olt/scripts/src/mind/step-${i + 1}.ts`,
      `tests/unit/mind/step-${i + 1}.test.ts`,
    ];
    const gate = `bun test tests/unit/mind/step-${i + 1}.test.ts && bun run typecheck`;
    const dependencies = i > 0 ? [tasks[i - 1]!.id] : [];

    const rawTask: SmartTaskPlan = {
      id,
      label: line.slice(0, 80),
      write_scope: scope,
      gate,
      charter_goals: goals,
      acceptance_criteria: [`Complete wave subtask: ${line}`, `Verify gate: ${gate}`],
      dependencies,
      source_type: "external_intake",
      priority: "HIGH",
      rationale: `Expanded step ${i + 1} from multi-step prompt: ${line}`,
      assigned_tier: "Tier_3_Implementer",
      assigned_implementer: `implementer-wave-step-${i + 1}`,
      assigned_validator: `validator-wave-step-${i + 1}`,
      metadata: {
        assigned_implementer: `implementer-wave-step-${i + 1}`,
        assigned_validator: `validator-wave-step-${i + 1}`,
      },
    };

    tasks.push(enrichTaskPlanWithExactAnchors(rawTask));
  }

  return planWaveExecution(tasks);
}

export function planEnhanceToWavePlan(
  promptOrFeedbacks: string | readonly FeedbackItem[],
  options: {
    readonly charterGoals?: readonly string[] | undefined;
    readonly baseIdPrefix?: string | undefined;
  } = {},
): SmartWavePlanResult {
  if (typeof promptOrFeedbacks === "string") {
    return expandExternalPromptToWavePlan(promptOrFeedbacks, options);
  }

  const prefix = typeof options.baseIdPrefix === "string" ? options.baseIdPrefix : "fb-wave";
  const tasks: SmartTaskPlan[] = [];

  for (let i = 0; i < promptOrFeedbacks.length; i++) {
    const fb = promptOrFeedbacks[i]!;
    const slug = sanitizeSlug(fb.id);
    const scope = deriveWriteScopeForCategory(fb.category, fb.id);
    const gate = deriveGateForCategory(fb.category, scope);
    const priority = mapFeedbackPriorityToTaskPriority(fb.priority);
    const baseId = `${prefix}-${i + 1}-${slug}`;
    const assignedImplementer = `implementer-${slug}`;
    const assignedValidator = `validator-${slug}`;

    const rawPlan: SmartTaskPlan = {
      id: baseId,
      label: fb.title,
      write_scope: scope,
      gate,
      charter_goals:
        options.charterGoals && options.charterGoals.length > 0 ? options.charterGoals : ["G1"],
      acceptance_criteria: [
        `Satisfy feedback requirements: ${fb.title}`,
        `Pass gate: ${gate}`,
        "Ensure 0 TypeScript any and zero suppressions",
      ],
      dependencies: [],
      source_type: "plan_enhancement",
      priority,
      rationale: `Plan enhanced from feedback item [${fb.category}]: ${fb.content.slice(0, 150)}`,
      assigned_tier: "Tier_2_Coordinator",
      assigned_implementer: assignedImplementer,
      assigned_validator: assignedValidator,
      feedback_id: fb.id,
      metadata: {
        feedback_id: fb.id,
        assigned_implementer: assignedImplementer,
        assigned_validator: assignedValidator,
      },
    };
    const basePlan = enrichTaskPlanWithExactAnchors(rawPlan);

    const dependencies: string[] = [];
    for (const prev of tasks) {
      if (detectScopeOverlap(basePlan.write_scope, prev.write_scope).length > 0) {
        dependencies.push(prev.id);
      }
    }

    tasks.push({
      ...basePlan,
      dependencies,
    });
  }

  return planWaveExecution(tasks);
}

export function deriveWriteScopeForCategory(category: string, id: string): readonly string[] {
  const slug = sanitizeSlug(id);
  switch (category) {
    case "DOCUMENTATION":
      return ["docs/", "olt/references/"];
    case "AGENT_CONTRACTS":
      return ["olt/agents/", "olt/roles/", "olt/references/"];
    case "CLI_TOOLING":
      return [`olt/scripts/src/cli/commands/${slug}.ts`, `tests/unit/cli/${slug}.test.ts`];
    case "WATCHDOG":
      return [
        "olt/scripts/src/authority/watchdog/index.ts",
        "olt/scripts/src/cli/commands/watchdog-ops.ts",
        "tests/unit/authority/watchdog-manager.test.ts",
      ];
    case "SCALING":
      return ["olt/scripts/src/workflow/", "olt/roles/", "tests/unit/workflow/"];
    case "CORE_ENGINE":
    case "ARCHITECTURE":
    default:
      return [`olt/scripts/src/mind/${slug}.ts`, `tests/unit/mind/${slug}.test.ts`];
  }
}

export function deriveGateForCategory(_category: string, writeScope: readonly string[]): string {
  const testFile = writeScope.find((s: string) => s.includes("test.ts") || s.includes("tests/"));
  if (testFile) {
    const cleaned = testFile.endsWith("/") ? testFile.slice(0, -1) : testFile;
    return `bun test ${cleaned} && bun run typecheck`;
  }
  return "bun test tests/unit && bun run typecheck";
}

export function sanitizeSlug(val: string): string {
  return val
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function mapFeedbackPriorityToTaskPriority(fbPriority: string): TaskPriority {
  switch (fbPriority) {
    case "CRITICAL_USER_FEEDBACK":
      return "CRITICAL";
    case "HIGH_ARCHITECTURAL_FEATURE":
      return "HIGH";
    case "USER_DIRECTIVE":
      return "HIGH";
    case "NORMAL":
      return "MEDIUM";
    case "LOW":
      return "LOW";
    default:
      return "MEDIUM";
  }
}
