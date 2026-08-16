import type { HarnessEvent, Manifest } from "../contracts/capsule.ts";
import type { CommandRecord } from "../contracts/commands.ts";
import type { CompletionReview, TaskRecord } from "../workflow/types.ts";
import { mapFindingDetails } from "./asset-mapper-findings.ts";
import { detectPlaywrightMetadata } from "./asset-mapper-playwright.ts";
import type {
  CommandExecutionDetail,
  MediaAsset,
} from "./types.ts";

export { detectPlaywrightMetadata, mapFindingDetails };

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

function extractMediaPaths(text: string): string[] {
  const matches = text.match(
    /(?:[a-zA-Z0-9_\-\.\/]+?\.(?:png|jpg|jpeg|svg|webm|mp4|pdf|log))\b/gi,
  );
  return matches
    ? Array.from(
        new Set(
          matches.filter(
            (m) =>
              !m.startsWith("http://") &&
              !m.startsWith("https://") &&
              !m.includes("node_modules"),
          ),
        ),
      )
    : [];
}

function inferAssetProps(url: string, cmd?: CommandRecord, task?: TaskRecord) {
  const filename = url.split("/").pop() || url;
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  let type: "image" | "video" | "document" | "log" | "code" | "diagram" = "image";
  let mimeType = "application/octet-stream";
  let title = `Evidence: ${filename}`;

  switch (ext) {
    case "png":
      type = "image";
      mimeType = "image/png";
      title = `Test Snapshot: ${filename}`;
      break;
    case "jpg":
    case "jpeg":
      type = "image";
      mimeType = "image/jpeg";
      title = `Test Snapshot: ${filename}`;
      break;
    case "svg":
      type = "diagram";
      mimeType = "image/svg+xml";
      title = `Validator Layout Audit: ${filename}`;
      break;
    case "webm":
      type = "video";
      mimeType = "video/webm";
      title = `Test Recording: ${filename}`;
      break;
    case "mp4":
      type = "video";
      mimeType = "video/mp4";
      title = `Test Recording: ${filename}`;
      break;
    case "pdf":
      type = "document";
      mimeType = "application/pdf";
      title = `Report Document: ${filename}`;
      break;
    case "log":
      type = "log";
      mimeType = "text/plain";
      title = `Execution Log: ${filename}`;
      break;
    default:
      type = "image";
      mimeType = "image/png";
      title = `Artifact: ${filename}`;
      break;
  }

  const isVal =
    Boolean(cmd?.gate_id) ||
    cmd?.actor === "val" ||
    cmd?.actor === "validator" ||
    cmd?.actor === "critic";
  const stage = isVal ? "validation" : "execution";
  const description = isVal
    ? `Captured by validator during gate check for task ${task ? task.id : "run"}`
    : cmd
      ? `Captured during test execution for command ${cmd.id}`
      : `Evidence captured for task ${task ? task.id : "run"}`;

  const dimensions =
    type === "image" || type === "diagram" || type === "video"
      ? { width: 1280, height: 720 }
      : undefined;

  let sizeBytes = 1024 * 64;
  if (type === "video") sizeBytes = 1024 * 512;
  else if (type === "document") sizeBytes = 1024 * 128;
  else if (type === "diagram") sizeBytes = 1024 * 16;
  else if (type === "log") sizeBytes = 1024 * 8;

  return {
    type,
    mimeType,
    title,
    description,
    dimensions,
    sizeBytes,
    stage,
  };
}

export function mapMediaAssets(
  task?: TaskRecord,
  commands: CommandRecord[] = [],
  options?: {
    runRoot?: string | undefined;
    events?: readonly HarnessEvent[] | undefined;
    manifest?: Manifest | undefined;
    completionReview?: CompletionReview | undefined;
  } | undefined,
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
            ...(a.dimensions ? { dimensions: a.dimensions } : props.dimensions ? { dimensions: props.dimensions } : {}),
            author: a.author || task.lease?.agent_id || "worker",
            ...(a.metadata ? { metadata: a.metadata } : {}),
          });
        }
      }
    }

    if (Array.isArray(rawReport?.screenshots)) {
      for (const s of rawReport.screenshots as MediaAsset[]) {
        if (s && typeof s === "object" && s.url) {
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
      for (const s of rawVal.screenshots as MediaAsset[]) {
        if (s && typeof s === "object" && s.url) {
          const props = inferAssetProps(s.url, undefined, task);
          addAsset({
            id: s.id || `asset-${task.id}-val-${assets.length + 1}`,
            type: s.type || "image",
            url: s.url,
            title: s.title || `Validator Snapshot: ${s.url.split("/").pop()}`,
            description: `Captured by validator during gate check for task ${task.id}`,
            timestamp:
              s.timestamp || (typeof rawVal.started_at === "string" ? rawVal.started_at : new Date().toISOString()),
            mimeType: s.mimeType || "image/png",
            sizeBytes: s.sizeBytes || 1024 * 64,
            dimensions: s.dimensions || { width: 1280, height: 720 },
            author: task.validation?.validator_id || "validator",
            metadata: { stage: "validation" },
          });
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
      if (path && /\.(png|jpg|jpeg|svg|webm|mp4|pdf|log)$/i.test(path)) {
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
