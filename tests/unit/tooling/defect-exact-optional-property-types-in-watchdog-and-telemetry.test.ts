import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFECT_REF,
  ERROR_CODE,
  EXACT_OPTIONAL_PROPERTY_TYPE_MISMATCH,
  ExactOptionalPropertyMismatchError,
  INVARIANT_DESCRIPTION,
  INVARIANT_NAME,
  TARGET_MODULES,
  TARGET_MODULE_TELEMETRY,
  TARGET_MODULE_WATCHDOG,
  TS_ERROR_CODES,
  TS_ERROR_TS2379,
  TS_ERROR_TS2412,
  assertNoExplicitUndefinedProperties,
  auditModulesForExactOptionalCompliance,
  auditSourceCodeForExactOptionalViolations,
  buildSafeAgentActivityState,
  buildSafeAutonomicWatchdogConfig,
  buildSafeStartActionSpanOptions,
  buildSafeSubStepTiming,
  buildSafeSubagentRegistrationOptions,
  cleanUndefined,
  createDefectProof,
  getExplicitUndefinedKeyNames,
  hasExplicitUndefinedKeys,
  isRecord,
  remediateSourceCode,
  verifySubsystemIntegrity,
  type DefectResolutionProof,
  type ExactOptionalAuditFinding,
  type ExactOptionalAuditReport,
  type SubsystemVerificationReport,
} from "../../../olt/scripts/src/tooling/defect-exact-optional-property-types-in-watchdog-and-telemetry.ts";
import {
  AutonomicWatchdog,
  type AgentActivityState,
  type AutonomicWatchdogConfig,
  type SubagentRegistrationOptions,
} from "../../../olt/scripts/src/watchdog/index.ts";
import {
  OmnipresentTelemetryCollector,
  type StartActionSpanOptions,
} from "../../../olt/scripts/src/reporting/time-telemetry/index.ts";
import { getDualTime } from "../../../olt/scripts/src/core/dual-time/index.ts";

