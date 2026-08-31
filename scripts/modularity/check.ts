#!/usr/bin/env bun
import { resolve } from "node:path";
import { checkModularity } from "./checker.ts";
import { renderJsonReport, renderMarkdownReport } from "./reporting/index.ts";

export interface Flags {
  readonly mode: "ratchet" | "strict";
  readonly source: "index" | "tree";
  readonly baselinePath?: string;
  readonly format: "json" | "markdown";
}

export function parseFlags(args: readonly string[]): Flags {
  let mode: Flags["mode"] = "ratchet";
  let source: Flags["source"] = "index";
  let format: Flags["format"] = "markdown";
  let baselinePath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index + 1];
    if (args[index] === "--mode" && (value === "ratchet" || value === "strict")) {
      mode = value;
    } else if (args[index] === "--source" && (value === "index" || value === "tree")) {
      source = value;
    } else if (args[index] === "--baseline" && typeof value === "string" && value.length > 0) {
      baselinePath = value;
    } else if (args[index] === "--format" && (value === "json" || value === "markdown")) {
      format = value;
    } else {
      throw new Error(`Invalid modularity flag: ${args[index]}`);
    }
    index += 1;
  }
  return { mode, source, baselinePath, format };
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  repoRoot: string = resolve("."),
): Promise<number> {
  try {
    const flags = parseFlags(args);
    const report = await checkModularity({ ...flags, repoRoot });
    process.stdout.write(
      flags.format === "json" ? renderJsonReport(report) : renderMarkdownReport(report),
    );
    if (!report.passed) {
      process.exitCode = 1;
      return 1;
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return 1;
  }
}

export async function runCli(
  isMain: boolean = import.meta.main,
  args?: readonly string[],
  repoRoot?: string,
): Promise<number | undefined> {
  if (isMain) {
    return await main(args, repoRoot);
  }
  return undefined;
}

await runCli();
