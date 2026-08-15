import type { CommandRecord } from "../contracts/commands.ts";
import type { TaskRecord } from "../workflow/types.ts";
import type {
  CommandExecutionDetail,
  FindingDetail,
  MediaAsset,
  PlaywrightMetadata,
} from "./types.ts";

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

export function mapFindingDetails(task: TaskRecord): FindingDetail[] {
  return (task.findings ?? []).map((f) => ({
    id: f.id,
    ...(f.requirement_id ? { requirementId: f.requirement_id } : {}),
    severity:
      f.severity === "critical" ? "critical" : f.severity === "minor" ? "suggestion" : "important",
    observation: f.observation,
    ...(f.remediation ? { remediation: f.remediation } : {}),
    status: f.status === "resolved" ? "resolved" : "open",
  }));
}

export function mapMediaAssets(task: TaskRecord, commands: CommandRecord[]): MediaAsset[] {
  const assets: MediaAsset[] = [];
  const rawReport = task.report as Record<string, unknown> | undefined;

  if (Array.isArray(rawReport?.media_assets)) {
    for (const a of rawReport.media_assets as MediaAsset[]) {
      if (a && typeof a === "object" && a.id && a.url) {
        assets.push(a);
      }
    }
  }

  if (Array.isArray(rawReport?.screenshots)) {
    for (const s of rawReport.screenshots as MediaAsset[]) {
      if (s && typeof s === "object" && s.id && s.url) {
        assets.push({ ...s, type: s.type ?? "image" });
      }
    }
  }

  for (const cmd of commands) {
    if (
      cmd.argv.some(
        (arg) => typeof arg === "string" && (arg.includes("playwright") || arg.includes("test")),
      )
    ) {
      if (typeof cmd.stdout === "string" && cmd.stdout.includes(".png")) {
        const matches = cmd.stdout.match(/[\w\-./]+\.png/g);
        if (matches) {
          for (const match of matches) {
            assets.push({
              id: `asset-${task.id}-${assets.length + 1}`,
              type: "image",
              url: match,
              title: `Test Artifact: ${match.split("/").pop()}`,
              description: `Generated during command ${cmd.id}`,
              timestamp: cmd.finished_at ?? cmd.started_at,
              mimeType: "image/png",
              sizeBytes: 1024 * 48,
              dimensions: { width: 1280, height: 720 },
            });
          }
        }
      }
    }
  }

  return assets;
}

export function detectPlaywrightMetadata(
  task: TaskRecord,
  commands: CommandRecord[],
  mediaAssets: MediaAsset[],
): PlaywrightMetadata | undefined {
  const hasPlaywright =
    commands.some((c) =>
      c.argv.some(
        (arg) => typeof arg === "string" && (arg.includes("playwright") || arg.includes("test")),
      ),
    ) || Boolean((task.report as Record<string, unknown> | undefined)?.playwright);

  if (!hasPlaywright && mediaAssets.length === 0) return undefined;

  const screenshots = mediaAssets.filter((a) => a.type === "image");
  const testCmd = commands.find((c) =>
    c.argv.some((arg) => typeof arg === "string" && arg.includes("test")),
  );
  const testFile = testCmd?.argv.find(
    (arg) => typeof arg === "string" && (arg.includes(".test.") || arg.includes(".spec.")),
  );

  return {
    viewport: { width: 1280, height: 720 },
    traces: [],
    videos: [],
    screenshots,
    ...(testFile ? { testFile } : {}),
    durationMs: testCmd
      ? Date.parse(testCmd.finished_at ?? "") - Date.parse(testCmd.started_at ?? "") || 150
      : 150,
    browser: "chromium",
    status: task.status === "done" ? "passed" : "failed",
  };
}
