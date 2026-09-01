import { spawn } from "node:child_process";
import {
  evaluateCoverageGate,
  formatCoverageGateMessage,
  processCoverageArtifacts,
  type CoverageArtifactResult,
} from "../reporting/index.ts";
import { acquireTestLock } from "../test-mutex.ts";
import { buildBunTestArgs, parseRunnerArgs } from "./arg-parser.ts";
import { StreamParser } from "./stream-parser.ts";
import { formatSummaryTable } from "./summary-table.ts";
import { isInteractiveTerminal, TerminalTicker } from "./terminal-ticker.ts";
import type { RunnerOptions, RunnerResult } from "./types.ts";

export async function executeStreamingRunner(
  rawArgs: string[] = process.argv.slice(2),
  options: Partial<RunnerOptions> = {},
): Promise<RunnerResult> {
  const parsed = parseRunnerArgs(rawArgs);
  const isCoverage = options.coverage !== undefined ? options.coverage : parsed.isCoverage;
  const timeoutMs = options.timeout ?? options.timeoutMs ?? parsed.timeoutMs;
  const parallel = options.parallel !== undefined ? options.parallel : parsed.parallel;

  const effectiveParsed = {
    ...parsed,
    isCoverage,
    timeoutMs,
    parallel,
    coverageDir: options.coverageDir ?? parsed.coverageDir,
    coverageReporters: options.coverageReporters ?? parsed.coverageReporters,
    maxConcurrency: options.maxConcurrency ?? parsed.maxConcurrency,
  };

  const finalArgs = buildBunTestArgs(effectiveParsed);
  const releaseLock = acquireTestLock(effectiveParsed.isBroadScope || isCoverage, rawArgs);

  const startMs = Date.now();
  const startTime = new Date(startMs).toISOString();

  const parser = new StreamParser();
  const ticker = new TerminalTicker({
    interactive: options.interactive,
    updateCadenceMs: options.updateCadenceMs ?? 50,
    stdout: options.stdout ?? process.stdout,
  });

  let rawStdout = "";
  let rawStderr = "";

  try {
    parser.on((event) => {
      ticker.onStreamEvent(event, parser.getStats());
    });

    ticker.start();

    const child = spawn("bun", finalArgs, {
      cwd: options.cwd ?? process.cwd(),
      stdio: ["inherit", "pipe", "pipe"],
      env: {
        ...process.env,
        OLT_VIRTUAL_FS: "1",
        BUN_ENV: "test",
        ...options.env,
      },
    });

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer | string) => {
        const str = typeof chunk === "string" ? chunk : chunk.toString();
        rawStdout += str;
        parser.feed(chunk, "stdout");
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer | string) => {
        const str = typeof chunk === "string" ? chunk : chunk.toString();
        rawStderr += str;
        parser.feed(chunk, "stderr");
      });
    }

    let exitCode = await new Promise<number>((resolve, reject) => {
      child.on("error", (err) => {
        reject(err);
      });
      child.on("close", (code) => {
        resolve(code ?? 0);
      });
    });

    parser.flush();
    ticker.stop();

    const endMs = Date.now();
    const endTime = new Date(endMs).toISOString();
    const totalDurationMs = Math.max(0, endMs - startMs);

    let coverageResult: CoverageArtifactResult | undefined;
    if (isCoverage) {
      const outputText = [rawStdout, rawStderr].join("\n");
      coverageResult = processCoverageArtifacts(
        options.cwd ?? process.cwd(),
        effectiveParsed.coverageDir ?? "coverage",
        {
          testOutput: outputText,
          startTime,
          endTime,
          totalDurationMs,
        },
      );
      if (coverageResult.lcovExists && coverageResult.summary) {
        const gateResult = evaluateCoverageGate(coverageResult.summary);
        const message = formatCoverageGateMessage(gateResult);
        if (gateResult.passed) {
          console.log(
            `\n[coverage] Generated coverage/lcov.info, coverage/coverage-summary.json, coverage/REPORT.md, and coverage/index.html across ${coverageResult.filesCount} files (${coverageResult.totalPct}% line coverage).\n${message}`,
          );
        } else {
          console.error(
            `\n[coverage] Generated coverage artifacts across ${coverageResult.filesCount} files (${coverageResult.totalPct}% line coverage).\n${message}`,
          );
          if (exitCode === 0) {
            exitCode = 1;
          }
        }
      }
    }

    const stats = parser.getStats();
    if (stats.durationMs === 0) {
      stats.durationMs = totalDurationMs;
    }

    const summary = formatSummaryTable({
      stats,
      durationMs: totalDurationMs,
      coverageResult,
      useColor: isInteractiveTerminal({ interactive: options.interactive }),
    });

    const outStream = options.stdout ?? process.stdout;
    outStream.write(summary + "\n");

    return {
      exitCode,
      stats,
      rawOutput: [rawStdout, rawStderr].join("\n"),
      coverageResult,
      durationMs: totalDurationMs,
    };
  } finally {
    ticker.stop();
    releaseLock();
  }
}
