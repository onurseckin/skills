import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertValidCliWatchdogImports,
  auditCliCommandsForSchedulerImports,
  auditSupervisory5PointHealth,
  CANONICAL_SCHEDULER_BARREL_PATH,
  CANONICAL_SCHEDULER_BARREL_SPECIFIER_FROM_CLI,
  CANONICAL_SCHEDULER_CORE_BARREL_PATH,
  CANONICAL_SCHEDULER_CORE_SPECIFIER_FROM_CLI,
  CANONICAL_WATCHDOG_OPS_PATH,
  CANONICAL_WATCHDOG_SUPERVISORY_SYMBOLS,
  classifySchedulerImport,
  CliSchedulerImportError,
  CliWatchdogOpsImportError,
  createCliWatchdogDefectEntry,
  createCliWatchdogDefectProof,
  createSchedulerEngine,
  DEFECT_REF,
  determineTopLeader,
  dispatchSupervisoryHealthProbe,
  ERROR_CODE,
  extractImportEntries,
  extractModuleImports,
  formatSupervisoryHealthMarkdown,
  INVARIANT_DESCRIPTION,
  INVARIANT_NUMBER,
  INVARIANT_REF,
  isCanonicalSchedulerImport,
  isLegacyCoreEngineImport,
  LEGACY_CORE_ENGINE_PATTERNS,
  LEGACY_CORE_ENGINE_SPECIFIER,
  remediateCliWatchdogImports,
  remediateCliWatchdogImportsWithReport,
  resolveSchedulerImportPath,
  SchedulerEngine,
  UNRESOLVED_MODULE_IMPORT_IN_CLI,
  UnresolvedCoreEngineImportError,
  validateCliWatchdogImports,
  verifyLiveWatchdogOpsIntegrity,
} from "../../../olt/scripts/src/tooling/defect-cli-watchdog-ops-unresolved-core-engine-import.ts";

const tempDirs: string[] = [];

function createTempDir(prefix = "cli-watchdog-test-"): string {
  const dir = join(tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
  tempDirs.length = 0;
});

