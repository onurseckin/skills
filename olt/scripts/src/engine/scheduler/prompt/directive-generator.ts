import {
  COGNITIVE_DIRECTIVE_DIMENSIONS,
  type CognitiveDirectiveDimension,
  type CognitiveProbingDirective,
  type CognitivePromptOptions,
} from "./types.ts";
import { selectSocraticQuestions, SOCRATIC_CATALOG } from "./socratic.ts";
import { generateAntiStagnationTriggers } from "./anti-stagnation.ts";
import { generateCognitiveSteps } from "./multi-step.ts";
import { extractContextAnchors } from "./context-anchor.ts";

export function formatDirectiveMarkdown(directive: CognitiveProbingDirective): string {
  const lines: string[] = [];

  lines.push("================================================================================");
  lines.push(`🧠 COGNITIVE SCHEDULER PROBING DIRECTIVE: ${directive.title.toUpperCase()}`);
  lines.push(
    `[Dimension: ${directive.dimension} | Tick: ${directive.tickNumber} | Cycle: ${directive.cycleIndex} | ID: ${directive.id}]`,
  );
  lines.push("================================================================================");
  lines.push("");

  // 1. Strategic Directive
  lines.push("🎯 STRATEGIC DIRECTIVE:");
  lines.push(directive.strategicDirective);
  lines.push("");

  // 2. Context Refresh Anchors
  if (directive.contextAnchors.length > 0) {
    lines.push("📌 CONTEXT REFRESH ANCHORS:");
    for (const anchor of directive.contextAnchors) {
      lines.push(`  - **${anchor.title}**: ${anchor.detail}`);
    }
    lines.push("");
  }

  // 3. Socratic Self-Questioning Inquiries
  if (directive.socraticQuestions.length > 0) {
    lines.push("🔍 FUNDAMENTAL SOCRATIC INQUIRIES:");
    for (const q of directive.socraticQuestions) {
      lines.push(`  - **[${q.dimension}]**: ${q.question}`);
      lines.push(`    *Rationale*: ${q.rationale}`);
      if (q.falsificationCriterion) {
        lines.push(`    *Falsification Proof*: ${q.falsificationCriterion}`);
      }
    }
    lines.push("");
  }

  // 4. Anti-Stagnation Triggers
  if (directive.antiStagnationTriggers.length > 0) {
    lines.push("⚡ ANTI-STAGNATION TRIGGERS & INTERVENTIONS:");
    for (const trigger of directive.antiStagnationTriggers) {
      lines.push(
        `  - ⚠️ **[${trigger.severity.toUpperCase()}] ${trigger.triggerCondition}**: ${trigger.imperativeAction}`,
      );
      lines.push(`    *Shock Mechanism*: ${trigger.shockMechanism}`);
    }
    lines.push("");
  }

  // 5. Multi-Step Actionable Execution Pathway
  if (directive.steps.length > 0) {
    lines.push("🚀 MULTI-STEP ACTIONABLE EXECUTION PATHWAY:");
    for (const step of directive.steps) {
      lines.push(`  Step ${step.stepNumber}: **${step.title}**`);
      lines.push(`    - *Action*: ${step.action}`);
      lines.push(`    - *Required Proof*: ${step.requiredProof}`);
      if (step.forbiddenShortcuts && step.forbiddenShortcuts.length > 0) {
        lines.push(`    - *Forbidden Shortcuts*: ${step.forbiddenShortcuts.join("; ")}`);
      }
    }
    lines.push("");
  }

  // 6. Direct Actionable Imperatives
  if (directive.actionableImperatives.length > 0) {
    lines.push("📋 IMMEDIATE ACTIONABLE IMPERATIVES:");
    for (let i = 0; i < directive.actionableImperatives.length; i++) {
      lines.push(`  ${i + 1}. ${directive.actionableImperatives[i]}`);
    }
    lines.push("");
  }

  lines.push("================================================================================");
  lines.push(
    "Execute next verified action now. Preserve all hard invariants and 100% type soundness.",
  );

  return lines.join("\n");
}

export class CognitiveDirectiveGenerator {
  public static generateDirective(options: CognitivePromptOptions = {}): CognitiveProbingDirective {
    const tick = options.tickNumber ?? 1;
    const cycle = options.cycleIndex ?? tick;
    const streak = options.zeroValueStreak ?? 0;
    const stagnant = options.stagnant === true;

    // Determine dimension with prompt variance
    let dimension: CognitiveDirectiveDimension;
    if (options.preferredDimension !== undefined) {
      dimension = options.preferredDimension;
    } else if (stagnant || streak >= 3) {
      dimension = "anti_stagnation_intervention";
    } else if (options.recentErrors && options.recentErrors.length > 0) {
      dimension = "socratic_forensics";
    } else {
      // Rotate dimensions across cycles to eliminate monotone ticks
      const dimensionIndex = cycle % COGNITIVE_DIRECTIVE_DIMENSIONS.length;
      dimension = COGNITIVE_DIRECTIVE_DIMENSIONS[dimensionIndex] ?? "socratic_forensics";
    }

    const template = SOCRATIC_CATALOG[dimension] ?? SOCRATIC_CATALOG.socratic_forensics;
    const socraticQuestions = selectSocraticQuestions(dimension, options);
    const antiStagnationTriggers = generateAntiStagnationTriggers(options);
    const steps = generateCognitiveSteps(dimension, options);
    const contextAnchors = extractContextAnchors(options);

    const actionableImperatives: string[] = [
      "Inspect current files and verified test suites before applying mutations.",
      "Ensure 0 any annotations, 0 @ts-ignore, and 0 eslint-disable suppressions.",
      "Execute gate commands with deterministic evidence capture on stdout.",
    ];

    if (stagnant || streak >= 2) {
      actionableImperatives.unshift(
        "Break quiescent stall immediately: admit a new capability task or execute deep regression sweeps.",
      );
    }

    const id = `cog-dir-${cycle}-${dimension.slice(0, 8)}`;
    const generatedAt = new Date().toISOString();

    const partialDirective = {
      id,
      tickNumber: tick,
      cycleIndex: cycle,
      dimension,
      title: template.title,
      strategicDirective: template.strategicDirective,
      socraticQuestions,
      steps,
      actionableImperatives,
      antiStagnationTriggers,
      contextAnchors,
      generatedAt,
    };

    const formattedMarkdown = formatDirectiveMarkdown({
      ...partialDirective,
      formattedMarkdown: "",
    });

    return {
      ...partialDirective,
      formattedMarkdown,
    };
  }

  public static generatePrompt(options: CognitivePromptOptions = {}): string {
    const directive = this.generateDirective(options);
    return directive.formattedMarkdown;
  }
}

export function generateCognitiveDirective(
  options: CognitivePromptOptions = {},
): CognitiveProbingDirective {
  return CognitiveDirectiveGenerator.generateDirective(options);
}

export function generateCognitiveSchedulerPrompt(options: CognitivePromptOptions = {}): string {
  return CognitiveDirectiveGenerator.generatePrompt(options);
}

export function generateProbingDirective(
  options: CognitivePromptOptions = {},
): CognitiveProbingDirective {
  return CognitiveDirectiveGenerator.generateDirective(options);
}
