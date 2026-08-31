import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { RawBacklogItem, RawDefectItem, ThematicCluster } from "./types.ts";

export function deriveDisjointTaskScope(
  domain: string,
  id: string,
  title?: string,
): {
  writeScope: string;
  testScope: string;
  testCommand: string;
  baseSlug: string;
  scopeEnvelope: readonly string[];
} {
  const rawTitle = title !== undefined && title.trim().length > 0 ? title.trim() : "";
  const titleSlug = rawTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cleanId = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const baseSlug =
    titleSlug.length > 0 && titleSlug !== cleanId
      ? `${titleSlug}-${cleanId}`
      : cleanId.length > 0
        ? cleanId
        : "task";

  const writeScope = `olt/scripts/src/${domain}/${baseSlug}.ts`;
  const testScope = `tests/unit/${domain}/${baseSlug}.test.ts`;
  const testCommand = `bun test ${testScope}`;
  const scopeEnvelope = Object.freeze([writeScope, testScope]);

  return { writeScope, testScope, testCommand, baseSlug, scopeEnvelope };
}

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
  const taskScopeMap = new Map<string, { taskLabel: string; testScope: string }>();
  const executionSteps: string[] = [];

  if (matchedItems.length === 0 && matchedDefects.length === 0) {
    const backlogSummary =
      cluster.backlog_item_ids.length > 0 ? cluster.backlog_item_ids.join(", ") : "None";
    const defectSummary = cluster.defect_ids.length > 0 ? cluster.defect_ids.join(", ") : "None";
    const scope = deriveDisjointTaskScope(cluster.domain, cluster.cluster_id, cluster.title);
    executionSteps.push(`[Task 1.1: ${cluster.title}]`);

    lines.push(`### Task 1.1: ${cluster.title} Implementation`);
    lines.push("");
    lines.push("- **Owner / Tier:** Tier 3 Implementer + Independent Validator");
    lines.push(`- **Write Scope:** \`${scope.writeScope}\`, \`${scope.testScope}\``);
    lines.push(
      `- **Read-Only Scope:** \`olt/scripts/src/${cluster.domain}/\`, \`tests/unit/${cluster.domain}/\``,
    );
    lines.push("- **Acceptance Criteria (Stub Must Fail):**");
    lines.push(`  - Resolves backlog items: ${backlogSummary}.`);
    lines.push(`  - Resolves defects: ${defectSummary}.`);
    lines.push("  - Zero TypeScript `any`, zero compiler suppressions.");
    lines.push(`  - Command: \`${scope.testCommand}\` (100% PASS).`);
    lines.push("");
  }

  for (const item of matchedItems) {
    const taskName = item.title !== undefined ? item.title : item.id;
    const itemDetail =
      item.content !== undefined && item.content.length > 0
        ? item.content
        : item.title !== undefined && item.title.length > 0
          ? item.title
          : item.id;
    const scope = deriveDisjointTaskScope(cluster.domain, item.id, item.title);
    const taskLabel = `Task 1.${taskIndex}`;
    taskScopeMap.set(item.id, { taskLabel, testScope: scope.testScope });
    executionSteps.push(`[${taskLabel}: ${taskName}]`);

    lines.push(`### ${taskLabel}: Feature: ${taskName}`);
    lines.push("");
    lines.push("- **Owner / Tier:** Tier 3 Implementer + Independent Validator");
    lines.push(`- **Backlog Ref:** \`${item.id}\``);
    lines.push(`- **Write Scope:** \`${scope.writeScope}\`, \`${scope.testScope}\``);
    lines.push(
      `- **Read-Only Scope:** \`olt/scripts/src/${cluster.domain}/\`, \`tests/unit/${cluster.domain}/\``,
    );
    lines.push("- **Acceptance Criteria (Stub Must Fail):**");
    lines.push(`  - Implement: ${itemDetail}`);
    lines.push(
      "  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.",
    );
    lines.push(`  - Command: \`${scope.testCommand}\` (100% PASS).`);
    lines.push("");
    taskIndex++;
  }

  for (const defect of matchedDefects) {
    const defectName =
      defect.title !== undefined
        ? defect.title
        : defect.message !== undefined
          ? defect.message
          : defect.id;
    const errCode = defect.error_code !== undefined ? defect.error_code : "N/A";
    const defectDetail =
      defect.description !== undefined && defect.description.length > 0
        ? defect.description
        : defect.message !== undefined && defect.message.length > 0
          ? defect.message
          : defect.title !== undefined && defect.title.length > 0
            ? defect.title
            : defect.id;
    const scope = deriveDisjointTaskScope(cluster.domain, defect.id, defect.title);
    const taskLabel = `Task 1.${taskIndex}`;
    taskScopeMap.set(defect.id, { taskLabel, testScope: scope.testScope });
    executionSteps.push(`[${taskLabel}: ${defectName}]`);

    lines.push(`### ${taskLabel}: Defect Remediation: ${defectName}`);
    lines.push("");
    lines.push("- **Owner / Tier:** Tier 3 Implementer + Independent Validator");
    lines.push(`- **Defect Ref:** \`${defect.id}\` (Error Code: \`${errCode}\`)`);
    lines.push(`- **Write Scope:** \`${scope.writeScope}\`, \`${scope.testScope}\``);
    lines.push(
      `- **Read-Only Scope:** \`olt/scripts/src/${cluster.domain}/\`, \`tests/unit/${cluster.domain}/\``,
    );
    lines.push("- **Acceptance Criteria (Stub Must Fail):**");
    lines.push(`  - Remediate: ${defectDetail}`);
    lines.push(
      "  - Zero TypeScript `any`, zero compiler suppressions, zero comments in .ts files.",
    );
    lines.push(`  - Command: \`${scope.testCommand}\` (100% PASS).`);
    lines.push("");
    taskIndex++;
  }

  lines.push("---");
  lines.push("");
  lines.push("## 4. Sequential Execution Order & Critical Path");
  lines.push("");
  lines.push("```text");
  const flowDiagram = `${executionSteps.join(" ──► ")} ──► [Verification: bun test tests/unit/${cluster.domain}/] ──► [Git Staging: git add -A] ──► [Landing]`;
  lines.push(`Execution Flow: ${flowDiagram}`);
  lines.push("```");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 5. Exhaustive Traceability Matrix");
  lines.push("");
  lines.push("| Defect / Backlog ID | Resolved By Task | Verification Target |");
  lines.push("| :--- | :--- | :--- |");

  for (const itemId of cluster.backlog_item_ids) {
    const mapping = taskScopeMap.get(itemId);
    const resolvedBy = mapping?.taskLabel ?? "Task 1.x";
    const target = mapping?.testScope ?? `tests/unit/${cluster.domain}/`;
    lines.push(`| \`${itemId}\` | ${resolvedBy} | \`${target}\` |`);
  }
  for (const defId of cluster.defect_ids) {
    const mapping = taskScopeMap.get(defId);
    const resolvedBy = mapping?.taskLabel ?? "Task 1.x";
    const target = mapping?.testScope ?? `tests/unit/${cluster.domain}/`;
    lines.push(`| \`${defId}\` | ${resolvedBy} | \`${target}\` |`);
  }

  lines.push("");
  return lines.join("\n");
}

export function writePlanFile(targetPath: string, markdown: string, rootDir?: string): string {
  const fullPath =
    rootDir !== undefined
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

export function assertValidBlueprintStructure(markdown: string): boolean {
  if (typeof markdown !== "string") {
    return false;
  }
  if (markdown.trim().length === 0) {
    return false;
  }
  const requiredMarkers = [
    "# ",
    "> **Tracking ID:**",
    "> **Status:**",
    "## 1. Executive Summary",
    "## 2. Core Architectural Pillars",
    "## 3. Work Breakdown",
    "## 4. Sequential Execution Order",
    "## 5. Exhaustive Traceability Matrix",
  ];
  return requiredMarkers.every((marker) => markdown.includes(marker));
}

export const generatePlanBlueprint = generateAndWritePlan;
