import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord } from "../workflow/types.ts";
import type { MediaAsset, PlaywrightMetadata } from "./types.ts";

export function detectPlaywrightMetadata(
  task?: TaskRecord,
  commands: CommandRecord[] = [],
  mediaAssets: MediaAsset[] = [],
): PlaywrightMetadata | undefined {
  const hasPlaywright =
    commands.some((c) =>
      c.argv.some(
        (arg) => typeof arg === "string" && (arg.includes("playwright") || arg.includes("test")),
      ),
    ) || Boolean((task?.report as Record<string, unknown> | undefined)?.playwright);

  if (!hasPlaywright && mediaAssets.length === 0) return undefined;

  const screenshots = mediaAssets
    .filter((a) => a.type === "image" || a.mimeType?.startsWith("image/"))
    .map((s) => ({
      ...s,
      dimensions: s.dimensions || { width: 1280, height: 720 },
      mimeType: s.mimeType || "image/png",
    }));
  const videos = mediaAssets.filter((a) => a.type === "video").map((a) => a.url);
  const traces: string[] = [];

  for (const cmd of commands) {
    const text = [cmd.argv.join(" "), typeof cmd.stdout === "string" ? cmd.stdout : ""].join(" ");
    const traceMatches = text.match(/[\w\-./]+(?:trace|traces)[\w\-./]*\.zip/gi);
    if (traceMatches) {
      for (const tm of traceMatches) {
        if (!traces.includes(tm)) traces.push(tm);
      }
    }
  }

  const testCmd = commands.find((c) =>
    c.argv.some((arg) => typeof arg === "string" && arg.includes("test")),
  );
  const testFile = testCmd?.argv.find(
    (arg) => typeof arg === "string" && (arg.includes(".test.") || arg.includes(".spec.")),
  );

  return {
    viewport: { width: 1280, height: 720 },
    traces,
    videos,
    screenshots,
    ...(testFile ? { testFile } : {}),
    durationMs: testCmd
      ? Date.parse(testCmd.finished_at ?? "") - Date.parse(testCmd.started_at ?? "") || 150
      : 150,
    browser: "chromium",
    status: task?.status === "done" ? "passed" : "failed",
  };
}
