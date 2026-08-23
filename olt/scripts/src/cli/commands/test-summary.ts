/**
 * CLI Command Handler for test:summary.
 *
 * Formats and outputs the latest test execution summary metadata for human inspection
 * and JSON machine-readable integration. Supports manual summary injection and querying.
 */

import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import {
  createTestSummaryRecord,
  formatTestSummaryMarkdown,
  getLatestTestSummary,
  saveTestSummary,
  type TestSummaryRecord,
} from "../../testing/concurrency-lock.ts";

export async function testSummaryCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const runDir = textFlag(flags, "run", false);
  const scopeFlag = textFlag(flags, "scope", false);
  const passedFlag = integerFlag(flags, "passed");
  const failedFlag = integerFlag(flags, "failed");
  const skippedFlag = integerFlag(flags, "skipped");
  const durationFlag = integerFlag(flags, "duration");
  const coverageFlag = textFlag(flags, "coverage", false);
  const commitFlag = textFlag(flags, "commit", false);
  const filesFlag = integerFlag(flags, "files");
  const agentFlag = textFlag(flags, "agent", false);
  const isJson = boolFlag(flags, "json");

  // If passed & failed flags are provided, save a new summary record
  if (passedFlag !== undefined && failedFlag !== undefined) {
    const coverageNum =
      coverageFlag !== undefined
        ? Number(coverageFlag) > 1
          ? Number(coverageFlag)
          : Number(coverageFlag) * 100
        : null;

    const summaryRecord = createTestSummaryRecord({
      passed_count: passedFlag,
      failed_count: failedFlag,
      skipped_count: skippedFlag ?? 0,
      duration_ms: durationFlag ?? 0,
      coverage_percentage: coverageNum,
      commit_sha: commitFlag ?? null,
      test_files_count: filesFlag ?? 1,
      scope: scopeFlag ?? "full",
      agent_id: agentFlag,
    });

    const savedPath = await saveTestSummary(summaryRecord, { runDir });
    const markdown = formatTestSummaryMarkdown(summaryRecord);

    return {
      markdown,
      saved: true,
      saved_path: savedPath,
      summary: summaryRecord,
      timestamp_utc: summaryRecord.timestamp_utc,
      timestamp_local: summaryRecord.timestamp_local,
      passed_count: summaryRecord.passed_count,
      failed_count: summaryRecord.failed_count,
      skipped_count: summaryRecord.skipped_count,
      duration_ms: summaryRecord.duration_ms,
      coverage_percentage: summaryRecord.coverage_percentage,
      commit_sha: summaryRecord.commit_sha,
      test_files_count: summaryRecord.test_files_count,
      scope: summaryRecord.scope,
    };
  }

  // Otherwise, query and return the latest test summary
  const summary = await getLatestTestSummary({ runDir });

  if (!summary) {
    const markdown = [
      "### Test Execution Summary",
      "- **Status**: ⚠️ No test summary records found.",
      "- **Advice**: Run tests or execute `test:summary --passed <N> --failed <N>` to record execution metadata.",
    ].join("\n");

    return {
      markdown,
      found: false,
      summary: null,
    };
  }

  const markdown = formatTestSummaryMarkdown(summary);

  return {
    markdown,
    found: true,
    summary,
    timestamp_utc: summary.timestamp_utc,
    timestamp_local: summary.timestamp_local,
    passed_count: summary.passed_count,
    failed_count: summary.failed_count,
    skipped_count: summary.skipped_count,
    duration_ms: summary.duration_ms,
    coverage_percentage: summary.coverage_percentage,
    commit_sha: summary.commit_sha,
    test_files_count: summary.test_files_count,
    scope: summary.scope,
  };
}
