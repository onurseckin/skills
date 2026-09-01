#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import {
  evaluateCoverageGate,
  formatCoverageGateMessage,
  processCoverageArtifacts,
} from "./reporting/index.ts";
import { acquireTestLock } from "./mutex/index.ts";
import { executeStreamingRunner, parseRunnerArgs } from "./runner/index.ts";

export { executeStreamingRunner };

export function executeTestRunner(rawArgs: string[] = process.argv.slice(2)): number {
  const parsed = parseRunnerArgs(rawArgs);
  const releaseLock = acquireTestLock(parsed.isBroadScope || parsed.isCoverage, rawArgs);

  try {
    const startMs = Date.now();
    const startTime = new Date(startMs).toISOString();

    const result = spawnSync("bun", parsed.bunTestArgs, {
      stdio: "pipe",
      encoding: "utf-8",
      maxBuffer: 100 * 1024 * 1024,
      env: {
        ...process.env,
        OLT_VIRTUAL_FS: "1",
        BUN_ENV: "test",
      },
    });

    const endMs = Date.now();
    const endTime = new Date(endMs).toISOString();
    const totalDurationMs = Math.max(0, endMs - startMs);

    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }

    if (parsed.isCoverage) {
      const outputText = [result.stdout ?? "", result.stderr ?? ""].join("\n");
      const reportRes = processCoverageArtifacts(process.cwd(), parsed.coverageDir ?? "coverage", {
        testOutput: outputText,
        startTime,
        endTime,
        totalDurationMs,
      });
      if (reportRes.lcovExists && reportRes.summary) {
        const gateResult = evaluateCoverageGate(reportRes.summary);
        const message = formatCoverageGateMessage(gateResult);
        if (gateResult.passed) {
          console.log(
            `\n[coverage] Generated coverage/lcov.info, coverage/coverage-summary.json, coverage/REPORT.md, and coverage/index.html across ${reportRes.filesCount} files (${reportRes.totalPct}% line coverage).\n${message}`,
          );
        } else {
          console.error(
            `\n[coverage] Generated coverage artifacts across ${reportRes.filesCount} files (${reportRes.totalPct}% line coverage).\n${message}`,
          );
          if ((result.status ?? 0) === 0) {
            return 1;
          }
        }
      }
    }

    return result.status ?? 0;
  } finally {
    releaseLock();
  }
}

export function computeIsMain(
  mainVal: boolean = import.meta.main,
  entryArg: string | undefined = process.argv[1],
): boolean {
  if (mainVal) return true;
  if (!entryArg) return false;
  return (
    entryArg.endsWith("scripts/testing/test-runner.ts") ||
    entryArg.endsWith("scripts/testing/test-runner")
  );
}

export function main(): void {
  const code = executeTestRunner();
  process.exit(code);
}

if (computeIsMain()) {
  main();
}
