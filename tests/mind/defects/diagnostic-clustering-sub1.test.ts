import { describe, expect, it } from "bun:test";
import {
  DEFICIT_CRITICALITY_CLASSES,
  DIAGNOSTIC_ERROR_KINDS,
  DEFAULT_KNOWN_SUBSYSTEMS,
  inferSubsystemFromPath,
  extractStackFrames,
  computeStackSignature,
  parseRawDiagnostics,
  clusterDiagnosticErrors,
  runEmpiricalBaselineProbes,
  formatDeficitTopologyMatrixMarkdown,
  DiagnosticClusteringEngine,
  type DeficitTopologyMatrix,
  type ParsedDiagnosticError,
} from "../../../olt/scripts/src/mind/defects/index.ts";

describe("Active Baseline Probing & Diagnostic Clustering Engine Suite", () => {


describe("Subsystem Inference & Stack Trace Utilities", () => {
    it("infers canonical subsystem paths from source file paths and error messages", () => {
      expect(inferSubsystemFromPath("src/mind/defects/diagnostic-clustering.ts")).toBe(
        "mind/defects",
      );
      expect(inferSubsystemFromPath("src/mind/planning/pareto-arbitration.ts")).toBe(
        "mind/planning",
      );
      expect(inferSubsystemFromPath("src/reporting/doctor/adversarial.ts")).toBe(
        "reporting/doctor",
      );
      expect(inferSubsystemFromPath("unknown/path/test.ts")).toBe("unknown/path");
      expect(inferSubsystemFromPath(undefined, "Invariant violation in mind/memory cache")).toBe(
        "mind/memory",
      );
    });

    it("extracts cleaned stack frames and computes deterministic signatures", () => {
      const sampleStack = [
        "TypeError: Cannot read properties of undefined (reading 'foo')",
        "    at processMessage (/app/src/mind/defects/handler.ts:42:15)",
        "    at Object.execute (/app/src/mind/core/engine.ts:100:8)",
        "    at Runner.run (/app/src/workflow/runner.ts:50:12)",
      ].join("\n");

      const frames = extractStackFrames(sampleStack);
      expect(frames.length).toBe(3);
      expect(frames[0]).toContain("processMessage");
      expect(frames[1]).toContain("execute");
      expect(frames[2]).toContain("run");

      const stackSig = computeStackSignature(frames, "TypeError: sample error");
      expect(stackSig.startsWith("SIG-STK-")).toBe(true);

      const emptyFramesSig = computeStackSignature([], "TypeError: sample error without stack");
      expect(emptyFramesSig.startsWith("SIG-MSG-")).toBe(true);
    });
  });

describe("Multi-Dialect Diagnostic Error Parsing", () => {
    it("parses TypeScript compilation errors (tsc paren and dash formats) as Class 1 Blockers", () => {
      const tsLog = [
        "src/mind/defects/foo.ts(12,34): error TS2304: Cannot find name 'UndefinedSymbol'.",
        "  const x: UndefinedSymbol = 123;",
        "        ~",
        "src/mind/planning/bar.ts:45:10 - error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.",
      ].join("\n");

      const parsedTs = parseRawDiagnostics(tsLog, "typecheck_probe");
      expect(parsedTs.length).toBe(2);

      const err1 = parsedTs[0];
      expect(err1).toBeDefined();
      expect(err1?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER);
      expect(err1?.errorCode).toBe("TS2304");
      expect(err1?.lineNumber).toBe(12);
      expect(err1?.columnNumber).toBe(34);
      expect(err1?.subsystem).toBe("mind/defects");

      const err2 = parsedTs[1];
      expect(err2).toBeDefined();
      expect(err2?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER);
      expect(err2?.errorCode).toBe("TS2345");
      expect(err2?.subsystem).toBe("mind/planning");
    });

    it("parses ESLint linter errors and warnings as Class 3 Quality Deficits", () => {
      const lintLog = [
        "src/mind/defects/worker.ts:10:5: Missing return type on function [@typescript-eslint/explicit-function-return-type]",
        "src/mind/memory/cache.ts:25:3: Unused variable 'unusedVar' [warning/@typescript-eslint/no-unused-vars]",
      ].join("\n");

      const parsedLint = parseRawDiagnostics(lintLog, "lint_probe");
      expect(parsedLint.length).toBe(2);

      const lint1 = parsedLint[0];
      expect(lint1).toBeDefined();
      expect(lint1?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_3_QUALITY_DEFICIT);
      expect(lint1?.errorCode).toBe("@typescript-eslint/explicit-function-return-type");
      expect(lint1?.lineNumber).toBe(10);
      expect(lint1?.subsystem).toBe("mind/defects");

      const lint2 = parsedLint[1];
      expect(lint2).toBeDefined();
      expect(lint2?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_3_QUALITY_DEFICIT);
      expect(lint2?.errorCode).toBe("@typescript-eslint/no-unused-vars");
    });

    it("parses test runner assertion failures as Class 2 Regressions", () => {
      const testLog = [
        "FAIL src/mind/memory/three-tier-memory.test.ts",
        "  AssertionError: expected true to be false",
        "    at Context.<anonymous> (src/mind/memory/three-tier-memory.test.ts:45:12)",
        "    at runTest (src/testing/runner.ts:20:5)",
      ].join("\n");

      const parsedTest = parseRawDiagnostics(testLog, "unit_test_probe");
      expect(parsedTest.length).toBe(1);

      const testErr = parsedTest[0];
      expect(testErr).toBeDefined();
      expect(testErr?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION);
      expect(testErr?.subsystem).toBe("mind/memory");
      expect(testErr?.errorCode).toBe("AssertionError");
      expect(testErr?.stackTrace?.length).toBeGreaterThan(0);
    });

    it("parses runtime crashes and invariant violations with appropriate criticality classification", () => {
      const runtimeLog = [
        "InvariantViolation: Illegal state transition from QUINQUENNIAL to RETIRED",
        "    at StateMachine.transition (src/mind/lifecycle/governance.ts:88:14)",
        "TypeError: Cannot read properties of null (reading 'uuid')",
        "    at Object.serialize (src/mind/defects/serializer.ts:14:5)",
      ].join("\n");

      const parsedRuntime = parseRawDiagnostics(runtimeLog, "health_probe");
      expect(parsedRuntime.length).toBe(2);

      const invErr = parsedRuntime[0];
      expect(invErr).toBeDefined();
      expect(invErr?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_2_REGRESSION);
      expect(invErr?.errorCode).toBe("InvariantViolation");

      const typeErr = parsedRuntime[1];
      expect(typeErr).toBeDefined();
      expect(typeErr?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER);
      expect(typeErr?.errorCode).toBe("TypeError");
    });

    it("parses module resolution errors as Class 1 Blockers", () => {
      const modLog = "Cannot find module './missing-module' or its corresponding type declarations.";
      const parsedMod = parseRawDiagnostics(modLog, "typecheck");
      expect(parsedMod.length).toBe(1);
      const modErr = parsedMod[0];
      expect(modErr?.classification).toBe(DEFICIT_CRITICALITY_CLASSES.CLASS_1_BLOCKER);
    });
  });
});
