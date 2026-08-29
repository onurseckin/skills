/**
 * Defect Remediation: Monolithic multi-subsystem bundling in docs/planning/documentation-orchestrator-engine/PLAN.md
 * Defect Ref: defect-plan-granularity-monolithic-docs-orchestrator
 * Error Code: MONOLITHIC_PLAN_DEFECT
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DefectEntry, DefectSeverity } from "../mind/contracts/defect-contracts.ts";

export const DEFECT_REF = "defect-plan-granularity-monolithic-docs-orchestrator" as const;
export const MONOLITHIC_PLAN_DEFECT = "MONOLITHIC_PLAN_DEFECT" as const;
export const MAX_PLAN_TASK_COUNT = 15 as const;
export const MAX_SUBSYSTEMS_PER_PLAN = 3 as const;

export interface PlanTaskItem { readonly id: string; readonly description: string; readonly subsystem?: string | undefined; }

export interface PlanDescriptor {
  readonly id: string;
  readonly title: string;
  readonly subsystems: readonly string[];
  readonly targetSubsystems?: readonly string[] | undefined;
  readonly tasks: readonly (PlanTaskItem | string)[];
  readonly estimatedWaves?: number | undefined;
  readonly path?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface PlanGranularityViolation {
  readonly rule: "MAX_TASKS_EXCEEDED" | "MAX_SUBSYSTEMS_EXCEEDED" | "EMPTY_PLAN";
  readonly message: string;
  readonly planId: string;
  readonly actualCount: number;
  readonly maxAllowed: number;
  readonly offendingItems?: readonly string[] | undefined;
}

export interface PlanGranularityValidationResult {
  readonly valid: boolean;
  readonly planId: string;
  readonly taskCount: number;
  readonly subsystemCount: number;
  readonly violations: readonly PlanGranularityViolation[];
  readonly defectRef: typeof DEFECT_REF;
  readonly subsystems: readonly string[];
  readonly tasks: readonly string[];
}

export interface PlanningDirectoryAuditResult {
  readonly auditedPlans: number;
  readonly compliantPlans: number;
  readonly nonCompliantPlans: number;
  readonly violations: readonly PlanGranularityViolation[];
  readonly compliant: boolean;
  readonly defectRef: typeof DEFECT_REF;
  readonly results: readonly PlanGranularityValidationResult[];
}

export interface PlanGranularityOptions {
  readonly maxTasks?: number | undefined;
  readonly maxSubsystems?: number | undefined;
  readonly allowEmpty?: boolean | undefined;
  readonly recursive?: boolean | undefined;
}

export interface CreatePlanGranularityDefectEntryOptions {
  readonly id?: string | undefined;
  readonly planId?: string | undefined;
  readonly filePath?: string | undefined;
  readonly violations?: readonly PlanGranularityViolation[] | undefined;
  readonly status?: string | undefined;
  readonly severity?: DefectSeverity | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly timestamp?: string | undefined;
}

export class PlanGranularityViolationError extends Error {
  readonly code: string;
  readonly defectRef: string = DEFECT_REF;
  readonly violations: readonly PlanGranularityViolation[];
  readonly planId: string;

  constructor(msg: string, violations: readonly PlanGranularityViolation[] = [], planId = "unknown-plan", code = MONOLITHIC_PLAN_DEFECT) {
    super(msg);
    this.name = "PlanGranularityViolationError";
    this.code = code;
    this.violations = violations;
    this.planId = planId;
    Object.setPrototypeOf(this, PlanGranularityViolationError.prototype);
  }
}

export const DOCUMENTATION_ORCHESTRATOR_DECOMPOSED_PLANS: readonly PlanDescriptor[] = Object.freeze([
  {
    id: "docs-orchestrator-foundation-and-roles",
    title: "Docs Orchestrator Manifests, Roles & Guidelines",
    subsystems: Object.freeze(["olt/agents/", "olt/references/roles/", "docs/olt/"]),
    targetSubsystems: Object.freeze(["olt/agents/", "olt/references/roles/", "docs/olt/"]),
    tasks: Object.freeze([
      { id: "Task 1.1", description: "Author agent manifests for docs-orchestrator, coordinator, implementer, validator", subsystem: "olt/agents/" },
      { id: "Task 1.2", description: "Author role specification markdown guides for documentation fleet", subsystem: "olt/references/roles/" },
      { id: "Task 1.3", description: "Update docs/olt/GUIDELINES.md with Diátaxis standards, line envelopes, zero emojis", subsystem: "docs/olt/" },
      { id: "Task 1.4", description: "Update host bindings and policy default agent definitions", subsystem: "olt/agents/" },
    ]),
    estimatedWaves: 1,
  },
  {
    id: "docs-orchestrator-change-detection-and-ast",
    title: "Docs Orchestrator Change Detection & AST Extraction Engine",
    subsystems: Object.freeze(["olt/scripts/src/docs/"]),
    targetSubsystems: Object.freeze(["olt/scripts/src/docs/"]),
    tasks: Object.freeze([
      { id: "Task 2.1", description: "Implement source file to chapter dependency graph mapper", subsystem: "olt/scripts/src/docs/" },
      { id: "Task 2.2", description: "Implement Git diff, working tree status, and drift severity calculator", subsystem: "olt/scripts/src/docs/" },
      { id: "Task 2.3", description: "Implement ts-morph AST export, interface, and schema extraction", subsystem: "olt/scripts/src/docs/" },
      { id: "Task 2.4", description: "Implement markdown AST linter, sizing validator, and link integrity checker", subsystem: "olt/scripts/src/docs/" },
    ]),
    estimatedWaves: 1,
  },
  {
    id: "docs-orchestrator-cadence-and-socratic-critique",
    title: "Docs Orchestrator 5-Minute Pulse Cadence & Socratic Critique Gate",
    subsystems: Object.freeze(["olt/scripts/src/docs/", "olt/scripts/src/cli/"]),
    targetSubsystems: Object.freeze(["olt/scripts/src/docs/", "olt/scripts/src/cli/"]),
    tasks: Object.freeze([
      { id: "Task 3.1", description: "Implement continuous 5-minute autonomous sync scheduler loop", subsystem: "olt/scripts/src/docs/" },
      { id: "Task 3.2", description: "Implement 5-round Socratic adversarial review state machine", subsystem: "olt/scripts/src/docs/" },
      { id: "Task 3.3", description: "Implement chapter concurrency dispatcher and lease management", subsystem: "olt/scripts/src/docs/" },
      { id: "Task 3.4", description: "Implement CLI documentation operations and register commands", subsystem: "olt/scripts/src/cli/" },
    ]),
    estimatedWaves: 1,
  },
  {
    id: "docs-orchestrator-doctor-rbac-and-certification",
    title: "Docs Orchestrator Policy Doctor Integration, RBAC Lock & Certification",
    subsystems: Object.freeze(["olt/scripts/src/reporting/doctor/", "olt/scripts/src/policy/"]),
    targetSubsystems: Object.freeze(["olt/scripts/src/reporting/doctor/", "olt/scripts/src/policy/"]),
    tasks: Object.freeze([
      { id: "Task 4.1", description: "Integrate documentation health diagnostics into policy doctor", subsystem: "olt/scripts/src/reporting/doctor/" },
      { id: "Task 4.2", description: "Enforce strict fail-closed RBAC denying source code mutations for doc roles", subsystem: "olt/scripts/src/policy/" },
      { id: "Task 4.3", description: "Author comprehensive unit and integration test suite", subsystem: "olt/scripts/src/reporting/doctor/" },
      { id: "Task 4.4", description: "Execute global certification and stage release artifacts", subsystem: "olt/scripts/src/policy/" },
    ]),
    estimatedWaves: 1,
  },
]);

export function extractPlanMarkdown(markdown: string, fallbackId = "unknown-plan"): PlanDescriptor {
  let id = fallbackId;
  let title = "Untitled Plan";
  const subsystems: string[] = [];
  const tasks: PlanTaskItem[] = [];
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  if (titleMatch?.[1]) title = titleMatch[1].trim();
  const idMatch = markdown.match(/>\s*\*\*Tracking ID:\*\*\s*`?([^`\n\r]+)`?/i) ?? markdown.match(/Cluster ID:\s*([^\s\n\r]+)/i);
  if (idMatch?.[1]) id = idMatch[1].trim();
  const subMatch = markdown.match(/>\s*\*\*Target Subsystems:\*\*\s*([^\n\r]+)/i) ?? markdown.match(/Target Subsystems:\s*([^\n\r]+)/i);
  if (subMatch?.[1]) {
    for (const sub of subMatch[1].split(",")) {
      const clean = sub.replace(/[`*]/g, "").trim();
      if (clean && !subsystems.includes(clean)) subsystems.push(clean);
    }
  }
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^###\s+(Task\s+[\d.]+(?::\s*.+)?)/i);
    if (heading?.[1]) {
      const h = heading[1].trim();
      const idPart = h.split(":")[0]?.trim() ?? `Task ${tasks.length + 1}`;
      const descPart = h.includes(":") ? h.substring(h.indexOf(":") + 1).trim() : h;
      tasks.push({ id: idPart, description: descPart });
      continue;
    }
    const bullet = line.match(/^-\s+\*\*(Task\s+[\d.]+):\*\*\s*(.+)/i);
    if (bullet?.[1] && bullet[2]) tasks.push({ id: bullet[1].trim(), description: bullet[2].trim() });
  }
  return { id, title, subsystems, targetSubsystems: subsystems, tasks };
}

export function validatePlanGranularity(
  planOrPathOrMarkdown: PlanDescriptor | string,
  options?: PlanGranularityOptions,
): PlanGranularityValidationResult {
  const desc: PlanDescriptor = typeof planOrPathOrMarkdown === "string"
    ? (existsSync(planOrPathOrMarkdown)
      ? extractPlanMarkdown(readFileSync(planOrPathOrMarkdown, "utf-8"), planOrPathOrMarkdown)
      : extractPlanMarkdown(planOrPathOrMarkdown, "inline-plan"))
    : planOrPathOrMarkdown;
  const planId = desc.id || "unknown-plan";
  const subs = desc.subsystems ?? desc.targetSubsystems ?? [];
  const rawTasks = desc.tasks ?? [];
  const taskDescs: string[] = rawTasks.map((t) => (typeof t === "string" ? t : `${t.id}: ${t.description}`));
  const maxTasks = options?.maxTasks ?? MAX_PLAN_TASK_COUNT;
  const maxSubs = options?.maxSubsystems ?? MAX_SUBSYSTEMS_PER_PLAN;
  const violations: PlanGranularityViolation[] = [];

  if (rawTasks.length > maxTasks) {
    violations.push({ rule: "MAX_TASKS_EXCEEDED", message: `Plan '${planId}' task count (${rawTasks.length}) exceeds limit of ${maxTasks}`, planId, actualCount: rawTasks.length, maxAllowed: maxTasks, offendingItems: taskDescs });
  }
  if (subs.length > maxSubs) {
    violations.push({ rule: "MAX_SUBSYSTEMS_EXCEEDED", message: `Plan '${planId}' subsystem count (${subs.length}) exceeds limit of ${maxSubs}`, planId, actualCount: subs.length, maxAllowed: maxSubs, offendingItems: subs });
  }
  if (rawTasks.length === 0 && options?.allowEmpty !== true) {
    violations.push({ rule: "EMPTY_PLAN", message: `Plan '${planId}' contains 0 tasks and is empty`, planId, actualCount: 0, maxAllowed: maxTasks });
  }
  return { valid: violations.length === 0, planId, taskCount: rawTasks.length, subsystemCount: subs.length, violations, defectRef: DEFECT_REF, subsystems: subs, tasks: taskDescs };
}

export function decomposeMonolithicPlan(
  plan: PlanDescriptor,
  maxTasks = MAX_PLAN_TASK_COUNT,
  maxSubsystems = MAX_SUBSYSTEMS_PER_PLAN,
): readonly PlanDescriptor[] {
  const subs = plan.subsystems ?? plan.targetSubsystems ?? [];
  const rawTasks = plan.tasks ?? [];
  if (rawTasks.length <= maxTasks && subs.length <= maxSubsystems && rawTasks.length > 0) return [plan];

  const subPlans: PlanDescriptor[] = [];
  const taskItems: PlanTaskItem[] = rawTasks.map((t, idx) => (typeof t === "string" ? { id: `Task ${idx + 1}`, description: t } : t));
  const numDecomposed = Math.max(Math.ceil(subs.length / maxSubsystems), Math.ceil(taskItems.length / maxTasks), 1);
  const subPerChunk = Math.ceil(subs.length / numDecomposed);
  const tasksPerChunk = Math.ceil(taskItems.length / numDecomposed);

  for (let i = 0; i < numDecomposed; i++) {
    const chunkSubs = subs.slice(i * subPerChunk, (i + 1) * subPerChunk);
    const chunkTasks = taskItems.slice(i * tasksPerChunk, (i + 1) * tasksPerChunk);
    if (chunkTasks.length === 0 && chunkSubs.length === 0) continue;
    subPlans.push({
      id: `${plan.id}-subplan-${i + 1}`,
      title: `${plan.title} (Part ${i + 1})`,
      subsystems: chunkSubs.length > 0 ? chunkSubs : subs.slice(0, maxSubsystems),
      targetSubsystems: chunkSubs.length > 0 ? chunkSubs : subs.slice(0, maxSubsystems),
      tasks: chunkTasks,
      estimatedWaves: 1,
      path: plan.path,
    });
  }
  return subPlans.length > 0 ? subPlans : [plan];
}

export function assertPlanGranularityCompliance(plan: PlanDescriptor | string, options?: PlanGranularityOptions): void {
  const result = validatePlanGranularity(plan, options);
  if (!result.valid) {
    const msgs = result.violations.map((v) => v.message).join("; ");
    throw new PlanGranularityViolationError(`Plan granularity invariant violated: ${msgs}`, result.violations, result.planId);
  }
}

export function auditPlanningDirectoryForMonolithicPlans(dirPath: string, options?: PlanGranularityOptions): PlanningDirectoryAuditResult {
  const results: PlanGranularityValidationResult[] = [];
  function scan(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        if (options?.recursive !== false) scan(fullPath);
      } else if (entry === "PLAN.md" || (entry.endsWith(".md") && !entry.startsWith("."))) {
        try { results.push(validatePlanGranularity(fullPath, options)); } catch { /* skip */ }
      }
    }
  }
  scan(dirPath);
  const nonCompliant = results.filter((r) => !r.valid).length;
  return {
    auditedPlans: results.length,
    compliantPlans: results.filter((r) => r.valid).length,
    nonCompliantPlans: nonCompliant,
    violations: results.flatMap((r) => r.violations),
    compliant: nonCompliant === 0,
    defectRef: DEFECT_REF,
    results,
  };
}