describe("Task 1.1: Defect Remediation - Unresolved core-engine.ts import in cli/commands/watchdog-ops.ts", () => {
  describe("1. Defect Metadata, Constants & Canonical Path Contracts", () => {
    test("defect identifiers and error codes match architectural specifications", () => {
      expect(DEFECT_REF).toBe("defect-cli-watchdog-ops-unresolved-core-engine-import");
      expect(ERROR_CODE).toBe("UNRESOLVED_MODULE_IMPORT_IN_CLI");
      expect(UNRESOLVED_MODULE_IMPORT_IN_CLI).toBe("UNRESOLVED_MODULE_IMPORT_IN_CLI");
      expect(INVARIANT_NUMBER).toBe(1);
      expect(INVARIANT_REF).toBe("Invariant 1.1");
      expect(INVARIANT_DESCRIPTION).toContain("watchdog-ops.ts");
    });

    test("canonical paths and specifiers are accurately declared", () => {
      expect(CANONICAL_WATCHDOG_OPS_PATH).toBe("olt/scripts/src/cli/commands/watchdog-ops.ts");
      expect(CANONICAL_SCHEDULER_BARREL_PATH).toBe("olt/scripts/src/engine/scheduler/index.ts");
      expect(CANONICAL_SCHEDULER_CORE_BARREL_PATH).toBe(
        "olt/scripts/src/engine/scheduler/core/index.ts",
      );
      expect(CANONICAL_SCHEDULER_BARREL_SPECIFIER_FROM_CLI).toBe(
        "../../engine/scheduler/index.ts",
      );
      expect(CANONICAL_SCHEDULER_CORE_SPECIFIER_FROM_CLI).toBe(
        "../../engine/scheduler/core/index.ts",
      );
      expect(LEGACY_CORE_ENGINE_SPECIFIER).toBe("../../engine/scheduler/core-engine.ts");
    });

    test("frozen catalog of legacy patterns and supervisory symbols are non-empty", () => {
      expect(Object.isFrozen(LEGACY_CORE_ENGINE_PATTERNS)).toBe(true);
      expect(LEGACY_CORE_ENGINE_PATTERNS).toContain("../../engine/scheduler/core-engine.ts");
      expect(LEGACY_CORE_ENGINE_PATTERNS).toContain("./core-engine.ts");
      expect(LEGACY_CORE_ENGINE_PATTERNS).toContain("engine/scheduler/core-engine.ts");

      expect(Object.isFrozen(CANONICAL_WATCHDOG_SUPERVISORY_SYMBOLS)).toBe(true);
      expect(CANONICAL_WATCHDOG_SUPERVISORY_SYMBOLS).toContain("auditSupervisory5PointHealth");
      expect(CANONICAL_WATCHDOG_SUPERVISORY_SYMBOLS).toContain("dispatchSupervisoryHealthProbe");
      expect(CANONICAL_WATCHDOG_SUPERVISORY_SYMBOLS).toContain("Supervisory5PointHealthReport");
      expect(CANONICAL_WATCHDOG_SUPERVISORY_SYMBOLS).toContain("determineTopLeader");
      expect(CANONICAL_WATCHDOG_SUPERVISORY_SYMBOLS).toContain("SchedulerEngine");
    });
  });

  describe("2. Custom Error Classes & Error Invariants", () => {
    test("CliWatchdogOpsImportError instantiates with defaults and proper prototype chain", () => {
      const defaultErr = new CliWatchdogOpsImportError("Default import failure");
      expect(defaultErr).toBeInstanceOf(Error);
      expect(defaultErr).toBeInstanceOf(CliWatchdogOpsImportError);
      expect(defaultErr.name).toBe("CliWatchdogOpsImportError");
      expect(defaultErr.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_CLI);
      expect(defaultErr.defectRef).toBe(DEFECT_REF);
      expect(defaultErr.issues).toEqual([]);
      expect(defaultErr.specifier).toBeUndefined();
      expect(defaultErr.filePath).toBeUndefined();
    });

    test("CliWatchdogOpsImportError retains custom options and metadata", () => {
      const customErr = new CliWatchdogOpsImportError("Detailed failure", {
        code: "CUSTOM_CLI_ERR",
        defectRef: "custom-ref-123",
        specifier: "../../engine/scheduler/core-engine.ts",
        filePath: "/path/to/cli/watchdog-ops.ts",
        issues: [
          {
            code: "CUSTOM_CLI_ERR",
            message: "Legacy import detected",
            specifier: "../../engine/scheduler/core-engine.ts",
            filePath: "/path/to/cli/watchdog-ops.ts",
            line: 25,
            suggestedRemediation: "../../engine/scheduler/index.ts",
          },
        ],
      });

      expect(customErr.code).toBe("CUSTOM_CLI_ERR");
      expect(customErr.defectRef).toBe("custom-ref-123");
      expect(customErr.specifier).toBe("../../engine/scheduler/core-engine.ts");
      expect(customErr.filePath).toBe("/path/to/cli/watchdog-ops.ts");
      expect(customErr.issues.length).toBe(1);
      expect(customErr.issues[0]?.line).toBe(25);
    });

    test("aliases point to the same constructor", () => {
      expect(CliSchedulerImportError).toBe(CliWatchdogOpsImportError);
      expect(UnresolvedCoreEngineImportError).toBe(CliWatchdogOpsImportError);
      const aliasErr = new CliSchedulerImportError("Via alias");
      expect(aliasErr).toBeInstanceOf(CliWatchdogOpsImportError);
    });
  });

  describe("3. AST Extraction & Import Parsing", () => {
    test("extractModuleImports extracts all static, multiline, dynamic, and re-export specifiers", () => {
      const source = `
        import { loadRun } from "../../engine/store/index.ts";
        import {
          auditSupervisory5PointHealth,
          dispatchSupervisoryHealthProbe,
        } from "../../engine/scheduler/core-engine.ts";
        import * as Scheduler from "../../engine/scheduler/index.ts";
        import "./side-effects.ts";
        export { watchdogStatusCommand } from "./watchdog-ops.ts";

        async function lazyLoad() {
          const mod = await import("../../engine/scheduler/dynamic.ts");
        }
      `;

      const imports = extractModuleImports(source);
      expect(imports).toContain("../../engine/store/index.ts");
      expect(imports).toContain("../../engine/scheduler/core-engine.ts");
      expect(imports).toContain("../../engine/scheduler/index.ts");
      expect(imports).toContain("./side-effects.ts");
      expect(imports).toContain("./watchdog-ops.ts");
      expect(imports).toContain("../../engine/scheduler/dynamic.ts");
      expect(imports.length).toBe(6);
    });

    test("extractModuleImports handles blank source and pure comments", () => {
      expect(extractModuleImports("")).toEqual([]);
      expect(extractModuleImports("// just a comment\nconst x = 100;")).toEqual([]);
    });

    test("extractImportEntries parses detailed AST entries with line numbers and symbols", () => {
      const source = [
        'import type { Supervisory5PointHealthReport } from "../../engine/scheduler/index.ts";',
        'import { auditSupervisory5PointHealth, dispatchSupervisoryHealthProbe } from "../../engine/scheduler/core-engine.ts";',
        'import * as Tools from "./tools.ts";',
        'import DefaultRunner from "./runner.ts";',
        'export { watchdogStatusCommand } from "./watchdog-ops.ts";',
        'const dyn = await import("./async-mod.ts");',
      ].join("\n");

      const entries = extractImportEntries(source);
      expect(entries.length).toBe(6);

      const typeEntry = entries.find((e) => e.specifier === "../../engine/scheduler/index.ts");
      expect(typeEntry).toBeDefined();
      expect(typeEntry?.isTypeOnly).toBe(true);
      expect(typeEntry?.namedSymbols).toContain("Supervisory5PointHealthReport");
      expect(typeEntry?.line).toBe(1);

      const legacyEntry = entries.find(
        (e) => e.specifier === "../../engine/scheduler/core-engine.ts",
      );
      expect(legacyEntry).toBeDefined();
      expect(legacyEntry?.isTypeOnly).toBe(false);
      expect(legacyEntry?.namedSymbols).toContain("auditSupervisory5PointHealth");
      expect(legacyEntry?.namedSymbols).toContain("dispatchSupervisoryHealthProbe");
      expect(legacyEntry?.line).toBe(2);

      const nsEntry = entries.find((e) => e.specifier === "./tools.ts");
      expect(nsEntry?.namespaceImport).toBe("Tools");

      const defEntry = entries.find((e) => e.specifier === "./runner.ts");
      expect(defEntry?.defaultImport).toBe("DefaultRunner");

      const exportEntry = entries.find((e) => e.specifier === "./watchdog-ops.ts");
      expect(exportEntry?.isReExport).toBe(true);

      const dynEntry = entries.find((e) => e.specifier === "./async-mod.ts");
      expect(dynEntry?.isDynamic).toBe(true);
    });
  });

  describe("4. Classification & Predicates", () => {
    test("isLegacyCoreEngineImport accurately detects legacy specifiers", () => {
      expect(isLegacyCoreEngineImport("../../engine/scheduler/core-engine.ts")).toBe(true);
      expect(isLegacyCoreEngineImport("../../engine/scheduler/core-engine")).toBe(true);
      expect(isLegacyCoreEngineImport("../engine/scheduler/core-engine.ts")).toBe(true);
      expect(isLegacyCoreEngineImport("./engine/scheduler/core-engine.ts")).toBe(true);
      expect(isLegacyCoreEngineImport("engine/scheduler/core-engine.ts")).toBe(true);
      expect(isLegacyCoreEngineImport("./core-engine.ts")).toBe(true);
      expect(isLegacyCoreEngineImport("./core-engine")).toBe(true);
      expect(isLegacyCoreEngineImport("../core-engine.ts")).toBe(true);

      // Should not flag canonical barrels or other modules
      expect(isLegacyCoreEngineImport("../../engine/scheduler/index.ts")).toBe(false);
      expect(isLegacyCoreEngineImport("../../engine/scheduler/core/index.ts")).toBe(false);
      expect(isLegacyCoreEngineImport("../../engine/scheduler/core-engine-class.ts")).toBe(false);
      expect(isLegacyCoreEngineImport("../reporting/doctor.ts")).toBe(false);
      expect(isLegacyCoreEngineImport("node:fs")).toBe(false);
      expect(isLegacyCoreEngineImport("")).toBe(false);
      expect(isLegacyCoreEngineImport("   ")).toBe(false);
    });

    test("isCanonicalSchedulerImport identifies canonical barrel import specifiers", () => {
      expect(isCanonicalSchedulerImport("../../engine/scheduler/index.ts")).toBe(true);
      expect(isCanonicalSchedulerImport("../../engine/scheduler/core/index.ts")).toBe(true);
      expect(isCanonicalSchedulerImport("./index.ts")).toBe(true);
      expect(isCanonicalSchedulerImport("./core/index.ts")).toBe(true);

      expect(isCanonicalSchedulerImport("../../engine/scheduler/core-engine.ts")).toBe(false);
      expect(isCanonicalSchedulerImport("./core-engine.ts")).toBe(false);
      expect(isCanonicalSchedulerImport("")).toBe(false);
    });

    test("resolveSchedulerImportPath resolves appropriate canonical target based on caller location", () => {
      expect(
        resolveSchedulerImportPath(
          "../../engine/scheduler/core-engine.ts",
          "olt/scripts/src/cli/commands/watchdog-ops.ts",
        ),
      ).toBe(CANONICAL_SCHEDULER_BARREL_SPECIFIER_FROM_CLI);

      expect(
        resolveSchedulerImportPath(
          "../core-engine.ts",
          "olt/scripts/src/engine/scheduler/core/loop.ts",
        ),
      ).toBe("./index.ts");

      expect(
        resolveSchedulerImportPath(
          "./core-engine.ts",
          "olt/scripts/src/engine/scheduler/index.ts",
        ),
      ).toBe("./core/index.ts");

      // Non-legacy paths are preserved untouched
      expect(resolveSchedulerImportPath("../../engine/scheduler/index.ts")).toBe(
        "../../engine/scheduler/index.ts",
      );
    });

    test("classifySchedulerImport provides full classification metadata", () => {
      const legacyClass = classifySchedulerImport("../../engine/scheduler/core-engine.ts");
      expect(legacyClass.isLegacy).toBe(true);
      expect(legacyClass.isCanonical).toBe(false);
      expect(legacyClass.resolvedSpecifier).toBe(CANONICAL_SCHEDULER_BARREL_SPECIFIER_FROM_CLI);

      const canonicalClass = classifySchedulerImport("../../engine/scheduler/index.ts");
      expect(canonicalClass.isLegacy).toBe(false);
      expect(canonicalClass.isCanonical).toBe(true);
      expect(canonicalClass.isCoreBarrel).toBe(false);

      const coreBarrelClass = classifySchedulerImport("../../engine/scheduler/core/index.ts");
      expect(coreBarrelClass.isCanonical).toBe(true);
      expect(coreBarrelClass.isCoreBarrel).toBe(true);
    });
  });

  describe("5. Source Code Remediation & Diagnostics", () => {
    test("remediateCliWatchdogImports rewrites legacy imports to canonical barrel imports", () => {
      const corrupted = `
import { loadRun } from "../../engine/store/index.ts";
import {
  auditSupervisory5PointHealth,
  dispatchSupervisoryHealthProbe,
  type Supervisory5PointHealthReport,
} from "../../engine/scheduler/core-engine.ts";
import { runDoctor } from "../../reporting/doctor.ts";
`;

      const remediated = remediateCliWatchdogImports(corrupted, {
        fromFilePath: "olt/scripts/src/cli/commands/watchdog-ops.ts",
      });

      expect(remediated).toContain(
        `from "${CANONICAL_SCHEDULER_BARREL_SPECIFIER_FROM_CLI}";`,
      );
      expect(remediated).not.toContain("../../engine/scheduler/core-engine.ts");
      expect(remediated).toContain(`import { runDoctor } from "../../reporting/doctor.ts";`);
    });

    test("remediateCliWatchdogImportsWithReport outputs replacement metrics and status", () => {
      const source = `
import { a } from "../../engine/scheduler/core-engine.ts";
import { b } from "../engine/scheduler/core-engine.ts";
`;
      const report = remediateCliWatchdogImportsWithReport(source);
      expect(report.defectRef).toBe(DEFECT_REF);
      expect(report.success).toBe(true);
      expect(report.replacementsCount).toBe(2);
      expect(report.remediatedSource).toContain(CANONICAL_SCHEDULER_BARREL_SPECIFIER_FROM_CLI);
    });

    test("remediateCliWatchdogImports leaves clean code unchanged", () => {
      const clean = `import { auditSupervisory5PointHealth } from "${CANONICAL_SCHEDULER_BARREL_SPECIFIER_FROM_CLI}";`;
      expect(remediateCliWatchdogImports(clean)).toBe(clean);
    });
  });

  describe("6. Validation & Assertions", () => {
    test("validateCliWatchdogImports validates the live watchdog-ops.ts file cleanly", () => {
      const result = validateCliWatchdogImports();
      expect(result.defectRef).toBe(DEFECT_REF);
      expect(result.valid).toBe(true);
      expect(result.legacyImportDetected).toBe(false);
      expect(result.canonicalImportPresent).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.imports).toContain(CANONICAL_SCHEDULER_BARREL_SPECIFIER_FROM_CLI);
    });

    test("validateCliWatchdogImports flags legacy imports in corrupted snippet", () => {
      const corruptedSnippet = `import { auditSupervisory5PointHealth } from "../../engine/scheduler/core-engine.ts";`;
      const result = validateCliWatchdogImports(corruptedSnippet, {
        filePath: "olt/scripts/src/cli/commands/watchdog-ops.ts",
      });

      expect(result.valid).toBe(false);
      expect(result.legacyImportDetected).toBe(true);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0]?.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_CLI);
      expect(result.issues[0]?.suggestedRemediation).toBe(
        CANONICAL_SCHEDULER_BARREL_SPECIFIER_FROM_CLI,
      );
    });

    test("validateCliWatchdogImports reports issue for missing file", () => {
      const result = validateCliWatchdogImports("/non/existent/watchdog-ops.ts");
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0]?.message).toContain("File not found");
    });

    test("assertValidCliWatchdogImports succeeds on live file and throws on corrupted code", () => {
      expect(() => assertValidCliWatchdogImports()).not.toThrow();

      const corrupted = `import { probe } from "../../engine/scheduler/core-engine.ts";`;
      let caught: unknown;
      try {
        assertValidCliWatchdogImports(corrupted, { filePath: "watchdog-ops.ts" });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(CliWatchdogOpsImportError);
      if (caught instanceof CliWatchdogOpsImportError) {
        expect(caught.code).toBe(UNRESOLVED_MODULE_IMPORT_IN_CLI);
        expect(caught.defectRef).toBe(DEFECT_REF);
        expect(caught.specifier).toBe("../../engine/scheduler/core-engine.ts");
      }
    });
  });

  describe("7. Directory Audits & Multi-File Verification", () => {
    test("auditCliCommandsForSchedulerImports audits live CLI commands directory", () => {
      const audit = auditCliCommandsForSchedulerImports();
      expect(audit.defectRef).toBe(DEFECT_REF);
      expect(audit.errorCode).toBe(UNRESOLVED_MODULE_IMPORT_IN_CLI);
      expect(audit.resolved).toBe(true);
      expect(audit.totalFilesScanned).toBeGreaterThanOrEqual(10);
      expect(audit.invalidFilesCount).toBe(0);
      expect(audit.issues).toEqual([]);
    });

    test("auditCliCommandsForSchedulerImports catches corrupted fixture in temporary directory", () => {
      const tempDir = createTempDir();
      writeFileSync(
        join(tempDir, "clean.ts"),
        `import { loadRun } from "../../engine/store/index.ts";\nimport { auditSupervisory5PointHealth } from "../../engine/scheduler/index.ts";`,
        "utf-8",
      );
      writeFileSync(
        join(tempDir, "corrupted.ts"),
        `import { dispatchSupervisoryHealthProbe } from "../../engine/scheduler/core-engine.ts";`,
        "utf-8",
      );

      const audit = auditCliCommandsForSchedulerImports(tempDir);
      expect(audit.resolved).toBe(false);
      expect(audit.totalFilesScanned).toBe(2);
      expect(audit.validFilesCount).toBe(1);
      expect(audit.invalidFilesCount).toBe(1);
      expect(audit.issues.length).toBe(1);
    });
  });

  describe("8. Defect Entry, Resolution Proof & Live System Integrity", () => {
    test("createCliWatchdogDefectProof builds valid resolution proof contract", () => {
      const proof = createCliWatchdogDefectProof();
      expect(proof.task_id).toContain(DEFECT_REF);
      expect(proof.verified).toBe(true);
      expect(proof.empirical_command).toContain(
        "bun test tests/unit/tooling/defect-cli-watchdog-ops-unresolved-core-engine-import.test.ts",
      );
      expect(proof.explanation).toContain("remediated unresolved import");
    });

    test("createCliWatchdogDefectEntry builds compliant DefectEntry contract", () => {
      const entry = createCliWatchdogDefectEntry();
      expect(entry.id).toContain(DEFECT_REF);
      expect(entry.domain).toBe("tooling");
      expect(entry.error_code).toBe(UNRESOLVED_MODULE_IMPORT_IN_CLI);
      expect(entry.status).toBe("resolved");
      expect(entry.type).toBe("CODE_HEALTH");
      expect(entry.category).toBe("modularity_violation");
      expect(entry.severity).toBe("high");
      expect(entry.resolution?.verified).toBe(true);
    });

    test("verifyLiveWatchdogOpsIntegrity verifies live subsystem health and execution readiness", async () => {
      const integrity = await verifyLiveWatchdogOpsIntegrity();
      expect(integrity.verified).toBe(true);
      expect(integrity.watchdogOpsExists).toBe(true);
      expect(integrity.schedulerBarrelExists).toBe(true);
      expect(integrity.schedulerCoreBarrelExists).toBe(true);
      expect(integrity.supervisoryProbeCallable).toBe(true);
      expect(integrity.auditSupervisoryHealthCallable).toBe(true);
      expect(integrity.determineTopLeaderCallable).toBe(true);
    });
  });

  describe("9. Functional Facade Re-exports", () => {
    test("re-exported supervisory functions and classes are fully callable and functional", () => {
      const dummyState: Record<string, unknown> = {};

      const probeResult = dispatchSupervisoryHealthProbe(dummyState, { now: Date.now() });
      expect(probeResult).toBeDefined();
      expect(typeof probeResult.dispatched).toBe("boolean");
      expect(typeof probeResult.markdown).toBe("string");

      const healthReport = auditSupervisory5PointHealth(dummyState, { now: Date.now() });
      expect(healthReport).toBeDefined();
      expect(typeof healthReport.healthy).toBe("boolean");
      expect(Array.isArray(healthReport.overallIssues)).toBe(true);

      const topLeader = determineTopLeader(dummyState);
      expect(topLeader).toBeDefined();
      expect(typeof topLeader.role).toBe("string");

      const markdown = formatSupervisoryHealthMarkdown(healthReport);
      expect(typeof markdown).toBe("string");
      expect(markdown).toContain("5-Point Health Probe");

      const engine = createSchedulerEngine();
      expect(engine).toBeInstanceOf(SchedulerEngine);
    });
  });

  describe("10. Zero TypeScript any and Zero Compiler Suppressions Across Write Scope", () => {
    test("verifies zero TypeScript any and zero compiler suppressions across implementation and test files", () => {
      const filesToAudit = [
        join(
          process.cwd(),
          "olt/scripts/src/tooling/defect-cli-watchdog-ops-unresolved-core-engine-import.ts",
        ),
        join(
          process.cwd(),
          "tests/unit/tooling/defect-cli-watchdog-ops-unresolved-core-engine-import.test.ts",
        ),
      ];

      const anyRegex = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
      const suppressionRegex = new RegExp(
        ["@ts" + "-ignore", "@ts" + "-expect-error", "@ts" + "-nocheck"].join("|"),
      );

      for (const filePath of filesToAudit) {
        expect(existsSync(filePath)).toBe(true);
        const fileContent = readFileSync(filePath, "utf-8");
        const lines = fileContent.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          // Skip regex definition lines in the test itself
          if (line.includes("anyRegex") || line.includes("suppressionRegex")) {
            continue;
          }

          expect(anyRegex.test(line)).toBe(false);
          expect(suppressionRegex.test(line)).toBe(false);
        }
      }
    });
  });
});
