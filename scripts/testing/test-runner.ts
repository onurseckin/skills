#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { processCoverageArtifacts } from "./reporting/index.ts";
import { acquireTestLock } from "./test-mutex.ts";

export function executeTestRunner(rawArgs: string[] = process.argv.slice(2)): number {
  // Detect if broad scope or targeted
  const isCoverage = rawArgs.includes("--coverage");
  const fileTargets = rawArgs.filter((arg) => !arg.startsWith("-"));
  const isBroadScope =
    fileTargets.length === 0 || fileTargets.some((t) => t === "tests" || t === "tests/");

  const releaseLock = acquireTestLock(isBroadScope || isCoverage, rawArgs);

  try {
    const defaultFlags = ["--timeout", "30000", "--parallel", "--no-isolate"];
    const coverageFlags = isCoverage
      ? ["--coverage-reporter=lcov", "--coverage-reporter=text", "--coverage-dir=coverage"]
      : [];

    const finalArgs = ["test", ...defaultFlags, ...coverageFlags, ...rawArgs];

    const startMs = Date.now();
    const startTime = new Date(startMs).toISOString();

    const result = spawnSync("bun", finalArgs, {
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

    if (isCoverage) {
      const outputText = [result.stdout ?? "", result.stderr ?? ""].join("\n");
      const reportRes = processCoverageArtifacts(process.cwd(), "coverage", {
        testOutput: outputText,
        startTime,
        endTime,
        totalDurationMs,
      });
      if (reportRes.lcovExists) {
        console.log(
          `\n[coverage] Generated coverage/lcov.info, coverage/coverage-summary.json, coverage/REPORT.md, and coverage/index.html across ${reportRes.filesCount} files (${reportRes.totalPct}% line coverage).`,
        );
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
