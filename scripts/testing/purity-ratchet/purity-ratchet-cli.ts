#!/usr/bin/env bun
import { resolve } from "node:path";
import type {
  PurityAuditPort,
  PurityRatchetFormat,
  PurityRatchetMode,
  PurityRatchetOptions,
  PurityRatchetReport,
} from "./purity-ratchet-contracts.ts";
import { checkPurityRatchet } from "./purity-ratchet-engine.ts";
import {
  renderJsonlBaseline,
  renderJsonReport,
  renderMarkdownReport,
} from "./purity-ratchet-report.ts";

export interface Flags {
  readonly mode: PurityRatchetMode;
  readonly baselinePath?: string;
  readonly format: PurityRatchetFormat;
}

export function parseFlags(args: readonly string[]): Flags {
  let mode: PurityRatchetMode = "ratchet";
  let format: PurityRatchetFormat = "markdown";
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
        throw new Error(`Invalid purity ratchet flag: ${arg}`);
      }
    } else if (arg === "--baseline") {
      if (typeof value === "string" && value.length > 0) {
        baselinePath = value;
      } else {
        throw new Error(`Invalid purity ratchet flag: ${arg}`);
      }
    } else if (arg === "--format") {
      if (value === "json") {
        format = "json";
      } else if (value === "markdown") {
        format = "markdown";
      } else if (value === "jsonl") {
        format = "jsonl";
      } else {
        throw new Error(`Invalid purity ratchet flag: ${arg}`);
      }
    } else {
      throw new Error(`Invalid purity ratchet flag: ${arg}`);
    }
    index += 1;
  }
  if (baselinePath !== undefined) {
    return { mode, baselinePath, format };
  }
  return { mode, format };
}

function render(format: PurityRatchetFormat, report: PurityRatchetReport): string {
  if (format === "json") return renderJsonReport(report);
  if (format === "jsonl") return renderJsonlBaseline(report);
  return renderMarkdownReport(report);
}

export interface PurityRatchetCliPorts {
  readonly audit?: PurityAuditPort;
}

function buildOptions(
  flags: Flags,
  repoRoot: string,
  ports: PurityRatchetCliPorts,
): PurityRatchetOptions {
  const base = { ...flags, repoRoot };
  if (ports.audit !== undefined) {
    return { ...base, audit: ports.audit };
  }
  return base;
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  repoRoot: string = resolve("."),
  ports: PurityRatchetCliPorts = {},
): Promise<number> {
  try {
    const flags = parseFlags(args);
    const report = await checkPurityRatchet(buildOptions(flags, repoRoot, ports));
    process.stdout.write(render(flags.format, report));
    if (!report.passed) {
      process.exitCode = 1;
      if (import.meta.main) {
        process.exit(1);
      }
      return 1;
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    if (import.meta.main) {
      process.exit(1);
    }
    return 1;
  }
}

export async function runCli(
  isMain: boolean = import.meta.main,
  args?: readonly string[],
  repoRoot?: string,
  ports?: PurityRatchetCliPorts,
): Promise<number | undefined> {
  if (isMain) {
    const code = await main(args, repoRoot, ports);
    if (code !== undefined && code !== 0) {
      process.exit(code);
    }
    return code;
  }
  return undefined;
}

await runCli();
