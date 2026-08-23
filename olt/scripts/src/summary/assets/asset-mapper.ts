import type { Manifest } from "../../contracts/capsule.ts";
import type { CommandRecord } from "../../contracts/commands.ts";
import type { CompletionReview, TaskRecord } from "../../workflow/types.ts";
import { queryScreenshots } from "../../reporting/screenshot-store.ts";
import { extractFindingScreenshots, mapFindingDetails } from "./asset-mapper-findings.ts";
import { extractMediaPaths, inferAssetProps } from "./asset-mapper-props.ts";
import { measureAssets } from "./asset-measure.ts";
import { readLogText } from "../markdown/node-evidence.ts";
import {
  collectCriticEvidenceAssets,
  collectFindingAssets,
  collectReportAssets,
  collectValidationAssets,
} from "./asset-mapper-task-sources.ts";
import type { MediaAsset } from "../types.ts";

export { extractFindingScreenshots, mapFindingDetails };

export type AssetScope = "all" | "critic" | "implementer" | "validator";

export interface AssetMapOptions {
  runRoot?: string | undefined;
  manifest?: Manifest | undefined;
  completionReview?: CompletionReview | undefined;
  scope?: AssetScope | undefined;
  validatorId?: string | undefined;
  implementerId?: string | undefined;
}

function wants(scope: AssetScope, wanted: Exclude<AssetScope, "all">): boolean {
  return scope === "all" || scope === wanted;
}

function screenshotProducer(
  actor: string | undefined,
  options: AssetMapOptions | undefined,
): Exclude<AssetScope, "all"> | undefined {
  if (actor === undefined) return undefined;
  if (options?.validatorId !== undefined && actor === options.validatorId) return "validator";
  if (options?.implementerId !== undefined && actor === options.implementerId) return "implementer";
  return undefined;
}

function screenshotAssets(
  task: TaskRecord | undefined,
  scope: AssetScope,
  runRoot: string,
  add: (asset: MediaAsset) => void,
  options: AssetMapOptions | undefined,
): void {
  if (!task?.id) return;
  let records;
  try {
    records = queryScreenshots(runRoot, { taskId: task.id });
  } catch {
    return;
  }
  for (const record of records) {
    const url = record.path || record.original_path || record.name;
    if (!url) continue;
    const producer = screenshotProducer(record.actor, options);
    if (producer === undefined || !wants(scope, producer)) continue;
    const byValidator = producer === "validator";
    const props = inferAssetProps(url, undefined, task);
    add({
      id: `asset-screenshot-${task.id}-${record.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
      type: props.type,
      url,
      title: props.title.startsWith("Test Snapshot:")
        ? props.title
        : `Test Snapshot: ${record.name}`,
      description: `Captured screenshot ${record.name} for task ${task.id}`,
      ...(record.timestamp ? { timestamp: record.timestamp } : {}),
      mimeType: props.mimeType,
      ...(record.bytes !== undefined ? { sizeBytes: record.bytes } : {}),
      ...(record.actor ? { author: record.actor } : {}),
      metadata: {
        stage: byValidator ? "validation" : "execution",
        ...(record.command_id ? { commandId: record.command_id } : {}),
        ...(record.task_id ? { taskId: record.task_id } : {}),
      },
    });
  }
}

export function mapRunScreenshotAssets(runRoot: string): MediaAsset[] {
  let records;
  try {
    records = queryScreenshots(runRoot, {});
  } catch {
    return [];
  }
  const assets: MediaAsset[] = [];
  for (const record of records) {
    const url = record.path || record.original_path || record.name;
    if (!url) continue;
    const props = inferAssetProps(url);
    assets.push({
      id: `asset-run-${record.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
      type: props.type,
      url,
      title: props.title,
      description: `Screenshot ${record.name} recorded without a node attribution`,
      ...(record.timestamp ? { timestamp: record.timestamp } : {}),
      mimeType: props.mimeType,
      ...(record.bytes !== undefined ? { sizeBytes: record.bytes } : {}),
      ...(record.actor ? { author: record.actor } : {}),
      metadata: {
        attribution: "unattributed",
        ...(record.command_id ? { commandId: record.command_id } : {}),
        ...(record.task_id ? { taskId: record.task_id } : {}),
      },
    });
  }
  return measureAssets(assets, runRoot);
}

function commandAssets(
  commands: readonly CommandRecord[],
  task: TaskRecord | undefined,
  add: (asset: MediaAsset) => void,
  nextIndex: () => number,
  runRoot: string | undefined,
): void {
  for (const command of commands) {
    const sources = [
      command.argv.join(" "),
      readLogText(command.logs?.stdout?.path, runRoot) ?? "",
      readLogText(command.logs?.stderr?.path, runRoot) ?? "",
    ].join("\n");
    for (const path of extractMediaPaths(sources)) {
      const props = inferAssetProps(path, command, task);
      const author = command.actor ?? task?.lease?.agent_id;
      add({
        id: `asset-${task ? task.id : "evidence"}-${nextIndex()}`,
        type: props.type,
        url: path,
        title: props.title,
        description: props.description,
        timestamp: command.finished_at ?? command.started_at,
        ...(author ? { author } : {}),
        mimeType: props.mimeType,
        metadata: {
          commandId: command.id,
          ...(command.exit_code !== null ? { exitCode: command.exit_code } : {}),
          stage: props.stage,
        },
      });
    }
  }
}

export function mapMediaAssets(
  task?: TaskRecord,
  commands: CommandRecord[] = [],
  options?: AssetMapOptions | undefined,
): MediaAsset[] {
  const scope = options?.scope ?? "all";
  const assets: MediaAsset[] = [];
  const seen = new Set<string>();
  const add = (asset: MediaAsset) => {
    if (!asset.url || seen.has(asset.url)) return;
    seen.add(asset.url);
    assets.push(asset);
  };
  const nextIndex = () => assets.length + 1;

  if (task) {
    if (wants(scope, "implementer")) collectReportAssets(task, add, nextIndex);
    if (wants(scope, "validator")) {
      collectValidationAssets(task, add, nextIndex);
      collectFindingAssets(mapFindingDetails(task, options), add, nextIndex, { task });
    }
  }

  if (options?.completionReview && wants(scope, "critic")) {
    const review = options.completionReview;
    collectCriticEvidenceAssets(review, add, nextIndex);
    collectFindingAssets(mapFindingDetails(undefined, options), add, nextIndex, {
      criticId: review.critic_id,
    });
  }

  if (options?.runRoot) screenshotAssets(task, scope, options.runRoot, add, options);
  commandAssets(commands, task, add, nextIndex, options?.runRoot);

  return measureAssets(assets, options?.runRoot);
}
