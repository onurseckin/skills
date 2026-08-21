import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { CommandRecord } from "../contracts/commands.ts";
import type { WorkflowState } from "../workflow/types.ts";
import { loadRun } from "../store/index.ts";
import { collectTimeline } from "./timeline-collector.ts";
import { collectMetrics } from "./metrics-collector.ts";
import { generateGraphDataset } from "./graph-generator.ts";
import { formatSummaryMarkdown } from "./markdown-formatter.ts";
import type { SummaryGenerationOptions, SummarySuite } from "./types.ts";

function loadCommandsFromDir(commandsDir: string): Record<string, CommandRecord> {
  const result: Record<string, CommandRecord> = {};
  if (!existsSync(commandsDir)) return result;

  const entries = readdirSync(commandsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const recordPath = join(commandsDir, entry.name, "record.json");
      if (existsSync(recordPath)) {
        try {
          const raw = readFileSync(recordPath, "utf-8");
          const record = JSON.parse(raw) as CommandRecord;
          if (record && record.id) {
            result[record.id] = record;
          }
        } catch {}
      }
    }
  }
  return result;
}

export function generateSummarySuite(options: SummaryGenerationOptions): SummarySuite {
  const { capsulePath, outDir, writeToDisk = true } = options;
  const loaded = loadRun(capsulePath);
  const runId = loaded.manifest.run_id || basename(loaded.runRoot);

  const promptText = loaded.prompt ? new TextDecoder().decode(loaded.prompt) : "";
  const commandsDir = join(loaded.runRoot, "commands");
  const diskCommands = loadCommandsFromDir(commandsDir);
  const state = loaded.state as unknown as WorkflowState;

  const timeline = collectTimeline(loaded.events, loaded.manifest.prompt_bytes);
  const graph = generateGraphDataset({
    runId,
    state,
    promptText,
    commands: diskCommands,
    events: loaded.events,
    manifest: loaded.manifest,
    runRoot: loaded.runRoot,
  });
  const metrics = collectMetrics({
    runId,
    manifest: loaded.manifest,
    state,
    events: loaded.events,
    commands: diskCommands,
    graph,
  });
  const markdown = formatSummaryMarkdown({
    runId,
    runRoot: loaded.runRoot,
    manifest: loaded.manifest,
    promptText,
    metrics,
    timeline,
    state,
    commands: diskCommands,
    graph,
  });

  const suite: SummarySuite = { timeline, metrics, graph, markdown };

  if (writeToDisk) {
    const summaryDir = join(loaded.runRoot, "summary");
    if (!existsSync(summaryDir)) {
      mkdirSync(summaryDir, { recursive: true });
    }

    writeFileSync(
      join(summaryDir, "timeline.json"),
      JSON.stringify(timeline, null, 2) + "\n",
      "utf-8",
    );
    writeFileSync(
      join(summaryDir, "metrics.json"),
      JSON.stringify(metrics, null, 2) + "\n",
      "utf-8",
    );
    writeFileSync(join(summaryDir, "graph.json"), JSON.stringify(graph, null, 2) + "\n", "utf-8");
    writeFileSync(join(summaryDir, "summary.md"), markdown, "utf-8");

    if (outDir) {
      if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
      }
      writeFileSync(join(outDir, `${runId}.json`), JSON.stringify(graph, null, 2) + "\n", "utf-8");
    }
  }

  return suite;
}
