#!/usr/bin/env bun
import { resolve } from "node:path";
import { checkModularity } from "./checker.ts";
import { renderJsonReport, renderMarkdownReport } from "./reporting/index.ts";

interface Flags {
  readonly mode: "ratchet" | "strict";
  readonly source: "index" | "tree";
  readonly baselinePath?: string;
  readonly format: "json" | "markdown";
}

function parseFlags(args: readonly string[]): Flags {
  let mode: Flags["mode"] = "ratchet";
  let source: Flags["source"] = "index";
  let format: Flags["format"] = "markdown";
  let baselinePath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index + 1];
    if (args[index] === "--mode" && (value === "ratchet" || value === "strict")) mode = value;
    else if (args[index] === "--source" && (value === "index" || value === "tree")) source = value;
    else if (args[index] === "--baseline" && value) baselinePath = value;
    else if (args[index] === "--format" && (value === "json" || value === "markdown"))
      format = value;
    else throw new Error(`Invalid modularity flag: ${args[index]}`);
    index += 1;
  }
  return { mode, source, baselinePath, format };
}

try {
  const flags = parseFlags(process.argv.slice(2));
  const report = await checkModularity({ ...flags, repoRoot: resolve(".") });
  process.stdout.write(
    flags.format === "json" ? renderJsonReport(report) : renderMarkdownReport(report),
  );
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
