/**
 * Defect Remediation: Type mismatches with exactOptionalPropertyTypes in autonomic-watchdog and time-telemetry
 * Defect Ref: defect-exact-optional-property-types-in-watchdog-and-telemetry
 * Error Code: EXACT_OPTIONAL_PROPERTY_TYPE_MISMATCH
 *
 * Invariant:
 * When exactOptionalPropertyTypes is enabled in tsconfig, passing { prop: undefined } or
 * spreading undefined fields into optional properties typed as 'T | undefined' violates
 * strict property assignment rules (TS2412, TS2379). Optional properties must either be
 * omitted entirely or explicitly assigned a defined value of the target type.
 */

import type { DefectCategory, DefectEntry, DefectSeverity, DefectStatus, DefectType } from "../mind/contracts/defect-contracts.ts";
import type {
  AdaptiveTimerConfig,
  AdaptiveTimerState,
  AutonomicWatchdogConfig,
  ReactiveEvent,
  WatchdogFinding,
  WatchdogHealthAuditReport,
  WatchdogTickReport,
} from "../watchdog/types.ts";
import type {
  HarnessActionCategory,
  StartActionSpanOptions,
} from "../reporting/time-telemetry/types.ts";
import type { DualTimeRecord } from "../core/dual-time/index.ts";
import type { JsonValue } from "../core/contracts/index.ts";

export const DEFECT_REF = "defect-exact-optional-property-types-in-watchdog-and-telemetry" as const;
export const DEFECT_ERROR_CODE = "EXACT_OPTIONAL_PROPERTY_TYPE_MISMATCH" as const;
export const EXACT_OPTIONAL_PROPERTY_TYPE_MISMATCH = DEFECT_ERROR_CODE;

export interface ExactOptionalIssue {
  readonly property: string;
  readonly path: string;
  readonly value: undefined;
  readonly message: string;
}

export interface ExactOptionalAuditOptions {
  readonly objectName?: string | undefined;
  readonly deep?: boolean | undefined;
}

export interface ExactOptionalAuditResult<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly valid: boolean;
  readonly defectRef: typeof DEFECT_REF;
  readonly errorCode: typeof DEFECT_ERROR_CODE;
  readonly objectName?: string | undefined;
  readonly issues: readonly ExactOptionalIssue[];
  readonly undefinedPropertyCount: number;
  readonly undefinedProperties: readonly string[];
  readonly sanitized: T;
}

export interface SanitizeExactOptionalOptions {
  readonly deep?: boolean | undefined;
  readonly removeNull?: boolean | undefined;
}

export interface ExactOptionalPropertyErrorOptions {
  readonly code?: string | undefined;
  readonly defectRef?: string | undefined;
  readonly property?: string | undefined;
  readonly targetObject?: string | undefined;
  readonly issues?: readonly ExactOptionalIssue[] | undefined;
}

export class ExactOptionalPropertyError extends Error {
  readonly code: string;
  readonly defectRef: string;
  readonly property?: string | undefined;
  readonly targetObject?: string | undefined;
  readonly issues: readonly ExactOptionalIssue[];

  constructor(message: string, options?: ExactOptionalPropertyErrorOptions) {
    super(message);
    this.name = "ExactOptionalPropertyError";
    this.code = options?.code ?? DEFECT_ERROR_CODE;
    this.defectRef = options?.defectRef ?? DEFECT_REF;
    this.property = options?.property;
    this.targetObject = options?.targetObject;
    this.issues = options?.issues ?? [];
    Object.setPrototypeOf(this, ExactOptionalPropertyError.prototype);
  }
}

/**
 * Sanitizes an object by omitting all properties whose values are explicitly `undefined`.
 * When deep is true, recursively sanitizes nested objects and arrays.
 */
export function sanitizeExactOptionalProperties<T extends Record<string, unknown>>(
  input: T,
  options?: SanitizeExactOptionalOptions,
): T {
  if (input === null || typeof input !== "object") {
    return input;
  }

  const deep = options?.deep ?? false;
  const removeNull = options?.removeNull ?? false;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }
    if (removeNull && value === null) {
      continue;
    }

    if (deep && value !== null && typeof value === "object") {
      if (Array.isArray(value)) {
        result[key] = value.map((item: unknown) => {
          if (item !== null && typeof item === "object" && !Array.isArray(item) && !(item instanceof Date) && !(item instanceof RegExp)) {
            return sanitizeExactOptionalProperties(item as Record<string, unknown>, options);
          }
          return item;
        });
      } else if (!(value instanceof Date) && !(value instanceof RegExp)) {
        result[key] = sanitizeExactOptionalProperties(value as Record<string, unknown>, options);
      } else {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }

  return result as unknown as T;
}

/**
 * Audits an object for properties explicitly set to `undefined`, which violate `exactOptionalPropertyTypes`.
 */
export function auditObjectExactOptionalProperties<T extends Record<string, unknown>>(
  target: T,
  options?: ExactOptionalAuditOptions,
): ExactOptionalAuditResult<T> {
  const issues: ExactOptionalIssue[] = [];
  const deep = options?.deep ?? false;
  const prefix = options?.objectName;

  function collectIssues(obj: Record<string, unknown>, currentPathPrefix?: string): void {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      const propertyPath = currentPathPrefix ? `${currentPathPrefix}.${key}` : key;
      if (val === undefined) {
        issues.push({
          property: key,
          path: propertyPath,
          value: undefined,
          message: `Property '${propertyPath}' is explicitly assigned undefined under exactOptionalPropertyTypes.`,
        });
      } else if (deep && val !== null && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date) && !(val instanceof RegExp)) {
        collectIssues(val as Record<string, unknown>, propertyPath);
      }
    }
  }

  if (target !== null && typeof target === "object") {
    collectIssues(target, prefix);
  }

  const sanitized = sanitizeExactOptionalProperties(target, { deep });
  const undefinedProperties = issues.map((i) => i.property);

  return {
    valid: issues.length === 0,
    defectRef: DEFECT_REF,
    errorCode: DEFECT_ERROR_CODE,
    objectName: options?.objectName,
    issues,
    undefinedPropertyCount: issues.length,
    undefinedProperties,
    sanitized,
  };
}