describe("Task 1.2: Defect Remediation - Type mismatches with exactOptionalPropertyTypes in autonomic-watchdog and time-telemetry", () => {
  describe("1. Canonical Defect Constants & Error Identifiers", () => {
    it("exports exact canonical defect reference, error code, and TS error mappings", () => {
      expect(DEFECT_REF).toBe("defect-exact-optional-property-types-in-watchdog-and-telemetry");
      expect(EXACT_OPTIONAL_PROPERTY_TYPE_MISMATCH).toBe("EXACT_OPTIONAL_PROPERTY_TYPE_MISMATCH");
      expect(ERROR_CODE).toBe("EXACT_OPTIONAL_PROPERTY_TYPE_MISMATCH");
      expect(TS_ERROR_CODES).toContain("TS2412");
      expect(TS_ERROR_CODES).toContain("TS2379");
      expect(TS_ERROR_TS2412).toBe("TS2412");
      expect(TS_ERROR_TS2379).toBe("TS2379");
    });

    it("identifies target modules in watchdog and reporting/time-telemetry", () => {
      expect(TARGET_MODULE_WATCHDOG).toBe(
        "olt/scripts/src/watchdog/autonomic-watchdog/watchdog-engine.ts",
      );
      expect(TARGET_MODULE_TELEMETRY).toBe(
        "olt/scripts/src/reporting/time-telemetry/collector.ts",
      );
      expect(TARGET_MODULES).toContain(TARGET_MODULE_WATCHDOG);
      expect(TARGET_MODULES).toContain(TARGET_MODULE_TELEMETRY);
    });

    it("defines the architectural invariant and descriptions", () => {
      expect(INVARIANT_NAME).toBe("ExactOptionalPropertyTypes Integrity Invariant");
      expect(INVARIANT_DESCRIPTION.length).toBeGreaterThan(20);
    });
  });

  describe("2. Custom Error Diagnostics (ExactOptionalPropertyMismatchError)", () => {
    it("constructs error with default codes and attributes", () => {
      const err = new ExactOptionalPropertyMismatchError("Property mismatch in options");
      expect(err.name).toBe("ExactOptionalPropertyMismatchError");
      expect(err.code).toBe(EXACT_OPTIONAL_PROPERTY_TYPE_MISMATCH);
      expect(err.defectRef).toBe(DEFECT_REF);
      expect(err.message).toBe("Property mismatch in options");
    });

    it("preserves specialized options including targetType, propertyName, and offendingValue", () => {
      const err = new ExactOptionalPropertyMismatchError("Invalid undefined passed to timeoutMs", {
        propertyName: "timeoutMs",
        targetType: "AutonomicWatchdogConfig",
        filePath: "watchdog-engine.ts",
        offendingValue: undefined,
      });
      expect(err.propertyName).toBe("timeoutMs");
      expect(err.targetType).toBe("AutonomicWatchdogConfig");
      expect(err.filePath).toBe("watchdog-engine.ts");
      expect(err.offendingValue).toBeUndefined();
    });
  });

  describe("3. Type-Safe Predicates & Object Sanitization", () => {
    it("isRecord accurately distinguishes plain records from non-objects", () => {
      expect(isRecord({ a: 1 })).toBe(true);
      expect(isRecord({})).toBe(true);
      expect(isRecord(null)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
      expect(isRecord("string")).toBe(false);
      expect(isRecord(42)).toBe(false);
      expect(isRecord(true)).toBe(false);
      expect(isRecord([1, 2, 3])).toBe(false);
    });

    it("cleanUndefined removes all keys whose values are strictly undefined", () => {
      const input = {
        name: "service",
        port: 8080,
        debug: undefined,
        secret: undefined,
        active: false,
        count: 0,
        emptyStr: "",
        nullVal: null,
      };

      const cleaned = cleanUndefined(input);
      expect(cleaned).toEqual({
        name: "service",
        port: 8080,
        active: false,
        count: 0,
        emptyStr: "",
        nullVal: null,
      });
      expect("debug" in cleaned).toBe(false);
      expect("secret" in cleaned).toBe(false);
    });

    it("hasExplicitUndefinedKeys identifies presence of explicit undefined properties", () => {
      expect(hasExplicitUndefinedKeys({ a: 1, b: undefined })).toBe(true);
      expect(hasExplicitUndefinedKeys({ a: 1, b: null })).toBe(false);
      expect(hasExplicitUndefinedKeys({ a: 1, b: "defined" })).toBe(false);
      expect(hasExplicitUndefinedKeys({})).toBe(false);
    });

    it("getExplicitUndefinedKeyNames returns exact list of undefined keys", () => {
      const obj = { x: 10, y: undefined, z: "foo", w: undefined };
      const undefinedKeys = getExplicitUndefinedKeyNames(obj);
      expect(undefinedKeys).toEqual(["y", "w"]);
    });

    it("assertNoExplicitUndefinedProperties throws when forbidden undefined is present", () => {
      expect(() => {
        assertNoExplicitUndefinedProperties(
          { timeout: undefined, actor: "mind" },
          "WatchdogConfig",
        );
      }).toThrow(ExactOptionalPropertyMismatchError);

      expect(() => {
        assertNoExplicitUndefinedProperties({ timeout: 5000, actor: "mind" }, "WatchdogConfig");
      }).not.toThrow();
    });
  });

  describe("4. Subsystem-Specific Safe Builders", () => {
    it("buildSafeAutonomicWatchdogConfig omits undefined properties", () => {
      const rawConfig: Partial<AutonomicWatchdogConfig> = {
        heartbeatIntervalMs: 1000,
        timeoutMs: undefined,
        generation: 2,
        capsuleRoot: undefined,
      };

      const safeConfig = buildSafeAutonomicWatchdogConfig(rawConfig);
      expect(safeConfig.heartbeatIntervalMs).toBe(1000);
      expect(safeConfig.generation).toBe(2);
      expect("timeoutMs" in safeConfig).toBe(false);
      expect("capsuleRoot" in safeConfig).toBe(false);
      expect(hasExplicitUndefinedKeys(safeConfig as unknown as Record<string, unknown>)).toBe(false);
    });

    it("buildSafeStartActionSpanOptions omits undefined telemetry options", () => {
      const rawOptions: Partial<StartActionSpanOptions> = {
        category: "watchdog",
        tier: undefined,
        timezone: "UTC",
        metadata: undefined,
      };

      const safeOptions = buildSafeStartActionSpanOptions(rawOptions);
      expect(safeOptions.category).toBe("watchdog");
      expect(safeOptions.timezone).toBe("UTC");
      expect("tier" in safeOptions).toBe(false);
      expect("metadata" in safeOptions).toBe(false);
      expect(hasExplicitUndefinedKeys(safeOptions as unknown as Record<string, unknown>)).toBe(false);
    });

    it("buildSafeSubagentRegistrationOptions preserves required keys and omits undefined", () => {
      const raw: SubagentRegistrationOptions = {
        agentId: "agent-alpha",
        role: "implementer",
        tier: undefined,
        taskId: "task-01",
        pid: undefined,
      };

      const safe = buildSafeSubagentRegistrationOptions(raw);
      expect(safe.agentId).toBe("agent-alpha");
      expect(safe.role).toBe("implementer");
      expect(safe.taskId).toBe("task-01");
      expect("tier" in safe).toBe(false);
      expect("pid" in safe).toBe(false);
      expect(hasExplicitUndefinedKeys(safe as unknown as Record<string, unknown>)).toBe(false);
    });

    it("buildSafeAgentActivityState creates normalized state with undefined omitted", () => {
      const state = buildSafeAgentActivityState({
        agentId: "agent-01",
        taskId: null,
        pid: undefined,
        lastHeartbeatAt: 1000,
        lastActivityAt: 1000,
        status: "active",
        lastProcessHealth: undefined,
      });

      expect(state.agentId).toBe("agent-01");
      expect(state.taskId).toBeNull();
      expect(state.status).toBe("active");
      expect("pid" in state).toBe(false);
      expect("lastProcessHealth" in state).toBe(false);
    });

    it("buildSafeSubStepTiming creates step timing without undefined properties", () => {
      const dual = getDualTime(Date.now(), "UTC");
      const timing = buildSafeSubStepTiming("step-1", dual, "success", {
        finishedAt: undefined,
        durationMs: 150,
        durationFormatted: undefined,
      });

      expect(timing.name).toBe("step-1");
      expect(timing.durationMs).toBe(150);
      expect("finishedAt" in timing).toBe(false);
      expect("durationFormatted" in timing).toBe(false);
    });
  });

  describe("5. Static Code Auditing & Source Remediation", () => {
    it("auditSourceCodeForExactOptionalViolations catches unsafe assignments in mock code", () => {
      const sampleCode = `
        const config = {
          timeout: opts.timeout ?? undefined,
          retries: undefined,
          validKey: opts.validKey,
        };
      `;

      const findings = auditSourceCodeForExactOptionalViolations(sampleCode, "test-file.ts");
      expect(findings.length).toBe(2);
      expect(findings[0]?.violationType).toBe("unsafe_fallback_coalesce");
      expect(findings[1]?.violationType).toBe("explicit_undefined_assignment");
    });

    it("auditSourceCodeForExactOptionalViolations ignores type declarations and comments", () => {
      const typeCode = `
        // timeout: val ?? undefined
        /* another comment: undefined */
        export interface SampleConfig {
          readonly timeout?: number | undefined;
          readonly retries?: number | undefined;
        }
      `;

      const findings = auditSourceCodeForExactOptionalViolations(typeCode, "types.ts");
      expect(findings.length).toBe(0);
    });

    it("remediateSourceCode transforms unsafe fallback assignments to conditional spreads", () => {
      const input = `const x = {\n  timeout: opts.timeout ?? undefined,\n};`;
      const { remediated, replacementCount } = remediateSourceCode(input);
      expect(replacementCount).toBe(1);
      expect(remediated).toContain("...(opts.timeout !== undefined ? { timeout: opts.timeout } : {})");
    });

    it("auditModulesForExactOptionalCompliance audits target modules in workspace", () => {
      const report = auditModulesForExactOptionalCompliance(TARGET_MODULES);
      expect(report.defectRef).toBe(DEFECT_REF);
      expect(report.checkedFiles.length).toBeGreaterThan(0);
      expect(typeof report.compliant).toBe("boolean");
      expect(typeof report.summary).toBe("string");
    });
  });

  describe("6. Live Subsystem Verification & Proof Generation", () => {
    it("verifySubsystemIntegrity executes end-to-end watchdog and telemetry tests without undefined violations", async () => {
      const report: SubsystemVerificationReport = await verifySubsystemIntegrity();
      expect(report.defectRef).toBe(DEFECT_REF);
      expect(report.autonomicWatchdogVerified).toBe(true);
      expect(report.timeTelemetryVerified).toBe(true);
      expect(report.details.watchdogTicksProduced).toBeGreaterThan(0);
      expect(report.details.telemetrySpansRecorded).toBeGreaterThan(0);
      expect(report.details.errorsEncountered.length).toBe(0);
    });

    it("createDefectProof returns canonical verification receipt", () => {
      const proof: DefectResolutionProof = createDefectProof();
      expect(proof.defectRef).toBe(DEFECT_REF);
      expect(proof.status).toBe("resolved");
      expect(proof.remediatedModules).toEqual(TARGET_MODULES);
      expect(proof.tsErrorCodesRemediated).toEqual(TS_ERROR_CODES);
      expect(proof.testCommand).toContain("defect-exact-optional-property-types-in-watchdog-and-telemetry.test.ts");
    });
  });

  describe("7. Autonomic Watchdog & Omnipresent Telemetry Real-World Instances", () => {
    it("AutonomicWatchdog produces valid ticks and reports with exactOptionalPropertyTypes compliance", async () => {
      const watchdog = new AutonomicWatchdog({
        heartbeatIntervalMs: 100,
        timeoutMs: 1000,
        enforcePreFlightGates: false,
      });

      const tick = await watchdog.tick(Date.now());
      expect(tick.tickCount).toBe(1);
      expect(tick.health.healthy).toBe(true);

      const statusAscii = await watchdog.renderCliStatusReport();
      expect(typeof statusAscii).toBe("string");
      expect(statusAscii.length).toBeGreaterThan(0);

      watchdog.dispose();
    });

    it("OmnipresentTelemetryCollector records spans and generates reports without type mismatches", () => {
      const collector = new OmnipresentTelemetryCollector({ defaultTimezone: "UTC" });

      const span = collector.startSpan("process:exec", "mind", {
        category: "run",
        tier: 2,
      });

      const record = collector.finishSpan(span.actionId, "success", {
        exitCode: 0,
      });

      expect(record.actionId).toBe(span.actionId);
      expect(record.status).toBe("success");
      expect(record.durationMs).toBeGreaterThanOrEqual(0);

      const records = collector.getRecords();
      expect(records.length).toBe(1);
    });
  });
});
