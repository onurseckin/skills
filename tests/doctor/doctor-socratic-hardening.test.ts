import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAntiMockMutation } from "../../../olt/scripts/src/reporting/doctor/anti-mock-engine.ts";
import {
  checkAstPurity,
  scanFileForAstPurity,
} from "../../../olt/scripts/src/reporting/doctor/ast-purity-engine.ts";
import { healCorruptedCursor } from "../../../olt/scripts/src/reporting/doctor/mailbox-health-engine.ts";
import { checkQuotaHealth } from "../../../olt/scripts/src/reporting/doctor/quota-health-engine.ts";
import {
  auditCompanionAuditors,
  checkCompanionAuditorsDoctor,
} from "../../../olt/scripts/src/reporting/doctor/rules/companion-auditors.ts";
import type { MailboxCursor } from "../../../olt/scripts/src/communication/types.ts";
import type { UnifiedTelemetryReport } from "../../../olt/scripts/src/telemetry/types.ts";

describe("Doctor Diagnostic Engines - Socratic Hardening Suite", () => {
  test("Challenge 1: checkAntiMockMutation inspects target files and ignores negative matchers / unequal literals", () => {
    const dummyContent = {
      "foo.test.ts": 'test("dummy", () => { expect(true).toBe(true); });',
      "clean.test.ts": `
        test("clean", () => {
          expect(true).not.toBe(false);
          expect("alpha").toBe("beta");
          expect("gamma").not.toEqual("delta");
        });
      `,
    };

    const resFiles = checkAntiMockMutation({
      fileContents: dummyContent,
      targetFiles: ["foo.test.ts"],
    });
    expect(resFiles.passed).toBe(false);
    expect(resFiles.findings.some((f) => f.code === "ANTI_MOCK_TRIVIAL_ASSERTION")).toBe(true);

    const resClean = checkAntiMockMutation({
      fileContents: { "clean.test.ts": dummyContent["clean.test.ts"] },
      targetPaths: ["clean.test.ts"],
    });
    expect(resClean.passed).toBe(true);
    expect(resClean.findings.length).toBe(0);
  });

  test("Challenge 2: healCorruptedCursor protects unacknowledged actionable envelopes even when outbox is empty", () => {
    const scratch = join(
      tmpdir(),
      `mb-cursor-starvation-empty-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    const agentDir = join(scratch, ".olt", "mailboxes", "worker-1");
    mkdirSync(agentDir, { recursive: true });

    const env1 = {
      id: "env-1",
      sequence: 1,
      sender_id: "coordinator",
      recipient_id: "worker-1",
      message_type: "TASK_ASSIGNMENT",
      timestamp: new Date().toISOString(),
      correlation_id: "corr-1",
      hmac_signature: "sig1",
      payload: { taskId: "task-1" },
    };

    // Outbox does not exist (0 requests answered)
    writeFileSync(join(agentDir, "inbox.jsonl"), `${JSON.stringify(env1)}\n`);
    writeFileSync(join(agentDir, "cursor.json"), "invalid json");

    const cursorPath = join(agentDir, "cursor.json");
    const inboxPath = join(agentDir, "inbox.jsonl");

    const success = healCorruptedCursor(cursorPath, inboxPath);
    expect(success).toBe(true);

    const parsedCursor = JSON.parse(readFileSync(cursorPath, "utf8")) as MailboxCursor;
    // Because outbox is empty and env-1 is unacknowledged, cursor sequence must NOT advance past sequence 0
    expect(parsedCursor.last_read_sequence).toBe(0);
    expect(parsedCursor.seen_ids).toEqual([]);

    rmSync(scratch, { recursive: true, force: true });
  });

  test("Challenge 3: AST purity deep assertion traversal and git rename/quotes sanitization", () => {
    const code = `
      const x = (data as Array<any>);
      const y = (record as Record<string, any>);
      // @ts-ignore
      const z = 42;
    `;

    const findings = scanFileForAstPurity("test-file.ts", code);
    const assertionFindings = findings.filter((f) => f.violationType === "ANY_TYPE_ASSERTION");
    const suppressionFindings = findings.filter(
      (f) => f.violationType === "COMPILER_SUPPRESSION_DIRECTIVE",
    );

    expect(assertionFindings.length).toBe(2);
    expect(suppressionFindings.length).toBe(1);

    const checkRes = checkAstPurity({ fileContents: { "sample.ts": code } });
    expect(checkRes.passed).toBe(false);
    expect(checkRes.findings.length).toBe(3);
  });

  test("Challenge 4: checkQuotaHealth supports extensible provider aliases and prefix matching", async () => {
    const customReport: UnifiedTelemetryReport = {
      timestamp: new Date().toISOString(),
      results: [
        {
          platformId: "custom-api",
          isDetected: true,
          metrics: [
            {
              rawMetricName: "tokens",
              remainingPercentage: 2.0,
              used: 980,
              limit: 1000,
              unit: "tokens",
            },
          ],
        },
      ],
      summary: {
        totalDetected: 1,
        totalErrors: 0,
        lowestRemainingPercentage: 2.0,
        circuitBreakerTripped: true,
      },
    };

    const customRes = await checkQuotaHealth({
      host: "custom",
      report: customReport,
      thresholdPercentage: 5.0,
    });

    expect(customRes.passed).toBe(false);
    expect(customRes.findings.some((f) => f.code === "QUOTA_CRITICAL_BREAKER_TRIPPED")).toBe(true);

    const unknownHostRes = await checkQuotaHealth({
      host: "unknown",
      report: customReport,
      thresholdPercentage: 5.0,
    });

    expect(unknownHostRes.passed).toBe(true);
    expect(unknownHostRes.findings.some((f) => f.code === "QUOTA_UNKNOWN_UNMEASURED")).toBe(true);
  });

  test("Challenge 5: Companion auditor confinement infers worker tier from standalone grant slice", () => {
    const workerGrants = [
      { id: "imp-1", role: "implementer", status: "active" },
      { id: "val-1", role: "cognitive-validator", status: "active" },
    ];

    // State is undefined, but grants slice contains only worker roles
    const findings = auditCompanionAuditors({ grants: workerGrants, state: undefined });
    expect(findings.length).toBe(0);

    const checkRes = checkCompanionAuditorsDoctor({ grants: workerGrants, state: undefined });
    expect(checkRes.passed).toBe(true);

    const mindGrants = [{ id: "mind-1", role: "mind", status: "active" }];
    const mindFindings = auditCompanionAuditors({ grants: mindGrants, state: undefined });
    expect(mindFindings.some((f) => f.code === "MISSING_MIND_AUDITOR")).toBe(true);
  });
});
