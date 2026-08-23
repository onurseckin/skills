import { HarnessError } from "../../errors/harness-error.ts";
import { uiDomainApplies } from "../../contracts/workflow.ts";
import { isJsonObject, type JsonValue } from "../../contracts/json.ts";
import type { TaskRecord, WorkflowState } from "../types.ts";

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function acceptanceCriteriaTexts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const texts: string[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const criterion = textOf((item as Record<string, unknown>).criterion);
    if (criterion) texts.push(criterion);
  }
  return texts;
}

function requirementDocumentEntries(value: unknown): Record<string, JsonValue>[] {
  if (Array.isArray(value)) return value.filter(isJsonObject);
  if (isJsonObject(value) && Array.isArray(value.requirements))
    return value.requirements.filter(isJsonObject);
  return [];
}

export function taskClassificationTexts(state: WorkflowState, task: TaskRecord): string[] {
  const texts: string[] = [];
  const label = textOf(task.label);
  if (label) texts.push(label);
  const byId = new Map(
    requirementDocumentEntries(state.requirements).map((requirement) => [
      textOf(requirement.id),
      requirement,
    ]),
  );
  for (const id of task.requirement_ids) {
    const requirement = byId.get(id);
    if (!requirement) continue;
    for (const field of ["instruction", "implementation", "source_excerpt"] as const) {
      const text = textOf(requirement[field]);
      if (text) texts.push(text);
    }
    texts.push(...acceptanceCriteriaTexts(requirement.acceptance));
  }
  return texts;
}

export function classifiesAsUiTask(
  state: WorkflowState,
  task: TaskRecord,
  analyzerSaysUi: boolean,
): boolean {
  return analyzerSaysUi || uiDomainApplies(task.write_scope, taskClassificationTexts(state, task));
}

export interface RoleArtifactEvidence {
  readonly hasArtifact: boolean;
  readonly screenshots?: readonly {
    readonly sizeBytes?: number;
    readonly bytes?: number;
    readonly name?: string;
  }[];
  readonly manifests?: readonly unknown[];
}

export function assertRoleArtifactPresent(
  taskId: string,
  domainApplies: boolean,
  evidence: RoleArtifactEvidence,
): void {
  if (!domainApplies) return;

  const validScreenshots = (evidence.screenshots ? evidence.screenshots : []).filter((s) => {
    const sz =
      typeof s.sizeBytes === "number" ? s.sizeBytes : typeof s.bytes === "number" ? s.bytes : 0;
    return sz >= 1024;
  });

  const hasValidArtifact =
    evidence.hasArtifact &&
    (evidence.screenshots === undefined ||
      evidence.screenshots.length === 0 ||
      validScreenshots.length > 0 ||
      (evidence.manifests !== undefined && evidence.manifests.length > 0));

  if (!hasValidArtifact) {
    if (evidence.screenshots && evidence.screenshots.length > 0 && validScreenshots.length === 0) {
      throw new HarnessError(
        "INVALID_STATE",
        `cannot review ${taskId}: this task's UI/frontend surface requires valid non-stubbed screenshot ` +
          `evidence (>= 1024 bytes); all recorded screenshots are below 1024 bytes`,
        [],
        3,
        `run real visual capture or Playwright test suite to generate valid PNG screenshots (>= 1024 bytes), then retry task:review for ${taskId}`,
      );
    }
    throw new HarnessError(
      "INVALID_STATE",
      `cannot review ${taskId}: this task's UI/frontend surface requires captured artifact evidence ` +
        `(a screenshot >= 1024 bytes or DOM-metrics record) before this review can mean anything, pass or reject ` +
        `alike; none is on record`,
      [],
      3,
      `run the visual validation suite so it captures a screenshot (>= 1024 bytes) or visual-report.json, then retry task:review for ${taskId}`,
    );
  }
}

const HEAVY_UI_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "companion_manifest",
  "companion_manifests",
  "visual_report",
  "dom_report",
  "dom_metrics",
  "screenshot_records",
  "cognitive_questions",
  "cognitive_tree",
  "dom_physics",
  "layout_shifts",
  "layout_shift_records",
]);

/**
 * Prune heavy companion manifests, visual artifacts, and oversized cognitive payload trees
 * when a task does not involve UI/visual surfaces.
 */
export function pruneNonUiPayload<T extends Record<string, unknown>>(
  payload: T,
  isUiTask: boolean,
): T {
  if (isUiTask) return payload;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (HEAVY_UI_PAYLOAD_KEYS.has(key)) {
      continue;
    }
    if (key === "screenshots" && Array.isArray(value) && value.length === 0) {
      continue;
    }
    if (key === "dual_channel_audit" && typeof value === "object" && value !== null) {
      result[key] = {
        isUiTask: false,
        passed: true,
        mode: "non_ui_skipped",
      };
      continue;
    }
    result[key] = value;
  }
  return result as T;
}

/**
 * Gates review report data, ensuring non-UI task review packets omit heavy companion manifests
 * and visual captures, reducing serialized review packet size from ~82.9 KB down to < 2 KB.
 */
export function gateReviewPayload(
  _taskId: string,
  isUiTask: boolean,
  reportData: Record<string, unknown>,
): Record<string, unknown> {
  return pruneNonUiPayload(reportData, isUiTask);
}
