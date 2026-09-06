import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluatePlanEpistemicReadiness } from "../../mind/planning/engine/index.ts";
import { auditPlanGranularity, type TaskGranularityInput } from "../../mind/auditing/index.ts";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export interface PlanQualityCheckOptions {
  readonly runRoot?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly events?: readonly Readonly<Record<string, unknown>>[] | null | undefined;
}

interface ParsedTask {
  readonly id: string;
  readonly record: Readonly<Record<string, unknown>>;
}

function resolvePrompt(state?: Readonly<Record<string, unknown>> | null, runRoot?: string): string {
  if (typeof state?.prompt === "string") return state.prompt;
  const p = state?.planning as Record<string, unknown> | undefined;
  if (typeof p?.prompt === "string") return p.prompt;
  if (runRoot) {
    try {
      const promptPath = join(runRoot, "prompt.md");
      if (existsSync(promptPath)) return readFileSync(promptPath, "utf-8");
    } catch {}
  }
  return "";
}

function extractTasks(state?: Readonly<Record<string, unknown>> | null): readonly ParsedTask[] {
  const raw = state && typeof state === "object" ? (state.tasks ?? state.planning_tasks) : null;
  if (!raw || typeof raw !== "object") return [];
  if (Array.isArray(raw)) {
    return raw
      .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
      .map((r, i) => ({ id: typeof r.id === "string" ? r.id : `task-${i + 1}`, record: r }));
  }
  return Object.entries(raw)
    .filter((e): e is [string, Record<string, unknown>] =>
      Boolean(e[1] && typeof e[1] === "object"),
    )
    .map(([k, r]) => ({ id: typeof r.id === "string" ? r.id : k, record: r }));
}

function eventField(evt: Readonly<Record<string, unknown>>, key: string): string {
  return typeof evt[key] === "string" ? (evt[key] as string).toLowerCase() : "";
}

function hasPlanner(
  events: readonly Readonly<Record<string, unknown>>[],
  state?: Readonly<Record<string, unknown>> | null,
): boolean {
  if (state?.planner_session || (state?.planning as Record<string, unknown> | undefined)?.planner) {
    return true;
  }
  return events.some((e) => {
    const s = `${eventField(e, "name")} ${eventField(e, "kind")} ${eventField(e, "type")} ${eventField(e, "actor")} ${eventField(e, "role")}`;
    const p =
      e.payload && typeof e.payload === "object" ? (e.payload as Record<string, unknown>) : {};
    return (
      s.includes("plan:enhance") ||
      s.includes("plan-enhance") ||
      s.includes("planner") ||
      `${p.actor ?? ""} ${p.role ?? ""}`.toLowerCase().includes("planner")
    );
  });
}

function hasBrainstorm(
  events: readonly Readonly<Record<string, unknown>>[],
  state?: Readonly<Record<string, unknown>> | null,
): boolean {
  if (
    state?.brainstorming ||
    (state?.planning as Record<string, unknown> | undefined)?.brainstorming
  ) {
    return true;
  }
  return events.some((e) =>
    `${eventField(e, "name")} ${eventField(e, "kind")} ${eventField(e, "type")}`.includes(
      "brainstorm",
    ),
  );
}

function isApproved(status: unknown, verdict: unknown): boolean {
  const s = typeof status === "string" ? status.toLowerCase() : "";
  const v = typeof verdict === "string" ? verdict.toLowerCase() : "";
  return s === "approved" || s === "pass" || v === "approved" || v === "pass";
}

function hasValidator(
  state?: Readonly<Record<string, unknown>> | null,
  events: readonly Readonly<Record<string, unknown>>[] = [],
): boolean {
  const r = (state?.plan_review ?? state?.planReview ?? state?.plan_validation) as
    | Record<string, unknown>
    | undefined;
  if (r && isApproved(r.status, r.verdict)) return true;
  return events.some((e) => {
    const s = `${eventField(e, "name")} ${eventField(e, "kind")} ${eventField(e, "type")}`;
    if (!s.includes("review") && !s.includes("validat")) return false;
    const p =
      e.payload && typeof e.payload === "object" ? (e.payload as Record<string, unknown>) : {};
    return isApproved(e.status, e.verdict) || isApproved(p.status, p.verdict);
  });
}

function getTaskDesc(rec: Readonly<Record<string, unknown>>): string {
  for (const k of ["description", "desc", "prompt", "summary", "title"]) {
    if (typeof rec[k] === "string") return (rec[k] as string).trim();
  }
  return "";
}

function getTaskLines(rec: Readonly<Record<string, unknown>>): number {
  for (const k of [
    "requirementLines",
    "requirement_lines",
    "lineCoordinates",
    "line_coordinates",
  ]) {
    const v = rec[k];
    if (Array.isArray(v)) return v.length;
    if (typeof v === "number") return v;
  }
  return 0;
}

function getConfidenceScore(
  state: Readonly<Record<string, unknown>> | null | undefined,
  prompt: string,
  tasks: readonly ParsedTask[],
): number {
  const ep = state?.epistemic as Record<string, unknown> | undefined;
  if (typeof ep?.confidenceScore === "number") return ep.confidenceScore;
  if (typeof state?.confidenceScore === "number") return state.confidenceScore;
  if (typeof state?.epistemic_confidence === "number") return state.epistemic_confidence;
  const arr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
  return evaluatePlanEpistemicReadiness(
    {
      planId: typeof state?.planId === "string" ? state.planId : "active-plan",
      prompt,
      observations: arr(state?.observations),
      sources: arr(state?.sources),
      risks: arr(state?.risks),
      tasks: tasks.map((t) => ({
        id: t.id,
        title: typeof t.record.title === "string" ? t.record.title : t.id,
        gate: typeof t.record.gate === "string" ? t.record.gate : undefined,
        write_scope: Array.isArray(t.record.write_scope)
          ? (t.record.write_scope as string[])
          : undefined,
      })),
    },
    0.85,
  ).epistemic.confidenceScore;
}

