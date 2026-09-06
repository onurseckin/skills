import { renderCli } from "./cli-renderer.ts";
import { renderMarkdown } from "./markdown-renderer.ts";
import type { MonitoringSnapshot, RenderOptions } from "./types.ts";

export { renderCli } from "./cli-renderer.ts";
export { renderMarkdown } from "./markdown-renderer.ts";

/**
 * Renders structured JSON view for machine consumption, automated gates,
 * and programmatic validation without parsing logs.
 */
export function renderJson(snapshot: MonitoringSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Universal renderer dispatching to CLI, Markdown, or JSON formats.
 */
export function renderMonitoringSnapshot(
  snapshot: MonitoringSnapshot,
  options?: RenderOptions,
): string {
  const format = options?.format ?? "cli";
  switch (format) {
    case "markdown":
      return renderMarkdown(snapshot, options);
    case "json":
      return renderJson(snapshot);
    case "cli":
    default:
      return renderCli(snapshot, options);
  }
}
