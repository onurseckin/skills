import type { CompletionReview, TaskRecord } from "../workflow/types.ts";
import { inferAssetProps } from "./asset-mapper-props.ts";
import type { FindingDetail, MediaAsset } from "./types.ts";

export type AssetSink = (asset: MediaAsset) => void;
export type IndexProvider = () => number;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// Dimensions, byte counts and capture times are only recorded when the source that captured the
// asset reported them. Nothing here opens the file or watched it being written, so an absent
// measurement stays absent rather than becoming the moment the summary happened to run.

/** Evidence the implementer filed with its own report. */
export function collectReportAssets(task: TaskRecord, add: AssetSink, nextIndex: IndexProvider) {
  const report = asRecord(task.report);
  if (Array.isArray(report?.media_assets)) {
    for (const asset of report.media_assets as MediaAsset[]) {
      if (!asset || typeof asset !== "object" || !asset.url) continue;
      const props = inferAssetProps(asset.url, undefined, task);
      add({
        id: asset.id || `asset-${task.id}-${nextIndex()}`,
        type: asset.type || props.type,
        url: asset.url,
        title: asset.title || props.title,
        description: asset.description || props.description,
        ...(asset.timestamp ? { timestamp: asset.timestamp } : {}),
        mimeType: asset.mimeType || props.mimeType,
        ...(asset.sizeBytes === undefined ? {} : { sizeBytes: asset.sizeBytes }),
        ...(asset.dimensions ? { dimensions: asset.dimensions } : {}),
        ...(task.lease?.agent_id ? { author: task.lease.agent_id } : {}),
        ...(asset.metadata ? { metadata: asset.metadata } : {}),
      });
    }
  }

  if (!Array.isArray(report?.screenshots)) return;
  for (const shot of report.screenshots as Array<MediaAsset | string>) {
    const url = typeof shot === "string" ? shot : shot?.url;
    if (!url) continue;
    const props = inferAssetProps(url, undefined, task);
    const object = typeof shot === "string" ? undefined : shot;
    add({
      id: object?.id || `asset-${task.id}-${nextIndex()}`,
      // props.type is read from the url's own extension (inferAssetProps), the same signal
      // mimeType and description below already trust; a bare "image" default would ignore that
      // and misreport a video or log capture as an image whenever the record omits `type`.
      type: object?.type || props.type,
      url,
      title: object?.title || `Test Snapshot: ${url.split("/").pop()}`,
      description: object?.description || props.description,
      ...(object?.timestamp ? { timestamp: object.timestamp } : {}),
      mimeType: object?.mimeType || props.mimeType,
      ...(object?.sizeBytes === undefined ? {} : { sizeBytes: object.sizeBytes }),
      ...(object?.dimensions ? { dimensions: object.dimensions } : {}),
      ...(object?.author || task.lease?.agent_id
        ? { author: object?.author || task.lease?.agent_id }
        : {}),
      metadata: object?.metadata ?? { stage: "execution" },
    });
  }
}

/** Evidence the validator captured while it was checking the submission. */
export function collectValidationAssets(
  task: TaskRecord,
  add: AssetSink,
  nextIndex: IndexProvider,
): void {
  // B12.2: one entry per domain, so every open domain's own screenshots are collected — not just a
  // single representative validator's.
  for (const entry of task.validations ?? []) {
    const validation = asRecord(entry);
    if (!Array.isArray(validation?.screenshots)) continue;
    const startedAt = typeof validation.started_at === "string" ? validation.started_at : undefined;
    for (const shot of validation.screenshots as Array<MediaAsset | string>) {
      const url = typeof shot === "string" ? shot : shot?.url;
      if (!url) continue;
      const props = inferAssetProps(url, undefined, task);
      const object = typeof shot === "string" ? undefined : shot;
      add({
        id: object?.id || `asset-${task.id}-val-${nextIndex()}`,
        // See collectReportAssets above: props.type is the extension-derived signal, not a guess.
        type: object?.type || props.type,
        url,
        title: object?.title || `Validator Snapshot: ${url.split("/").pop()}`,
        description: `Captured by validator during gate check for task ${task.id}`,
        ...(object?.timestamp || startedAt ? { timestamp: object?.timestamp || startedAt } : {}),
        mimeType: object?.mimeType || props.mimeType,
        ...(object?.sizeBytes === undefined ? {} : { sizeBytes: object.sizeBytes }),
        ...(object?.dimensions ? { dimensions: object.dimensions } : {}),
        ...(entry.validator_id ? { author: entry.validator_id } : {}),
        metadata: { stage: "validation" },
      });
    }
  }
}

export function collectFindingAssets(
  findings: readonly FindingDetail[],
  add: AssetSink,
  nextIndex: IndexProvider,
  context: { task?: TaskRecord | undefined; criticId?: string | undefined },
): void {
  for (const finding of findings) {
    if (!Array.isArray(finding.screenshots)) continue;
    for (const shot of finding.screenshots) {
      if (!shot || typeof shot !== "object" || !shot.url) continue;
      const props = inferAssetProps(shot.url, undefined, context.task);
      const author =
        shot.author ||
        finding.author ||
        finding.validatorId ||
        context.task?.validations?.[0]?.validator_id ||
        context.criticId;
      const scopeId = context.task ? context.task.id : "critic";
      add({
        id: shot.id || `asset-${scopeId}-finding-${nextIndex()}`,
        // props.type is always set (inferAssetProps has no undefined case), so a trailing "image"
        // literal here would never run - it would just hide that the real fallback is one level up.
        type: shot.type || props.type,
        url: shot.url,
        title: shot.title || `Finding Snapshot: ${shot.url.split("/").pop()}`,
        description: shot.description || `Evidence for finding ${finding.id}`,
        ...(shot.timestamp || finding.timestamp
          ? { timestamp: shot.timestamp || finding.timestamp }
          : {}),
        mimeType: shot.mimeType || props.mimeType,
        ...(shot.sizeBytes === undefined ? {} : { sizeBytes: shot.sizeBytes }),
        ...(shot.dimensions ? { dimensions: shot.dimensions } : {}),
        ...(author ? { author } : {}),
        metadata: {
          stage: context.task ? "validation" : "critic",
          findingId: finding.id,
          ...(shot.metadata ?? {}),
        },
      });
    }
  }
}

/** Integrity evidence the critic itself recorded on the completion review. */
export function collectCriticEvidenceAssets(
  review: CompletionReview,
  add: AssetSink,
  nextIndex: IndexProvider,
): void {
  for (const entry of review.integrity_evidence ?? []) {
    const record = asRecord(entry);
    const path =
      typeof record?.path === "string"
        ? record.path
        : typeof record?.reference === "string"
          ? record.reference
          : undefined;
    if (!path || !/\.(png|jpg|jpeg|webp|gif|svg|bmp|webm|mp4|pdf|log)$/i.test(path)) continue;
    const props = inferAssetProps(path);
    add({
      id: `asset-critic-${nextIndex()}`,
      type: props.type,
      url: path,
      title: props.title,
      description: `Integrity evidence recorded by critic ${review.critic_id}`,
      ...(review.reviewed_at ? { timestamp: review.reviewed_at } : {}),
      mimeType: props.mimeType,
      author: review.critic_id,
      metadata: { stage: "critic" },
    });
  }
}