export function createPlanGranularityDefectEntry(options: CreatePlanGranularityDefectEntryOptions = {}): DefectEntry {
  const planId = options.planId ?? "documentation-orchestrator-engine";
  const violations = options.violations ?? [];
  const msgs = violations.map((v) => v.message).join("; ");
  return {
    id: options.id ?? `${DEFECT_REF}-${Date.now()}`,
    domain: "planning-governance",
    error_code: MONOLITHIC_PLAN_DEFECT,
    title: `Monolithic multi-subsystem bundling in plan '${planId}'`,
    description: `Plan granularity defect remediation: decomposed monolithic plan into atomic sub-plans with <= ${MAX_PLAN_TASK_COUNT} tasks and <= ${MAX_SUBSYSTEMS_PER_PLAN} subsystems.`,
    message: violations.length > 0 ? msgs : `Monolithic plan '${planId}' exceeds granularity bounds`,
    status: options.status ?? "open",
    type: "MODULARITY_VIOLATION",
    category: "modularity_violation",
    severity: options.severity ?? "high",
    observation: options.observation ?? (violations.length > 0 ? `Found ${violations.length} violation(s) in '${planId}': ${msgs}` : `Monolithic plan '${planId}' bundled excessive subsystems and tasks.`),
    remediation: options.remediation ?? `Decompose plan '${planId}' into atomic sub-plans with <= ${MAX_PLAN_TASK_COUNT} tasks and <= ${MAX_SUBSYSTEMS_PER_PLAN} subsystems.`,
    context: { defectRef: DEFECT_REF, planId, filePath: options.filePath, maxTasks: MAX_PLAN_TASK_COUNT, maxSubsystems: MAX_SUBSYSTEMS_PER_PLAN, violations },
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}
