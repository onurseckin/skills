import type { HarnessEvent, Manifest } from "../contracts/capsule.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import type { CompletionReview, TaskRecord } from "../workflow/types.ts";
import { queryScreenshots } from "../reporting/screenshot-store.ts";
import { extractFindingScreenshots, mapFindingDetails } from "./asset-mapper-findings.ts";
import { detectPlaywrightMetadata } from "./asset-mapper-playwright.ts";
import { extractMediaPaths, inferAssetProps } from "./asset-mapper-props.ts";
import type { CommandExecutionDetail, FindingDetail, MediaAsset } from "./types.ts";

export { detectPlaywrightMetadata, extractFindingScreenshots, mapFindingDetails };

export function mapCommandDetails(commands: CommandRecord[]): CommandExecutionDetail[] {
  return commands.map((c) => {
    const started = c.started_at ? Date.parse(c.started_at) : 0;
    const finished = c.finished_at ? Date.parse(c.finished_at) : started;
    const stdout = typeof c.stdout === "string" ? c.stdout.slice(-1000) : undefined;
    const stderr = typeof c.stderr === "string" ? c.stderr.slice(-1000) : undefined;
    return {
      id: c.id,
      argv: c.argv,
      cwd: c.cwd,
      exitCode: c.exit_code ?? 0,
      durationMs: finished >= started ? finished - started : 0,
      startedAt: c.started_at,
      finishedAt: c.finished_at ?? c.started_at,
      ...(c.record_path ? { logPath: c.record_path } : {}),
      ...(stdout !== undefined ? { stdoutSnippet: stdout } : {}),
      ...(stderr !== undefined ? { stderrSnippet: stderr } : {}),
    };
  });
}