export function checkPlanQualityAndAgentUtilization(
  options: PlanQualityCheckOptions = {},
): DoctorCheckEngineResult {
  const tasks = extractTasks(options.state);
  if (tasks.length === 0) {
    return { engine: "checkPlanQualityAndAgentUtilization", passed: true, findings: [] };
  }

  const findings: DoctorDiagnosticFinding[] = [];
  const add = (
    c: string,
    s: "ERROR" | "WARN",
    m: string,
    d?: Readonly<Record<string, unknown>>,
  ) => {
    findings.push({
      code: c,
      severity: s,
      engine: "checkPlanQualityAndAgentUtilization",
      message: m,
      ...(d ? { details: d } : {}),
    });
  };

  const rawEvents = options.events ?? [];
  const prompt = resolvePrompt(options.state, options.runRoot);
  const promptLength = prompt.trim().length;

  let shortTaskCount = 0;
  let totalLines = 0;
  for (const t of tasks) {
    if (getTaskDesc(t.record).length < 100) shortTaskCount++;
    totalLines += getTaskLines(t.record);
  }
  if (totalLines === 0 && options.state) totalLines += getTaskLines(options.state);

  if (promptLength < 500 || shortTaskCount > 0 || totalLines === 0) {
    const reasons: string[] = [];
    if (promptLength < 500) reasons.push(`prompt is ${promptLength} chars (< 500)`);
    if (shortTaskCount > 0) reasons.push(`${shortTaskCount} task(s) desc < 100 chars`);
    if (totalLines === 0) reasons.push("0 line coordinate mappings");
    add(
      "SHALLOW_PLAN_CONTEXT_FLAW",
      "ERROR",
      `Plan context depth insufficient: ${reasons.join(", ")}`,
      { promptLength, minPromptLength: 500, shortTaskCount, totalLineCoordinates: totalLines },
    );
  }

  if (!hasPlanner(rawEvents, options.state)) {
    add(
      "UNUTILIZED_PLANNING_AGENTS_FLAW",
      "ERROR",
      "Plan created/compiled without engaging Tier 3 planner (zero planner sessions or plan:enhance events in events log)",
      { eventsCount: rawEvents.length },
    );
  }

  if (!hasBrainstorm(rawEvents, options.state)) {
    add(
      "MISSING_EIGHT_VECTOR_EXPANSION_FLAW",
      "ERROR",
      "Plan lacks 8-vector Socratic expansion (zero plan:brainstorm events found)",
      { eventsCount: rawEvents.length },
    );
  }

  if (!hasValidator(options.state, rawEvents)) {
    add(
      "MISSING_PLAN_VALIDATOR_AUDIT",
      "ERROR",
      "Plan lacks adversarial audit from plan-validator (zero plan:review approval token minted by independent validator)",
      { planReview: options.state?.plan_review ?? null },
    );
  }

  const confidenceScore = getConfidenceScore(options.state, prompt, tasks);
  if (confidenceScore < 0.85) {
    add(
      "EPISTEMIC_CONFIDENCE_DEFICIT",
      "WARN",
      `Epistemic confidence score ${(confidenceScore * 100).toFixed(1)}% is below threshold (85.0%)`,
      { confidenceScore, threshold: 0.85 },
    );
  }

  const taskInputs: TaskGranularityInput[] = tasks.map((t) => ({
    taskId: t.id,
    writeScope: Array.isArray(t.record.write_scope) ? (t.record.write_scope as string[]) : [],
    files: Array.isArray(t.record.files) ? (t.record.files as string[]) : undefined,
    targetSubsystems: Array.isArray(t.record.targetSubsystems)
      ? (t.record.targetSubsystems as string[])
      : undefined,
  }));

  const rep = auditPlanGranularity(taskInputs, {
    repoRoot: options.repoRoot,
    minFilesForTaskScopeCheck: 1,
  });

  const gReasons: string[] = [];
  if (tasks.length > 6) gReasons.push(`tasks count (${tasks.length} > 6)`);
  if (rep.subsystem_count > 2) {
    gReasons.push(`subsystems (${rep.subsystem_count} > 2): ${rep.subsystems.join(", ")}`);
  }
  for (const item of taskInputs) {
    const fCount = item.files?.length ?? item.writeScope.length;
    if (fCount > 3) gReasons.push(`task "${item.taskId}" files (${fCount} > 3)`);
  }

  if (gReasons.length > 0 || !rep.is_compliant) {
    add(
      "PLAN_GRANULARITY_VIOLATION",
      "ERROR",
      `Plan granularity violation: ${gReasons.join("; ")}`,
      {
        taskCount: tasks.length,
        subsystemCount: rep.subsystem_count,
        subsystems: rep.subsystems,
        findings: rep.findings,
      },
    );
  }

  return {
    engine: "checkPlanQualityAndAgentUtilization",
    passed: findings.filter((f) => f.severity === "ERROR").length === 0,
    findings,
  };
}
