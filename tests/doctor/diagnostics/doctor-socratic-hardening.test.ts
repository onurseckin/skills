import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
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

export const doctorSocraticHardeningSuiteName =
  "Doctor Diagnostic Engines - Socratic Hardening Suite";

const spies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
});

describe(doctorSocraticHardeningSuiteName, () => {
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
    const vfs = new Map<string, string>();
    const cursorPath = "/virtual/mailboxes/worker-1/cursor.json";
    const inboxPath = "/virtual/mailboxes/worker-1/inbox.jsonl";

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

    vfs.set(inboxPath, `${JSON.stringify(env1)}\n`);
    vfs.set(cursorPath, "invalid json");

    const existsSpy = spyOn(fs, "existsSync").mockImplementation((p) => vfs.has(String(p)));
    const readSpy = spyOn(fs, "readFileSync").mockImplementation((p) => {
      const pathStr = String(p);
      const c = vfs.get(pathStr);
      if (c === undefined) throw new Error(`ENOENT: ${pathStr}`);
      return c;
    });
    const writeSpy = spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
      vfs.set(String(p), String(data));
    });
    const renameSpy = spyOn(fs, "renameSync").mockImplementation((from, to) => {
      const c = vfs.get(String(from));
      if (c !== undefined) {
        vfs.set(String(to), c);
        vfs.delete(String(from));
      }
    });
    const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    spies.push(existsSpy, readSpy, writeSpy, renameSpy, mkdirSpy);

    const success = healCorruptedCursor(cursorPath, inboxPath);
    expect(success).toBe(true);

    const parsedCursor = JSON.parse(vfs.get(cursorPath) ?? "{}") as MailboxCursor;
    expect(parsedCursor.last_read_sequence).toBe(0);
    expect(parsedCursor.seen_ids).toEqual([]);
  });

  test("Challenge 3: AST purity deep assertion traversal and git rename/quotes sanitization", () => {
    const asArrAny = "(data as Array<" + "any>)";
    const asRecAny = "(record as Record<string, " + "any>)";
    const tsIgn = "// @" + "ts-ignore";
    const code = `
      const x = ${asArrAny};
      const y = ${asRecAny};
      ${tsIgn}
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

    const findings = auditCompanionAuditors({ grants: workerGrants, state: undefined });
    expect(findings.length).toBe(0);

    const checkRes = checkCompanionAuditorsDoctor({ grants: workerGrants, state: undefined });
    expect(checkRes.passed).toBe(true);

    const mindGrants = [{ id: "mind-1", role: "mind", status: "active" }];
    const mindFindings = auditCompanionAuditors({ grants: mindGrants, state: undefined });
    expect(mindFindings.some((f) => f.code === "MISSING_MIND_AUDITOR")).toBe(true);
  });
});