/**
 * Validates that an object contains no explicit `undefined` properties, throwing `ExactOptionalPropertyError` if invalid.
 */
export function assertExactOptionalSafe<T extends Record<string, unknown>>(
  target: T,
  objectName?: string,
): void {
  const audit = auditObjectExactOptionalProperties(target, { objectName, deep: true });
  if (!audit.valid) {
    const firstIssue = audit.issues[0];
    throw new ExactOptionalPropertyError(
      `ExactOptionalPropertyType violation in ${objectName ?? "object"}: ${audit.undefinedPropertyCount} property(ies) set to undefined (${audit.undefinedProperties.join(", ")})`,
      {
        property: firstIssue?.property,
        targetObject: objectName,
        issues: audit.issues,
      },
    );
  }
}

/**
 * Checks whether an object is exact-optional safe (no undefined properties).
 */
export function isExactOptionalSafe<T extends Record<string, unknown>>(
  target: T,
  deep = false,
): boolean {
  return auditObjectExactOptionalProperties(target, { deep }).valid;
}

/**
 * Creates an AutonomicWatchdogConfig with all undefined properties stripped out,
 * ensuring compliance with exactOptionalPropertyTypes (TS2412).
 */
export function createExactOptionalSafeWatchdogConfig(
  rawConfig?: Partial<AutonomicWatchdogConfig> | Record<string, unknown>,
): AutonomicWatchdogConfig {
  if (!rawConfig) {
    return {};
  }

  const sanitized = sanitizeExactOptionalProperties(rawConfig as Record<string, unknown>, { deep: true });

  if (typeof sanitized.adaptive === "object" && sanitized.adaptive !== null) {
    const safeAdaptive = sanitizeExactOptionalProperties(
      sanitized.adaptive as Record<string, unknown>,
      { deep: false },
    );
    return {
      ...sanitized,
      adaptive: safeAdaptive as AdaptiveTimerConfig,
    } as AutonomicWatchdogConfig;
  }

  return sanitized as AutonomicWatchdogConfig;
}

/**
 * Creates a StartActionSpanOptions with all undefined properties stripped out,
 * ensuring compliance with exactOptionalPropertyTypes (TS2379).
 */
export function createExactOptionalSafeSpanOptions(
  rawOptions?: Partial<StartActionSpanOptions> | Record<string, unknown>,
): StartActionSpanOptions {
  if (!rawOptions) {
    return {};
  }

  const sanitized = sanitizeExactOptionalProperties(rawOptions as Record<string, unknown>, { deep: false });
  return sanitized as StartActionSpanOptions;
}

export interface CreateExactOptionalPropertyDefectOptions {
  readonly id?: string | undefined;
  readonly target?: string | undefined;
  readonly property?: string | undefined;
  readonly issues?: readonly ExactOptionalIssue[] | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly status?: DefectStatus | string | undefined;
  readonly severity?: DefectSeverity | string | undefined;
  readonly timestamp?: string | undefined;
  readonly context?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Generates a standardized DefectEntry for exactOptionalPropertyTypes mismatch defects.
 */
export function createExactOptionalPropertyDefect(
  options: CreateExactOptionalPropertyDefectOptions = {},
): DefectEntry {
  const issues = options.issues ?? [];
  const target = options.target ?? "watchdog/telemetry";
  const property = options.property ?? (issues.length > 0 ? issues[0]?.property : undefined);

  const issueContext = issues.map((i) => ({
    property: i.property,
    path: i.path,
    message: i.message,
  }));

  const observation =
    options.observation ??
    (issues.length > 0
      ? `Detected ${issues.length} property assignment(s) explicitly passing undefined under exactOptionalPropertyTypes in ${target}`
      : `Property '${property ?? "unknown"}' in ${target} was assigned undefined, triggering TS2412/TS2379.`);

  const remediation =
    options.remediation ??
    "Omit properties with undefined values using sanitizeExactOptionalProperties, createExactOptionalSafeWatchdogConfig, or createExactOptionalSafeSpanOptions.";

  return {
    id: options.id ?? `${DEFECT_REF}-${Date.now()}`,
    domain: "tooling",
    error_code: DEFECT_ERROR_CODE,
    title: `exactOptionalPropertyTypes type mismatch in ${target}`,
    description: `Exact optional property type mismatch remediation for ${target}: explicit undefined assigned to optional property`,
    message: observation,
    status: options.status ?? "open",
    type: "TYPE_DRIFT" as DefectType,
    category: "code_defect" as DefectCategory,
    severity: (options.severity as DefectSeverity) ?? "high",
    observation,
    remediation,
    context: {
      defectReference: DEFECT_REF,
      errorCode: DEFECT_ERROR_CODE,
      target,
      property: property ?? "unknown",
      issuesCount: issues.length,
      issues: issueContext,
      ...(options.context ?? {}),
    },
    timestamp: options.timestamp ?? new Date().toISOString(),
  };
}
