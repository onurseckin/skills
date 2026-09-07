#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import {
  evaluateCoverageGate,
  formatCoverageGateMessage,
  processCoverageArtifacts,
} from "./reporting/index.ts";
import { acquireTestLock } from "./mutex/index.ts";
import {
  detectSuiteLoadFailures,
  executeStreamingRunner,
  formatSuiteLoadFailureReport,
  parseRunnerArgs,
} from "./runner/index.ts";
import { auditTestPuritySync } from "./guardrails/index.ts";
import type { PurityAuditOptions, PurityAuditResult } from "./guardrails/index.ts";
import { inspectRepoPolicy, isTestingEnabled } from "../../olt/scripts/src/policy/index.ts";

export { executeStreamingRunner };

export interface TestRunnerPorts {
  readonly auditTestPuritySync?: (options: PurityAuditOptions) => PurityAuditResult;
}

export function executeTestRunner(
  rawArgs: string[] = process.argv.slice(2),
  ports: TestRunnerPorts = {},
): number {
  try {
    const inspection = inspectRepoPolicy();
    if (!isTestingEnabled(inspection.policy)) {
      console.log(
        "[test] Unit testing is disabled in repository policy (.olt/policy.json); skipping test suite.",
      );
      return 0;
    }
  } catch {}
  const parsed = parseRunnerArgs(rawArgs);
  const isLockRequired = parsed.isBroadScope ? true : parsed.isCoverage;
  const releaseLock = acquireTestLock(isLockRequired, rawArgs);

  try {
    if ((parsed.isBroadScope || parsed.isCoverage) && process.env.OLT_SKIP_PURITY !== "1") {
      const auditPurity = ports.auditTestPuritySync ?? auditTestPuritySync;
      const purityResult = auditPurity({ all: true });
      if (!purityResult.passed) {
        console.error(purityResult.terminalReport);
        console.error("\n❌ [purity-guard] Whole repository test suite failed purity audit.");
        return 1;
      }
      console.log(purityResult.terminalReport);
    }
    const startMs = Date.now();
    const startTime = new Date(startMs).toISOString();

    const result = spawnSync("bun", parsed.bunTestArgs, {
      stdio: ["inherit", "inherit", "pipe"],
      encoding: "utf-8",
      maxBuffer: 100 * 1024 * 1024,
      env: {
        ...process.env,
        OLT_VIRTUAL_FS: "1",
        BUN_ENV: "test",
      },
    });

    const childStderr = typeof result.stderr === "string" ? result.stderr : "";
    if (childStderr.length > 0) {
      process.stderr.write(childStderr);
    }
    const loadFailures = detectSuiteLoadFailures(childStderr);

    const endMs = Date.now();
    const endTime = new Date(endMs).toISOString();
    const totalDurationMs = Math.max(0, endMs - startMs);

    let exitCode = result.status !== undefined && result.status !== null ? result.status : 0;

    if (parsed.isCoverage) {
      const targetCovDir =
        parsed.coverageDir !== undefined && parsed.coverageDir !== null
          ? parsed.coverageDir
          : "coverage";
      const reportRes = processCoverageArtifacts(process.cwd(), targetCovDir, {
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
          exitCode = 0;
        } else {
          console.error(
            `\n[coverage] Generated coverage artifacts across ${reportRes.filesCount} files (${reportRes.totalPct}% line coverage).\n${message}`,
          );
          exitCode = 1;
        }
      }
    }

    if (loadFailures.length > 0) {
      console.error(formatSuiteLoadFailureReport(loadFailures));
      if (exitCode === 0) {
        exitCode = 1;
      }
    }

    return exitCode;
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
  if (entryArg.endsWith("scripts/testing/test-runner.ts")) {
    return true;
  }
  if (entryArg.endsWith("scripts/testing/test-runner")) {
    return true;
  }
  return false;
}

export function main(ports: TestRunnerPorts = {}): void {
  const code = executeTestRunner(process.argv.slice(2), ports);
  process.exit(code);
}

if (computeIsMain()) {
  main();
}
