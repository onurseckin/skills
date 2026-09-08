import { describe, expect, it } from "bun:test";
import {
  auditTestPuritySync,
  findTestDirectories,
  getAllTestFiles,
  resolveAuditRequest,
  type ExtendedPurityAuditOptions,
} from "../../../scripts/testing/guardrails/purity-guard.ts";

describe("Purity Discovery Scope", () => {
  it("includes non-test fixtures and helpers under tests/ in report-only mode", () => {
    const options: ExtendedPurityAuditOptions = { reportOnly: true };
    const request = resolveAuditRequest(options);
    expect(request.files).toContain("tests/graph/audit/plan-audit-fixture.ts");
  });

  it("excludes non-test fixtures in normal audit mode", () => {
    const options: ExtendedPurityAuditOptions = { reportOnly: false };
    const request = resolveAuditRequest(options);
    expect(request.files).not.toContain("tests/graph/audit/plan-audit-fixture.ts");
  });

  it("widens getAllTestFiles discovery from test-only to all ts/tsx files", () => {
    const testOnlyFiles = getAllTestFiles("tests", false);
    const allFiles = getAllTestFiles("tests", true);
    expect(allFiles.length).toBeGreaterThan(testOnlyFiles.length);
    expect(allFiles).toContain("tests/graph/audit/plan-audit-fixture.ts");
    expect(testOnlyFiles).not.toContain("tests/graph/audit/plan-audit-fixture.ts");
  });

  it("includes chatroom test paths when resolving repository scope", () => {
    const request = resolveAuditRequest({ scope: "repository" });
    expect(request.files).toContain(
      "chatroom/scripts/tests/cli/guards/sandbox-containment-guard.test.ts",
    );
  });

  it("fails loudly when encountering an unreadable directory rather than passing with missing files", () => {
    expect(() => getAllTestFiles("package.json")).toThrow(
      "Failed to read directory 'package.json'",
    );
    expect(() => findTestDirectories("package.json")).toThrow(
      "Failed to read directory 'package.json'",
    );
    expect(() => auditTestPuritySync({ rootDir: "package.json" })).toThrow(
      "Failed to read directory 'package.json'",
    );
  });
});