export function mapMediaAssets(
  task?: TaskRecord,
  commands: CommandRecord[] = [],
  options?:
    | {
        runRoot?: string | undefined;
        events?: readonly HarnessEvent[] | undefined;
        manifest?: Manifest | undefined;
        completionReview?: CompletionReview | undefined;
      }
    | undefined,
): MediaAsset[] {
  const assets: MediaAsset[] = [];
  const seenUrls = new Set<string>();

  const addAsset = (asset: MediaAsset) => {
    if (!asset.url) return;
    if (seenUrls.has(asset.url)) return;
    seenUrls.add(asset.url);
    assets.push(asset);
  };

  if (task) {
    const rawReport = task.report as Record<string, unknown> | undefined;
    if (Array.isArray(rawReport?.media_assets)) {
      for (const a of rawReport.media_assets as MediaAsset[]) {
        if (a && typeof a === "object" && a.url) {
          const props = inferAssetProps(a.url, undefined, task);
          addAsset({
            id: a.id || `asset-${task.id}-${assets.length + 1}`,
            type: a.type || props.type,
            url: a.url,
            title: a.title || props.title,
            description: a.description || props.description,
            timestamp: a.timestamp || new Date().toISOString(),
            mimeType: a.mimeType || props.mimeType,
            sizeBytes: a.sizeBytes || props.sizeBytes,
            ...(a.dimensions
              ? { dimensions: a.dimensions }
              : props.dimensions
                ? { dimensions: props.dimensions }
                : {}),
            author: a.author || task.lease?.agent_id || "worker",
            ...(a.metadata ? { metadata: a.metadata } : {}),
          });
        }
      }
    }

    if (Array.isArray(rawReport?.screenshots)) {
      for (const s of rawReport.screenshots as Array<MediaAsset | string>) {
        if (typeof s === "string") {
          const props = inferAssetProps(s, undefined, task);
          addAsset({
            id: `asset-${task.id}-${assets.length + 1}`,
            type: "image",
            url: s,
            title: `Test Snapshot: ${s.split("/").pop()}`,
            description: props.description,
            timestamp: new Date().toISOString(),
            mimeType: props.mimeType,
            sizeBytes: props.sizeBytes,
            dimensions: { width: 1280, height: 720 },
            author: task.lease?.agent_id || "worker",
            metadata: { stage: "execution" },
          });
        } else if (s && typeof s === "object" && s.url) {
          const props = inferAssetProps(s.url, undefined, task);
          addAsset({
            id: s.id || `asset-${task.id}-${assets.length + 1}`,
            type: s.type || "image",
            url: s.url,
            title: s.title || `Test Snapshot: ${s.url.split("/").pop()}`,
            description: s.description || props.description,
            timestamp: s.timestamp || new Date().toISOString(),
            mimeType: s.mimeType || "image/png",
            sizeBytes: s.sizeBytes || 1024 * 64,
            dimensions: s.dimensions || { width: 1280, height: 720 },
            author: s.author || task.lease?.agent_id || "worker",
            ...(s.metadata ? { metadata: s.metadata } : {}),
          });
        }
      }
    }

    const rawVal = task.validation as Record<string, unknown> | undefined;
    if (Array.isArray(rawVal?.screenshots)) {
      for (const s of rawVal.screenshots as Array<MediaAsset | string>) {
        if (typeof s === "string") {
          const props = inferAssetProps(s, undefined, task);
          addAsset({
            id: `asset-${task.id}-val-${assets.length + 1}`,
            type: "image",
            url: s,
            title: `Validator Snapshot: ${s.split("/").pop()}`,
            description: `Captured by validator during gate check for task ${task.id}`,
            timestamp:
              typeof rawVal?.started_at === "string" ? rawVal.started_at : new Date().toISOString(),
            mimeType: props.mimeType,
            sizeBytes: props.sizeBytes,
            dimensions: { width: 1280, height: 720 },
            author: task.validation?.validator_id || "validator",
            metadata: { stage: "validation" },
          });
        } else if (s && typeof s === "object" && s.url) {
          const props = inferAssetProps(s.url, undefined, task);
          addAsset({
            id: s.id || `asset-${task.id}-val-${assets.length + 1}`,
            type: s.type || "image",
            url: s.url,
            title: s.title || `Validator Snapshot: ${s.url.split("/").pop()}`,
            description: `Captured by validator during gate check for task ${task.id}`,
            timestamp:
              s.timestamp ||
              (typeof rawVal.started_at === "string"
                ? rawVal.started_at
                : new Date().toISOString()),
            mimeType: s.mimeType || "image/png",
            sizeBytes: s.sizeBytes || 1024 * 64,
            dimensions: s.dimensions || { width: 1280, height: 720 },
            author: task.validation?.validator_id || "validator",
            metadata: { stage: "validation" },
          });
        }
      }
    }

    const taskFindings: FindingDetail[] = mapFindingDetails(task, options);
    for (const f of taskFindings) {
      if (Array.isArray(f.screenshots)) {
        for (const s of f.screenshots) {
          if (s && typeof s === "object" && s.url) {
            const props = inferAssetProps(s.url, undefined, task);
            addAsset({
              id: s.id || `asset-${task.id}-finding-${assets.length + 1}`,
              type: s.type || props.type || "image",
              url: s.url,
              title: s.title || `Finding Snapshot: ${s.url.split("/").pop()}`,
              description: s.description || `Evidence for finding ${f.id}`,
              timestamp: s.timestamp || f.timestamp || new Date().toISOString(),
              mimeType: s.mimeType || props.mimeType || "image/png",
              sizeBytes: s.sizeBytes || props.sizeBytes || 1024 * 64,
              dimensions: s.dimensions || props.dimensions || { width: 1280, height: 720 },
              author:
                s.author ||
                f.author ||
                f.validatorId ||
                task.validation?.validator_id ||
                "validator",
              metadata: {
                stage: "validation",
                findingId: f.id,
                ...(s.metadata ?? {}),
              },
            });
          }
        }
      }
    }
  }

  if (options?.completionReview) {
    const cr = options.completionReview;
    for (const ie of cr.integrity_evidence ?? []) {
      const ieRec = ie as Record<string, unknown>;
      const path =
        typeof ieRec.path === "string"
          ? ieRec.path
          : typeof ieRec.reference === "string"
            ? ieRec.reference
            : undefined;
      if (path && /\.(png|jpg|jpeg|webp|gif|svg|bmp|webm|mp4|pdf|log)$/i.test(path)) {
        const props = inferAssetProps(path);
        addAsset({
          id: `asset-critic-${assets.length + 1}`,
          type: props.type,
          url: path,
          title: props.title,
          description: `Integrity evidence recorded by critic ${cr.critic_id}`,
          timestamp: cr.reviewed_at || new Date().toISOString(),
          mimeType: props.mimeType,
          sizeBytes: props.sizeBytes,
          ...(props.dimensions ? { dimensions: props.dimensions } : {}),
          author: cr.critic_id,
          metadata: { stage: "critic" },
        });
      }
    }

    const criticFindings: FindingDetail[] = mapFindingDetails(undefined, options);
    for (const f of criticFindings) {
      if (Array.isArray(f.screenshots)) {
        for (const s of f.screenshots) {
          if (s && typeof s === "object" && s.url) {
            const props = inferAssetProps(s.url);
            addAsset({
              id: s.id || `asset-critic-finding-${assets.length + 1}`,
              type: s.type || props.type || "image",
              url: s.url,
              title: s.title || `Critic Finding Snapshot: ${s.url.split("/").pop()}`,
              description: s.description || `Evidence for critic finding ${f.id}`,
              timestamp: s.timestamp || f.timestamp || new Date().toISOString(),
              mimeType: s.mimeType || props.mimeType || "image/png",
              sizeBytes: s.sizeBytes || props.sizeBytes || 1024 * 64,
              dimensions: s.dimensions || props.dimensions || { width: 1280, height: 720 },
              author: s.author || f.author || f.validatorId || cr.critic_id || "critic",
              metadata: {
                stage: "critic",
                findingId: f.id,
                ...(s.metadata ?? {}),
              },
            });
          }
        }
      }
    }
  }

  if (options?.runRoot) {
    try {
      const queried = queryScreenshots(options.runRoot, {
        ...(task?.id ? { taskId: task.id } : {}),
      });
      for (const qs of queried) {
        const url = qs.evidence_path || qs.report_path || qs.original_path || qs.name;
        if (!url) continue;
        const props = inferAssetProps(url, undefined, task);
        const stage = qs.actor === "val" || qs.actor === "validator" ? "validation" : "execution";
        addAsset({
          id: `asset-screenshot-${task ? task.id : "run"}-${qs.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
          type: props.type || "image",
          url,
          title: props.title.startsWith("Test Snapshot:")
            ? props.title
            : `Test Snapshot: ${qs.name}`,
          description: `Captured screenshot ${qs.name} for task ${task ? task.id : "run"}`,
          timestamp: qs.timestamp || new Date().toISOString(),
          mimeType: props.mimeType || "image/png",
          sizeBytes: qs.size_bytes || props.sizeBytes || 1024 * 64,
          dimensions: props.dimensions || { width: 1280, height: 720 },
          author:
            qs.actor || task?.validation?.validator_id || task?.lease?.agent_id || "validator",
          metadata: {
            stage,
            ...(qs.command_id ? { commandId: qs.command_id } : {}),
            ...(qs.task_id ? { taskId: qs.task_id } : {}),
          },
        });
      }
    } catch {}
  }

  for (const cmd of commands) {
    const textSources = [
      cmd.argv.join(" "),
      typeof cmd.stdout === "string" ? cmd.stdout : "",
      typeof cmd.stderr === "string" ? cmd.stderr : "",
    ];

    for (const src of textSources) {
      const extracted = extractMediaPaths(src);
      for (const match of extracted) {
        const props = inferAssetProps(match, cmd, task);
        const timestamp = cmd.finished_at ?? cmd.started_at ?? new Date().toISOString();
        const author =
          cmd.actor ??
          task?.lease?.agent_id ??
          (props.stage === "validation" ? "validator" : "worker");

        addAsset({
          id: `asset-${task ? task.id : "evidence"}-${assets.length + 1}`,
          type: props.type,
          url: match,
          title: props.title,
          description: props.description,
          timestamp,
          author,
          mimeType: props.mimeType,
          sizeBytes: props.sizeBytes,
          ...(props.dimensions ? { dimensions: props.dimensions } : {}),
          metadata: {
            commandId: cmd.id,
            exitCode: cmd.exit_code,
            stage: props.stage,
          },
        });
      }
    }
  }

  return assets;
}
