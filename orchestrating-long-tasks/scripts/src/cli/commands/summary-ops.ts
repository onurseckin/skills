import { basename, join } from "node:path";
import { generateSummarySuite } from "../../summary/generate-summary.ts";
import { generateUnifiedReport } from "../../reporting/unified.ts";
import { textFlag, type Flags } from "../options.ts";

export function summaryExportCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const out = textFlag(flags, "out", false);

  const suite = generateSummarySuite({
    capsulePath: run,
    ...(out ? { outDir: out } : {}),
    writeToDisk: true,
  });

  const runId = basename(run);
  const summaryDir = join(run, "summary");

  const lines: string[] = [];
  lines.push(`### Summary Suite Exported: \`${runId}\``);
  lines.push(`- **Capsule Summary Root**: \`${summaryDir}\``);
  lines.push(`- **Artifacts Generated**:`);
  lines.push(
    `  - \`graph.json\` (GVUI GraphDataset, ${suite.graph.nodes.length} nodes, ${suite.graph.edges.length} edges)`,
  );
  lines.push(`  - \`timeline.json\` (${suite.timeline.length} chronological events)`);
  lines.push(
    `  - \`metrics.json\` (${suite.metrics.satisfied_tasks}/${suite.metrics.total_tasks} satisfied tasks)`,
  );
  lines.push(`  - \`summary.md\` (complete run report)`);
  if (out) {
    lines.push(`- **GVUI Registry Export**: \`${join(out, `${runId}.json`)}\``);
  }
  lines.push("");

  return {
    markdown: lines.join("\n"),
    run_root: run,
    summary_dir: summaryDir,
    out_dir: out,
    suite,
  };
}

export function summaryViewCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;

  const suite = generateSummarySuite({
    capsulePath: run,
    writeToDisk: false,
  });

  const unified = generateUnifiedReport(run);

  return {
    markdown: suite.markdown,
    run_root: run,
    metrics: suite.metrics,
    timeline: suite.timeline,
    suite,
    unified,
    dag: unified.dag,
    doctor: unified.doctor,
    occupancy: unified.occupancy,
  };
}
