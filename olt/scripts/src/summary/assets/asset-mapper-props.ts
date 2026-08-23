import type { CommandRecord } from "../../core/contracts/commands.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import { resolveValidatorId } from "../graph/graph-node-context.ts";

export function getMimeTypeForUrl(url: string, explicitMime?: unknown): string {
  if (typeof explicitMime === "string" && explicitMime.trim().length > 0) {
    return explicitMime.trim();
  }
  const qSplit = url.split("?")[0] ?? "";
  const hSplit = qSplit.split("#")[0] ?? "";
  const cleanUrl = hSplit.toLowerCase();
  if (cleanUrl.endsWith(".png")) return "image/png";
  if (cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg")) return "image/jpeg";
  if (cleanUrl.endsWith(".svg")) return "image/svg+xml";
  if (cleanUrl.endsWith(".webp")) return "image/webp";
  if (cleanUrl.endsWith(".gif")) return "image/gif";
  if (cleanUrl.endsWith(".bmp")) return "image/bmp";
  return "image/png";
}

export function isImageExtension(str: string): boolean {
  const qSplit = str.split("?")[0] ?? "";
  const hSplit = qSplit.split("#")[0] ?? "";
  return /\.(png|jpe?g|svg|webp|gif|bmp)$/i.test(hSplit);
}

export function extractMediaPaths(text: string): string[] {
  const matches = text.match(
    /(?:[a-zA-Z0-9_\-\.\/]+?\.(?:png|jpg|jpeg|webp|gif|svg|bmp|webm|mp4|pdf|log))\b/gi,
  );
  return matches
    ? Array.from(
        new Set(
          matches.filter(
            (m) =>
              !m.startsWith("http://") && !m.startsWith("https://") && !m.includes("node_modules"),
          ),
        ),
      )
    : [];
}

export function inferAssetProps(url: string, cmd?: CommandRecord, task?: TaskRecord) {
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
    case "webp":
      type = "image";
      mimeType = "image/webp";
      title = `Test Snapshot: ${filename}`;
      break;
    case "gif":
      type = "image";
      mimeType = "image/gif";
      title = `Test Snapshot: ${filename}`;
      break;
    case "bmp":
      type = "image";
      mimeType = "image/bmp";
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

  const validatorId = task === undefined ? undefined : resolveValidatorId(task);
  const isVal =
    Boolean(cmd?.gate_id) ||
    (validatorId !== undefined && cmd?.actor !== undefined && cmd.actor === validatorId);
  const stage = isVal ? "validation" : "execution";
  const description = isVal
    ? `Captured by validator during gate check for task ${task ? task.id : "run"}`
    : cmd
      ? `Captured during test execution for command ${cmd.id}`
      : `Evidence captured for task ${task ? task.id : "run"}`;

  return {
    type,
    mimeType,
    title,
    description,
    stage,
  };
}
