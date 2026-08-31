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
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--mode") {
      if (value === "ratchet") {
        mode = "ratchet";
      } else if (value === "strict") {
        mode = "strict";
      } else {
        throw new Error(`Invalid modularity flag: ${arg}`);
      }
    } else if (arg === "--source") {
      if (value === "index") {
        source = "index";
      } else if (value === "tree") {
        source = "tree";
      } else {
        throw new Error(`Invalid modularity flag: ${arg}`);
      }
    } else if (arg === "--baseline") {
      if (typeof value === "string" && value.length > 0) {
        baselinePath = value;
      } else {
        throw new Error(`Invalid modularity flag: ${arg}`);
      }
    } else if (arg === "--format") {
      if (value === "json") {
        format = "json";
      } else if (value === "markdown") {
        format = "markdown";
      } else {
        throw new Error(`Invalid modularity flag: ${arg}`);
      }
    } else {
      throw new Error(`Invalid modularity flag: ${arg}`);
    }
    index += 1;
  }
  if (baselinePath !== undefined) {
    return { mode, source, baselinePath, format };
  }
  return { mode, source, format };
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
