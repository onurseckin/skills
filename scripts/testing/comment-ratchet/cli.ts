#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type {
  CommentAuditPort,
  CommentRatchetFormat,
  CommentRatchetMode,
  CommentRatchetReport,
  Flags,
} from "./contracts.ts";
import { checkCommentRatchet } from "./engine.ts";
import { renderJsonlBaseline, renderJsonReport, renderMarkdownReport } from "./report.ts";

export function parseFlags(args: readonly string[]): Flags {
  let mode: CommentRatchetMode = "ratchet";
  let format: CommentRatchetFormat = "markdown";
  let baselinePath: string | undefined;
  let staged = false;
  const files: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;

    if (arg === "--mode") {
      const next = args[index + 1];
      if (next === "ratchet" || next === "strict" || next === "check") {
        mode = next;
        index += 1;
      } else {
        throw new Error(`Invalid comment ratchet flag value for --mode: ${String(next)}`);
      }
    } else if (arg.startsWith("--mode=")) {
      const val = arg.slice("--mode=".length);
      if (val === "ratchet" || val === "strict" || val === "check") {
        mode = val;
      } else {
        throw new Error(`Invalid comment ratchet flag value for --mode: ${val}`);
      }
    } else if (arg === "--format") {
      const next = args[index + 1];
      if (next === "markdown" || next === "json" || next === "jsonl") {
        format = next;
        index += 1;
      } else {
        throw new Error(`Invalid comment ratchet flag value for --format: ${String(next)}`);
      }
    } else if (arg.startsWith("--format=")) {
      const val = arg.slice("--format=".length);
      if (val === "markdown" || val === "json" || val === "jsonl") {
        format = val;
      } else {
        throw new Error(`Invalid comment ratchet flag value for --format: ${val}`);
      }
    } else if (arg === "--baseline") {
      const next = args[index + 1];
      if (typeof next === "string" && next.length > 0) {
        baselinePath = next;
        index += 1;
      } else {
        throw new Error("Missing value for --baseline flag");
      }
    } else if (arg.startsWith("--baseline=")) {
      const val = arg.slice("--baseline=".length);
      if (val.length > 0) {
        baselinePath = val;
      } else {
        throw new Error("Missing value for --baseline flag");
      }
    } else if (arg === "--staged") {
      staged = true;
    } else if (arg === "--files") {
      const next = args[index + 1];
      if (typeof next === "string" && next.length > 0) {
        files.push(
          ...next
            .split(",")
            .map((f) => f.trim())
            .filter((f) => f.length > 0),
        );
        index += 1;
      } else {
        throw new Error("Missing value for --files flag");
      }
    } else if (arg.startsWith("--files=")) {
      const val = arg.slice("--files=".length);
      files.push(
        ...val
          .split(",")
          .map((f) => f.trim())
          .filter((f) => f.length > 0),
      );
    } else if (arg.startsWith("-")) {
      throw new Error(`Invalid comment ratchet flag: ${arg}`);
    } else {
      files.push(arg);
    }
  }

  return {
    mode,
    format,
    ...(baselinePath !== undefined ? { baselinePath } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(staged ? { staged: true } : {}),
  };
}

export function getStagedFiles(): readonly string[] {
  try {
    const res = spawnSync("git", ["diff", "--cached", "--name-only"], { encoding: "utf-8" });
    const pattern = /\.(ts|tsx|mts|cts)$/;
    return (res.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((file) => pattern.test(file) && file.length > 0);
  } catch {
    return [];
  }
}

function render(format: CommentRatchetFormat, report: CommentRatchetReport): string {
  if (format === "json") return renderJsonReport(report);
  if (format === "jsonl") return renderJsonlBaseline(report);
  return renderMarkdownReport(report);
}

export interface CommentRatchetCliPorts {
  readonly audit?: CommentAuditPort;
  readonly fileLoader?: (filePath: string) => Promise<string> | string;
  readonly fileListLoader?: () => Promise<readonly string[]> | readonly string[];
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  repoRoot: string = resolve("."),
  ports: CommentRatchetCliPorts = {},
): Promise<number> {
  try {
    const flags = parseFlags(args);
    let targetFiles: readonly string[] | undefined = flags.files;
    if (flags.staged) {
      targetFiles = getStagedFiles();
    }

    const report = await checkCommentRatchet({
      repoRoot,
      mode: flags.mode,
      baselinePath: flags.baselinePath,
      targetFiles,
      audit: ports.audit,
      fileLoader: ports.fileLoader,
      fileListLoader: ports.fileListLoader,
    });

    process.stdout.write(render(flags.format, report));

    if (!report.passed) {
      if (import.meta.main) {
        process.exitCode = 1;
        process.exit(1);
      }
      return 1;
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    if (import.meta.main) {
      process.exitCode = 1;
      process.exit(1);
    }
    return 1;
  }
}

export async function runCli(
  isMain: boolean = import.meta.main,
  args?: readonly string[],
  repoRoot?: string,
  ports?: CommentRatchetCliPorts,
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
