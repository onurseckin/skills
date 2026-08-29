import { describe, expect, test } from "bun:test";
import {
  assertExactOptionalSafe,
  auditObjectExactOptionalProperties,
  createExactOptionalPropertyDefect,
  createExactOptionalSafeSpanOptions,
  createExactOptionalSafeWatchdogConfig,
  DEFECT_ERROR_CODE,
  DEFECT_REF,
  EXACT_OPTIONAL_PROPERTY_TYPE_MISMATCH,
  ExactOptionalPropertyError,
  isExactOptionalSafe,
  sanitizeExactOptionalProperties,
} from "../../../olt/scripts/src/tooling/defect-exact-optional-property-types-in-watchdog-and-telemetry.ts";
import type { AutonomicWatchdogConfig } from "../../../olt/scripts/src/watchdog/types.ts";
import type { StartActionSpanOptions } from "../../../olt/scripts/src/reporting/time-telemetry/types.ts";

describe("Task 1.2: defect-exact-optional-property-types-in-watchdog-and-telemetry", () => {
  describe("1. Defect constants and error codes", () => {
    test("defines exact defect reference and error code", () => {
      expect(DEFECT_REF).toBe("defect-exact-optional-property-types-in-watchdog-and-telemetry");
      expect(DEFECT_ERROR_CODE).toBe("EXACT_OPTIONAL_PROPERTY_TYPE_MISMATCH");
      expect(EXACT_OPTIONAL_PROPERTY_TYPE_MISMATCH).toBe("EXACT_OPTIONAL_PROPERTY_TYPE_MISMATCH");
    });
  });

  describe("2. ExactOptionalPropertyError", () => {
    test("instantiates with default code and defectRef", () => {
      const err = new ExactOptionalPropertyError("Exact optional type mismatch");
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(ExactOptionalPropertyError);
      expect(err.name).toBe("ExactOptionalPropertyError");
      expect(err.code).toBe(DEFECT_ERROR_CODE);
      expect(err.defectRef).toBe(DEFECT_REF);
      expect(err.property).toBeUndefined();
      expect(err.targetObject).toBeUndefined();
      expect(err.issues).toEqual([]);
    });

    test("instantiates with custom options", () => {
      const issue = {
        property: "timezone",
        path: "options.timezone",
        value: undefined,
        message: "Property 'options.timezone' is undefined",
      };
      const err = new ExactOptionalPropertyError("Violation detected", {
        code: "CUSTOM_MISMATCH",
        defectRef: "custom-defect",
        property: "timezone",
        targetObject: "SpanOptions",
        issues: [issue],
      });
      expect(err.code).toBe("CUSTOM_MISMATCH");
      expect(err.defectRef).toBe("custom-defect");
      expect(err.property).toBe("timezone");
      expect(err.targetObject).toBe("SpanOptions");
      expect(err.issues).toHaveLength(1);
      expect(err.issues[0]?.property).toBe("timezone");
    });
  });

  describe("3. sanitizeExactOptionalProperties", () => {
    test("removes undefined properties from shallow object", () => {
      const input = {
        a: 1,
        b: undefined,
        c: "hello",
        d: undefined,
        e: false,
        f: 0,
        g: "",
        h: null,
      };
      const sanitized = sanitizeExactOptionalProperties(input);
      expect(sanitized).toEqual({
        a: 1,
        c: "hello",
        e: false,
        f: 0,
        g: "",
        h: null,
      });
      expect("b" in sanitized).toBe(false);
      expect("d" in sanitized).toBe(false);
      expect(Object.keys(sanitized)).toEqual(["a", "c", "e", "f", "g", "h"]);
    });

    test("handles deep nested objects when deep option is true", () => {
      const input = {
        level1: "ok",
        nested: {
          valid: 123,
          bad: undefined,
          deepNested: {
            inner: "present",
            innerBad: undefined,
          },
        },
      };
      const sanitized = sanitizeExactOptionalProperties(input, { deep: true });
      expect(sanitized).toEqual({
        level1: "ok",
        nested: {
          valid: 123,
          deepNested: {
            inner: "present",
          },
        },
      });
      const nested = sanitized.nested as Record<string, unknown>;
      expect("bad" in nested).toBe(false);
      const deepNested = nested.deepNested as Record<string, unknown>;
      expect("innerBad" in deepNested).toBe(false);
    });

    test("handles nested arrays of objects when deep option is true", () => {
      const input = {
        items: [
          { id: 1, name: "one", missing: undefined },
          { id: 2, name: "two", otherMissing: undefined },
        ],
      };
      const sanitized = sanitizeExactOptionalProperties(input, { deep: true });
      expect(sanitized).toEqual({
        items: [
          { id: 1, name: "one" },
          { id: 2, name: "two" },
        ],
      });
    });

    test("preserves Date and RegExp instances in deep mode", () => {
      const date = new Date(1700000000000);
      const regex = /^test$/i;
      const input = {
        date,
        regex,
        bad: undefined,
      };
      const sanitized = sanitizeExactOptionalProperties(input, { deep: true });
      expect(sanitized.date).toBe(date);
      expect(sanitized.regex).toBe(regex);
      expect("bad" in sanitized).toBe(false);
    });

    test("removes null values if removeNull option is true", () => {
      const input = {
        a: "val",
        b: null,
        c: undefined,
      };
      const sanitized = sanitizeExactOptionalProperties(input, { removeNull: true });
      expect(sanitized).toEqual({ a: "val" });
      expect("b" in sanitized).toBe(false);
      expect("c" in sanitized).toBe(false);
    });

    test("handles empty object and primitives safely", () => {
      expect(sanitizeExactOptionalProperties({})).toEqual({});
      expect(sanitizeExactOptionalProperties(null as unknown as Record<string, unknown>)).toBeNull();
    });
  });

  describe("4. auditObjectExactOptionalProperties", () => {
    test("audits compliant object with no undefined properties", () => {
      const input = { a: 1, b: "two", c: true };
      const audit = auditObjectExactOptionalProperties(input, { objectName: "TestConfig" });
      expect(audit.valid).toBe(true);
      expect(audit.defectRef).toBe(DEFECT_REF);
      expect(audit.errorCode).toBe(DEFECT_ERROR_CODE);
      expect(audit.objectName).toBe("TestConfig");
      expect(audit.issues).toEqual([]);
      expect(audit.undefinedPropertyCount).toBe(0);
      expect(audit.undefinedProperties).toEqual([]);
      expect(audit.sanitized).toEqual({ a: 1, b: "two", c: true });
    });

    test("audits non-compliant object with undefined properties", () => {
      const input = { a: 1, b: undefined, c: undefined, d: "valid" };
      const audit = auditObjectExactOptionalProperties(input, { objectName: "WatchdogOpts" });
      expect(audit.valid).toBe(false);
      expect(audit.undefinedPropertyCount).toBe(2);
      expect(audit.undefinedProperties).toEqual(["b", "c"]);
      expect(audit.issues).toHaveLength(2);
      expect(audit.issues[0]?.property).toBe("b");
      expect(audit.issues[0]?.path).toBe("WatchdogOpts.b");
      expect(audit.issues[1]?.property).toBe("c");
      expect(audit.issues[1]?.path).toBe("WatchdogOpts.c");
      expect(audit.sanitized).toEqual({ a: 1, d: "valid" });
    });

    test("audits deep nested objects when deep option is true", () => {
      const input = {
        top: 1,
        nested: {
          sub: undefined,
          deeper: {
            deepBad: undefined,
          },
        },
      };
      const audit = auditObjectExactOptionalProperties(input, {
        objectName: "Config",
        deep: true,
      });
      expect(audit.valid).toBe(false);
      expect(audit.undefinedPropertyCount).toBe(2);
      expect(audit.issues.map((i) => i.path)).toEqual([
        "Config.nested.sub",
        "Config.nested.deeper.deepBad",
      ]);
    });
  });

  describe("5. assertExactOptionalSafe and isExactOptionalSafe", () => {
    test("isExactOptionalSafe returns boolean accordingly", () => {
      expect(isExactOptionalSafe({ a: 1, b: 2 })).toBe(true);
      expect(isExactOptionalSafe({ a: 1, b: undefined })).toBe(false);
    });

    test("assertExactOptionalSafe does not throw for safe object", () => {
      expect(() => {
        assertExactOptionalSafe({ active: true, name: "test" }, "ValidObject");
      }).not.toThrow();
    });

    test("assertExactOptionalSafe throws ExactOptionalPropertyError for invalid object", () => {
      expect(() => {
        assertExactOptionalSafe({ active: true, name: undefined }, "InvalidObject");
      }).toThrow(ExactOptionalPropertyError);

      try {
        assertExactOptionalSafe({ prop1: undefined, prop2: undefined }, "BadTarget");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ExactOptionalPropertyError);
        const exErr = err as ExactOptionalPropertyError;
        expect(exErr.code).toBe(DEFECT_ERROR_CODE);
        expect(exErr.defectRef).toBe(DEFECT_REF);
        expect(exErr.targetObject).toBe("BadTarget");
        expect(exErr.issues).toHaveLength(2);
      }
    });
  });

  describe("6. createExactOptionalSafeWatchdogConfig", () => {
    test("returns empty config when given undefined or empty object", () => {
      expect(createExactOptionalSafeWatchdogConfig()).toEqual({});
      expect(createExactOptionalSafeWatchdogConfig({})).toEqual({});
    });

    test("strips undefined watchdog properties while preserving defined ones", () => {
      const raw: Partial<AutonomicWatchdogConfig> = {
        heartbeatIntervalMs: 5000,
        timeoutMs: 30000,
        capsuleRoot: undefined,
        generation: 2,
        pulseId: undefined,
        enforcePreFlightGates: true,
      };

      const safe = createExactOptionalSafeWatchdogConfig(raw);
      expect(safe).toEqual({
        heartbeatIntervalMs: 5000,
        timeoutMs: 30000,
        generation: 2,
        enforcePreFlightGates: true,
      });
      expect("capsuleRoot" in safe).toBe(false);
      expect("pulseId" in safe).toBe(false);
    });

    test("handles nested adaptive timer configuration safely", () => {
      const raw = {
        heartbeatIntervalMs: 1000,
        adaptive: {
          enabled: true,
          minIntervalMs: 500,
          maxIntervalMs: undefined,
          backoffFactor: 1.5,
          activityBoost: undefined,
        },
      };

      const safe = createExactOptionalSafeWatchdogConfig(raw);
      expect(safe.heartbeatIntervalMs).toBe(1000);
      expect(typeof safe.adaptive).toBe("object");
      const adaptiveObj = safe.adaptive as Record<string, unknown>;
      expect(adaptiveObj.enabled).toBe(true);
      expect(adaptiveObj.minIntervalMs).toBe(500);
      expect(adaptiveObj.backoffFactor).toBe(1.5);
      expect("maxIntervalMs" in adaptiveObj).toBe(false);
      expect("activityBoost" in adaptiveObj).toBe(false);
    });

    test("preserves boolean adaptive option", () => {
      const raw = {
        heartbeatIntervalMs: 2000,
        adaptive: true,
      };
      const safe = createExactOptionalSafeWatchdogConfig(raw);
      expect(safe.adaptive).toBe(true);
    });
  });

  describe("7. createExactOptionalSafeSpanOptions", () => {
    test("returns empty span options when given undefined or empty object", () => {
      expect(createExactOptionalSafeSpanOptions()).toEqual({});
      expect(createExactOptionalSafeSpanOptions({})).toEqual({});
    });

    test("strips undefined properties while preserving defined ones", () => {
      const raw: Partial<StartActionSpanOptions> = {
        category: "watchdog",
        tier: 2,
        timezone: undefined,
        metadata: { key: "value" },
        expectedStartMs: undefined,
      };

      const safe = createExactOptionalSafeSpanOptions(raw);
      expect(safe).toEqual({
        category: "watchdog",
        tier: 2,
        metadata: { key: "value" },
      });
      expect("timezone" in safe).toBe(false);
      expect("expectedStartMs" in safe).toBe(false);
    });
  });

  describe("8. createExactOptionalPropertyDefect", () => {
    test("generates default defect entry", () => {
      const defect = createExactOptionalPropertyDefect();
      expect(defect.id).toContain(DEFECT_REF);
      expect(defect.domain).toBe("tooling");
      expect(defect.error_code).toBe(DEFECT_ERROR_CODE);
      expect(defect.title).toBe("exactOptionalPropertyTypes type mismatch in watchdog/telemetry");
      expect(defect.status).toBe("open");
      expect(defect.type).toBe("TYPE_DRIFT");
      expect(defect.category).toBe("code_defect");
      expect(defect.severity).toBe("high");
      expect(defect.context?.defectReference).toBe(DEFECT_REF);
      expect(defect.context?.errorCode).toBe(DEFECT_ERROR_CODE);
    });

    test("generates defect entry with custom options and issues context", () => {
      const issues = [
        {
          property: "timezone",
          path: "options.timezone",
          value: undefined,
          message: "Explicit undefined in timezone",
        },
      ];
      const defect = createExactOptionalPropertyDefect({
        id: "DEFECT-TEST-001",
        target: "reporting/time-telemetry/collector.ts",
        property: "timezone",
        issues,
        severity: "critical",
        status: "resolved",
        observation: "Custom observation text",
        remediation: "Custom remediation steps",
        timestamp: "2026-08-29T12:00:00.000Z",
      });

      expect(defect.id).toBe("DEFECT-TEST-001");
      expect(defect.title).toBe(
        "exactOptionalPropertyTypes type mismatch in reporting/time-telemetry/collector.ts",
      );
      expect(defect.severity).toBe("critical");
      expect(defect.status).toBe("resolved");
      expect(defect.observation).toBe("Custom observation text");
      expect(defect.remediation).toBe("Custom remediation steps");
      expect(defect.timestamp).toBe("2026-08-29T12:00:00.000Z");
      expect(defect.context?.target).toBe("reporting/time-telemetry/collector.ts");
      expect(defect.context?.property).toBe("timezone");
      expect(defect.context?.issuesCount).toBe(1);
    });
  });
});
