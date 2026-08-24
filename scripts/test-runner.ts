#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { processCoverageArtifacts } from "./coverage-generator.ts";
import { acquireTestLock } from "./test-mutex.ts";

const rawArgs = process.argv.slice(2);

// Detect if broad scope or targeted
const isCoverage = rawArgs.includes("--coverage");
const fileTargets = rawArgs.filter((arg) => !arg.startsWith("-"));
const isBroadScope =
  fileTargets.length === 0 ||
  fileTargets.some(
    (t) => t === "tests" || t === "tests/unit" || t === "tests/" || t === "tests/unit/",
  );

const releaseLock = acquireTestLock(isBroadScope || isCoverage, rawArgs);

try {
  const defaultFlags = ["--timeout", "30000", "--parallel", "--no-isolate"];
  const coverageFlags = isCoverage
    ? ["--coverage-reporter=lcov", "--coverage-reporter=text", "--coverage-dir=coverage"]
    : [];

  const finalArgs = ["test", ...defaultFlags, ...coverageFlags, ...rawArgs];

  const result = spawnSync("bun", finalArgs, {
    stdio: "inherit",
    env: process.env,
  });

  if (isCoverage) {
    const reportRes = processCoverageArtifacts();
    if (reportRes.lcovExists) {
      console.log(
        `\n[coverage] Generated coverage/lcov.info, coverage/coverage-summary.json and coverage/REPORT.md across ${reportRes.filesCount} files (${reportRes.totalPct}% line coverage).`,
      );
    }
  }

  process.exit(result.status ?? 0);
} finally {
  releaseLock();
}
