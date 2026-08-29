import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { RawBacklogItem, RawDefectItem, ThematicCluster } from "./types.ts";

export function generatePlanMarkdown(
  cluster: ThematicCluster,
  items: readonly RawBacklogItem[] = [],
  defects: readonly RawDefectItem[] = [],
): string {
  const domainUpper = cluster.domain.toUpperCase();
  const trackingId = `fb-${cluster.cluster_id}`;
  const dateStr = cluster.planned_at.slice(0, 10);

  const matchedItems = items.filter((item) => cluster.backlog_item_ids.includes(item.id));
  const matchedDefects = defects.filter((defect) => cluster.defect_ids.includes(defect.id));

  const lines: string[] = [
    `# ${cluster.title} Master Plan`,
    "",
    `> **Tracking ID:** \`${trackingId}\`  `,
    `> **Status:** \`PHASE 1 - EXHAUSTIVE ARCHITECTURAL SPECIFICATION & TASK BREAKDOWN\`  `,
    `> **Target Subsystems:** \`olt/scripts/src/${cluster.domain}/\`, \`tests/unit/${cluster.domain}/\`  `,
    `> **Author:** Tier 0 Strategic Mind Supervisor & Infinite Product Owner  `,
    `> **Created:** ${dateStr}`,
    "",
    "---",
    "",
    "## 1. Executive Summary & The Assembly Pipeline Vision",
    "",
    `This Phase 1 blueprint coordinates the implementation of the ${domainUpper} domain cluster.`,
    `It addresses ${cluster.backlog_item_ids.length} backlog requirement(s) and ${cluster.defect_ids.length} defect remediation(s) under the zero-idle asynchronous pre-planning pipeline.`,
    "",
    "```text",
    `┌─────────────────────────────────────────────────────────────────────────────────────────────┐`,
    `│                    ${domainUpper} DOMAIN ARCHITECTURAL ASSEMBLY MATRIX                             │`,
    `├─────────────────────────────────────────────────────────────────────────────────────────────┤`,
    `│  Cluster ID: ${cluster.cluster_id.padEnd(76)}│`,
    `│  Planned At: ${cluster.planned_at.padEnd(76)}│`,
    `│  Backlog Count: ${String(cluster.backlog_item_ids.length).padEnd(73)}│`,
    `│  Defect Count:  ${String(cluster.defect_ids.length).padEnd(73)}│`,
    `└─────────────────────────────────────────────────────────────────────────────────────────────┘`,
    "```",
    "",
    "---",
    "",
    "## 2. Core Architectural Pillars & Design Specifications",
    "",
    "1. **Zero TypeScript `any` & Zero Suppressions**: Strictly enforced across all domain components.",
    "2. **Subdomain Git Staging Invariant (Reflog Safety)**: Execute `git add -A` upon task verification.",
    "3. **5-Minute Straggler SLA**: Partition any work exceeding 300s into parallel subagents ($P = \\lceil W/S \\rceil$).",
    "4. **Deterministic Traceability**: Every requirement and defect maps to verified unit and integration tests.",
    "",
    "---",
    "",
    "## 3. Work Breakdown & Disjoint Task Specifications",
    "",
  ];

  let taskIndex = 1;

  if (matchedItems.length === 0 && matchedDefects.length === 0) {
    // Fallback template task if raw arrays were not provided
    lines.push(`### Task 1.1: ${cluster.title} Implementation`);
    lines.push("");
    lines.push("- **Owner / Tier:** Tier 3 Implementer + Independent Validator");
    lines.push(`- **Write Scope:** \`olt/scripts/src/${cluster.domain}/${cluster.cluster_id}.ts\``);
    lines.push(`- **Read-Only Scope:** \`olt/scripts/src/${cluster.domain}/\``);
    lines.push("- **Acceptance Criteria (Stub Must Fail):**");
    lines.push(`  - Resolves backlog items: ${cluster.backlog_item_ids.join(", ") || "None"}.`);
    lines.push(`  - Resolves defects: ${cluster.defect_ids.join(", ") || "None"}.`);
    lines.push("  - Zero TypeScript `any`, zero compiler suppressions.");
    lines.push(
      `  - Command: \`bun test tests/unit/${cluster.domain}/${cluster.cluster_id}.test.ts\` (100% PASS).`,
    );
    lines.push("");
  }

  for (const item of matchedItems) {
    const taskName = item.title ?? item.id;
    lines.push(`### Task 1.${taskIndex}: Feature: ${taskName}`);
    lines.push("");
    lines.push("- **Owner / Tier:** Tier 3 Implementer + Independent Validator");
    lines.push(`- **Backlog Ref:** \`${item.id}\``);
    lines.push(`- **Write Scope:** \`olt/scripts/src/${cluster.domain}/${item.id}.ts\``);
    lines.push(`- **Read-Only Scope:** \`olt/scripts/src/${cluster.domain}/\``);
    lines.push("- **Acceptance Criteria (Stub Must Fail):**");
    lines.push(`  - Implement: ${item.content || item.title || item.id}`);
    lines.push("  - Zero TypeScript `any`, zero compiler suppressions.");
    lines.push(
      `  - Command: \`bun test tests/unit/${cluster.domain}/${item.id}.test.ts\` (100% PASS).`,
    );
    lines.push("");
    taskIndex++;
  }

  for (const defect of matchedDefects) {
    const defectName = defect.title ?? defect.message ?? defect.id;
    lines.push(`### Task 1.${taskIndex}: Defect Remediation: ${defectName}`);
    lines.push("");
    lines.push("- **Owner / Tier:** Tier 3 Implementer + Independent Validator");
    lines.push(
      `- **Defect Ref:** \`${defect.id}\` (Error Code: \`${defect.error_code ?? "N/A"}\`)`,
    );
    lines.push(`- **Write Scope:** \`olt/scripts/src/${cluster.domain}/${defect.id}.ts\``);
    lines.push(`- **Read-Only Scope:** \`olt/scripts/src/${cluster.domain}/\``);
    lines.push("- **Acceptance Criteria (Stub Must Fail):**");
    lines.push(
      `  - Remediate: ${defect.description || defect.message || defect.title || defect.id}`,
    );
    lines.push("  - Zero TypeScript `any`, zero compiler suppressions.");
    lines.push(
      `  - Command: \`bun test tests/unit/${cluster.domain}/${defect.id}.test.ts\` (100% PASS).`,
    );
    lines.push("");
    taskIndex++;
  }

  lines.push("---");
  lines.push("");
  lines.push("## 4. Sequential Execution Order & Critical Path");
  lines.push("");
  lines.push("```text");
  lines.push(
    `Execution Order: [Task 1.1] ──► [Verification] ──► [Git Staging: git add -A] ──► [Landing]`,
  );
  lines.push("```");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 5. Exhaustive Traceability Matrix");
  lines.push("");
  lines.push("| Defect / Backlog ID | Resolved By Task | Verification Test File |");
  lines.push("| :--- | :--- | :--- |");

  for (const itemId of cluster.backlog_item_ids) {
    lines.push(`| \`${itemId}\` | Task 1.x | \`tests/unit/${cluster.domain}/${itemId}.test.ts\` |`);
  }
  for (const defId of cluster.defect_ids) {
    lines.push(`| \`${defId}\` | Task 1.x | \`tests/unit/${cluster.domain}/${defId}.test.ts\` |`);
  }

  lines.push("");
  return lines.join("\n");
}

export function writePlanFile(targetPath: string, markdown: string, rootDir?: string): string {
  const fullPath = rootDir
    ? isAbsolute(targetPath)
      ? targetPath
      : resolve(rootDir, targetPath)
    : resolve(targetPath);

  const parentDir = dirname(fullPath);
  mkdirSync(parentDir, { recursive: true });
  writeFileSync(fullPath, markdown, "utf-8");
  return fullPath;
}

export function generateAndWritePlan(
  cluster: ThematicCluster,
  items: readonly RawBacklogItem[] = [],
  defects: readonly RawDefectItem[] = [],
  rootDir?: string,
): { planPath: string; markdown: string } {
  const markdown = generatePlanMarkdown(cluster, items, defects);
  const writtenPath = writePlanFile(cluster.plan_path, markdown, rootDir);
  return { planPath: writtenPath, markdown };
}
