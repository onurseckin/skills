import type { Evidenced } from "../contracts/evidence.ts";
import type { EnhancedPlanDocument } from "./enhanced-plan.ts";

const NONE = "_Nothing reported._";

function bullets(entries: readonly Evidenced<string>[]): string[] {
  return entries.length === 0 ? [NONE] : entries.map((entry) => `- ${entry.value}`);
}

function section(title: string, body: readonly string[]): string[] {
  return [`## ${title}`, "", ...body, ""];
}

/**
 * The review document a human actually opens. It leads with what the enhancement is and is not,
 * because the one way this file can do damage is by being mistaken for the prompt.
 */
export function renderEnhancedPlanMarkdown(document: EnhancedPlanDocument): string {
  const todos =
    document.todos.length === 0
      ? [NONE]
      : document.todos.map((todo, index) => `${index + 1}. ${todo.text}`);
  const sources =
    document.sources.length === 0
      ? [NONE]
      : document.sources.map((source) => `- \`${source.value}\``);

  const lines = [
    `# Enhanced Plan — ${document.run_id}`,
    "",
    `> **Derived, not authoritative.** \`${document.derived_from}\` remains the only requirement source;`,
    "> this document restates and expands it for review. Every line below is **agent-reported**:",
    "> an agent read the repository and said this. The harness measured none of it, and invented none",
    "> of it.",
    "",
    `- **Prompt sha256**: \`${document.prompt_sha256}\``,
    `- **Recorded**: ${document.recorded_at} by \`${document.actor}\``,
    `- **Evidence class**: \`agent_reported\` throughout`,
    "",
    ...section("Brief", [document.summary === undefined ? NONE : document.summary.value]),
    ...section("To-do", todos),
    ...section("What the agent observed", bullets(document.observations)),
    ...section("Risks", bullets(document.risks)),
    ...section("Open questions", bullets(document.open_questions)),
    ...section("Sources read", sources),
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}
