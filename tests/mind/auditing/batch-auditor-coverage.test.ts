import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditDynamicRoles,
  runAutonomousMindRoleAudit,
  formatRoleAuditMarkdown,
  renderRoleAuditAsciiTable,
  formatNonDuplicatePersonaSummary,
} from "../../../olt/scripts/src/mind/auditing/roles/batch-auditor.ts";
import type {
  DynamicRoleContract,
  DynamicRoleSpec,
} from "../../../olt/scripts/src/mind/roles/dynamic/types.ts";
import type { RoleAuditReport } from "../../../olt/scripts/src/mind/auditing/roles/types.ts";

describe("Mind Role Batch Auditor Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "batch-auditor-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  const createSpec = (name: string, overrides: Partial<DynamicRoleSpec> = {}): DynamicRoleSpec => ({
    name,
    tier: 3,
    archetype: "tier_3_implementer",
    domain: "testing",
    intent: "Unit testing role",
    parentRole: "coordinator",
    grantedCommands: ["read_file"],
    prohibitedCommands: ["orchestrator:run"],
    invariants: ["do_not_break"],
    cognitivePillars: ["verification"],
    permittedActivities: ["test_execution"],
    writeScopePolicy: "lease_bounded",
    ...overrides,
  });

  it("handles empty array, valid array, and flags structural defects in contracts", () => {
    const emptyReport = auditDynamicRoles([]);
    expect(emptyReport.valid).toBe(true);
    expect(emptyReport.summary.totalRolesAudited).toBe(0);
    expect(emptyReport.markdownReport).toContain("✅ VALID");

    const validReport = auditDynamicRoles([createSpec("a"), createSpec("b", { domain: "d2" })]);
    expect(validReport.valid).toBe(true);
    expect(validReport.summary.passedRolesCount).toBe(2);

    const invalidSpec = createSpec("bad-sup", {
      tier: 2,
      spawns: ["orchestrator"],
      grantedCommands: ["orchestrator:run", "task:claim"],
    });
    const contract: DynamicRoleContract = {
      role: "bad-sup",
      tier: 2,
      spec: invalidSpec,
      signature: {
        role: "bad-sup",
        tier: 2,
        archetype: "tier_2_coordinator",
        commandsSignature: "",
        writeScopePolicy: "lease_bounded",
        invariantsHash: "0000",
        signatureHash: "1111",
      },
    };
    const report = auditDynamicRoles([contract]);
    expect(report.valid).toBe(false);
    expect(report.summary.criticalFindingsCount).toBeGreaterThan(0);
    expect(report.summary.highFindingsCount).toBeGreaterThan(0);
    expect(report.findings.some((f) => f.id.includes("FIND-HIER-SPAWN2"))).toBe(true);
  });

  it("accepts registry objects, directory options, and falls back to global registry", () => {
    const spec = createSpec("reg-role");
    const contract: DynamicRoleContract = {
      role: "reg-role",
      tier: 3,
      spec,
      signature: {
        role: "reg-role",
        tier: 3,
        archetype: "tier_3_implementer",
        commandsSignature: "",
        writeScopePolicy: "lease_bounded",
        invariantsHash: "0",
        signatureHash: "1",
      },
    };
    const registryReport = auditDynamicRoles({ list: () => [contract] });
    expect(registryReport.summary.totalRolesAudited).toBe(1);

    const roleMd = `---\nrole: file-role\ntier: 3\narchetype: tier_3_implementer\n---\n# Doc\n`;
    writeFileSync(join(tempDir, "file-role.md"), roleMd, "utf-8");
    writeFileSync(join(tempDir, "ignore.txt"), "text", "utf-8");
    const dirReport = auditDynamicRoles({ rolesDir: tempDir });
    expect(dirReport.rolesDir).toBe(tempDir);

    const missingReport = auditDynamicRoles({ rolesDir: join(tempDir, "missing") });
    expect(missingReport.summary.totalRolesAudited).toBe(0);

    const globalReport = auditDynamicRoles();
    expect(typeof globalReport.auditedAt).toBe("string");
  });

  it("detects duplicate persona clusters and ignores dissimilar personas", () => {
    const roleA = createSpec("clone-alpha", {
      tier: 3,
      archetype: "tier_3_implementer",
      domain: "dup",
      grantedCommands: ["read_file"],
    });
    const roleB = createSpec("clone-beta", {
      tier: 3,
      archetype: "tier_3_implementer",
      domain: "dup",
      grantedCommands: ["read_file"],
    });
    const dupReport = auditDynamicRoles([roleA, roleB]);
    expect(dupReport.duplicatePairs.length).toBeGreaterThanOrEqual(1);
    expect(dupReport.summary.duplicateClustersCount).toBeGreaterThanOrEqual(1);
    expect(dupReport.findings.some((f) => f.category === "duplicate_persona")).toBe(true);

    const roleC = createSpec("worker-ui", {
      tier: 3,
      archetype: "tier_3_validator",
      domain: "frontend",
      writeScopePolicy: "read_only",
    });
    const cleanReport = auditDynamicRoles([roleA, roleC]);
    expect(cleanReport.duplicatePairs).toHaveLength(0);
  });

  it("verifies runAutonomousMindRoleAudit and formatRoleAuditMarkdown", () => {
    const spec = createSpec("auto-audited");
    const autoReport = runAutonomousMindRoleAudit([spec]);
    expect(autoReport.summary.totalRolesAudited).toBe(1);

    const validMd = formatRoleAuditMarkdown(autoReport);
    expect(validMd).toContain("✅ VALID");
    expect(validMd).not.toContain("### Findings");

    const failedReport: RoleAuditReport = {
      ...autoReport,
      valid: false,
      summary: { ...autoReport.summary, criticalFindings: 1, overallPassed: false },
      findings: [
        {
          id: "FIND-1",
          roleName: "bad",
          tier: 3,
          category: "command_authorization",
          severity: "CRITICAL",
          title: "Fail",
          description: "Err",
          recommendation: "Fix",
        },
      ],
    };
    const failMd = formatRoleAuditMarkdown(failedReport);
    expect(failMd).toContain("❌ DEFECTS DETECTED");
    expect(failMd).toContain("- **[CRITICAL] Fail** (bad): Err");
  });

  it("renders ASCII table and formats non-duplicate persona summaries", () => {
    const emptyReport = auditDynamicRoles([]);
    expect(renderRoleAuditAsciiTable(emptyReport)).toBe("(no dynamic roles evaluated)");

    const populatedReport = auditDynamicRoles([createSpec("spec-1")]);
    const table = renderRoleAuditAsciiTable(populatedReport);
    expect(table).toContain("| ROLE | TIER | ARCHETYPE | STATUS |");

    expect(
      formatNonDuplicatePersonaSummary({ contract: { role: "synthed" }, action: "create" }),
    ).toBe("### Non-Duplicate Persona Synthesis: `synthed` (create)");
    expect(
      formatNonDuplicatePersonaSummary({ contract: { name: "named-only" }, action: "update" }),
    ).toBe("### Non-Duplicate Persona Synthesis: `named-only` (update)");
    expect(formatNonDuplicatePersonaSummary({ contract: undefined, action: "none" })).toBe(
      "### Non-Duplicate Persona Synthesis: `undefined` (none)",
    );
  });
});
