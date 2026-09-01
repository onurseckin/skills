import { createHash } from "node:crypto";
import { HarnessError } from "../../core/errors/index.ts";
import type {
  SyntheticFixtureType,
  SyntheticFixture,
  SchemaFieldRule,
  PayloadSchema,
} from "./types.ts";

export function computePayloadSha256(payload: unknown): string {
  const serialized = JSON.stringify(payload, Object.keys(payload ?? {}).sort());
  return createHash("sha256")
    .update(serialized ?? "")
    .digest("hex");
}

/**
 * Built-in Canonical Fixture Factories for Common Domains
 */
export function createDashboardTelemetryFixtures(): Record<
  SyntheticFixtureType,
  SyntheticFixture<unknown>
> {
  return {
    FULLY_POPULATED: {
      type: "FULLY_POPULATED",
      description:
        "Standard full telemetry dataset with active services, rich graphs, and metrics.",
      expectedStatusCode: 200,
      payload: {
        summary: {
          totalRequests: 1482930,
          successRate: 99.98,
          avgLatencyMs: 24.5,
          activeNodes: 12,
        },
        services: [
          { id: "srv-01", name: "Auth Gateway", status: "healthy", latencyMs: 12, errorRate: 0.01 },
          { id: "srv-02", name: "API Engine", status: "healthy", latencyMs: 18, errorRate: 0.02 },
          { id: "srv-03", name: "Worker Queue", status: "degraded", latencyMs: 85, errorRate: 1.4 },
          {
            id: "srv-04",
            name: "Database Primary",
            status: "healthy",
            latencyMs: 4,
            errorRate: 0.0,
          },
        ],
        alerts: [
          { id: "alt-01", severity: "warning", message: "Worker Queue queue depth > 500 msgs" },
        ],
      },
    },
    PARTIAL_TRUNCATED: {
      type: "PARTIAL_TRUNCATED",
      description:
        "Stress test with 300-char names, special characters, unicode, and missing non-required fields.",
      expectedStatusCode: 200,
      payload: {
        summary: {
          totalRequests: 1,
          successRate: 0.0,
          avgLatencyMs: 999999.99,
          activeNodes: 0,
        },
        services: [
          {
            id: "srv-long-01",
            name: "Supercalifragilisticexpialidocious_Enterprise_Cluster_Node_Microservice_Instance_With_Extreme_Length_That_Tests_Word_Wrapping_And_Layout_Flexibility_Without_Breaking_Containers_99999999999999999",
            status: "unknown",
            latencyMs: 0,
            errorRate: 100.0,
          },
          {
            id: "srv-unicode-02",
            name: "🚀 Telemetry Engine 🔥 (東京_クラスタ_01) - 🌟 [Über-Späti-Börse]",
            status: "healthy",
            latencyMs: 5,
            errorRate: 0.0,
          },
        ],
        alerts: [],
      },
    },
    ZERO_RECORD_EMPTY: {
      type: "ZERO_RECORD_EMPTY",
      description:
        "Pristine empty state with zero services, zero alerts, and initial onboarding metrics.",
      expectedStatusCode: 200,
      payload: {
        summary: {
          totalRequests: 0,
          successRate: 100.0,
          avgLatencyMs: 0.0,
          activeNodes: 0,
        },
        services: [],
        alerts: [],
      },
    },
    CONTROLLED_SERVER_ERROR: {
      type: "CONTROLLED_SERVER_ERROR",
      description:
        "Controlled HTTP 500 Internal Server Error verifying error boundary visual composure.",
      expectedStatusCode: 500,
      payload: {
        error: "InternalServerError",
        code: 500,
        message: "Failed to query cluster telemetry database: connection pool exhausted",
        traceId: "trace-err-500-diag-992182",
      },
    },
  };
}

export function createUserManagementFixtures(): Record<
  SyntheticFixtureType,
  SyntheticFixture<unknown>
> {
  return {
    FULLY_POPULATED: {
      type: "FULLY_POPULATED",
      description: "Complete user directory with multiple roles, avatar URLs, and activity dates.",
      expectedStatusCode: 200,
      payload: {
        total: 4,
        users: [
          {
            id: "usr-01",
            name: "Alice Smith",
            email: "alice@olt.local",
            role: "admin",
            active: true,
          },
          {
            id: "usr-02",
            name: "Bob Jones",
            email: "bob@olt.local",
            role: "standard_user",
            active: true,
          },
          {
            id: "usr-03",
            name: "Carol White",
            email: "carol@olt.local",
            role: "compliance_auditor",
            active: false,
          },
          {
            id: "usr-04",
            name: "David Miller",
            email: "david@olt.local",
            role: "billing_admin",
            active: true,
          },
        ],
      },
    },
    PARTIAL_TRUNCATED: {
      type: "PARTIAL_TRUNCATED",
      description: "User with 250+ character email and international multi-byte script characters.",
      expectedStatusCode: 200,
      payload: {
        total: 1,
        users: [
          {
            id: "usr-edge-01",
            name: "Dr. Elizabeth Alexandra Mary Windsor-Smith-Smythe-Longbottom-The-Third",
            email:
              "extremely.long.corporate.enterprise.departmental.subdivision.email.address.that.exceeds.standard.column.widths@very-long-domain-name-organization-enterprise.olt.local",
            role: "standard_user",
            active: true,
          },
        ],
      },
    },
    ZERO_RECORD_EMPTY: {
      type: "ZERO_RECORD_EMPTY",
      description:
        "Empty user directory showing zero records and inviting to add first team member.",
      expectedStatusCode: 200,
      payload: {
        total: 0,
        users: [],
      },
    },
    CONTROLLED_SERVER_ERROR: {
      type: "CONTROLLED_SERVER_ERROR",
      description:
        "Controlled HTTP 503 Service Unavailable verifying graceful maintenance state banner.",
      expectedStatusCode: 503,
      payload: {
        error: "ServiceUnavailable",
        code: 503,
        message: "User Directory service is undergoing scheduled database migration.",
        retryAfterSeconds: 30,
      },
    },
  };
}

/**
 * Payload Schema Validator
 */
export function validatePayloadSchema(
  payload: unknown,
  schema: PayloadSchema,
): { valid: boolean; violations: readonly string[] } {
  const violations: string[] = [];

  if (typeof payload !== "object" || payload === null) {
    violations.push(`Payload root must be an object, received '${typeof payload}'`);
    return { valid: false, violations };
  }

  const record = payload as Record<string, unknown>;

  for (const rule of schema.rules) {
    const val = record[rule.field];

    if (val === undefined) {
      if (rule.required !== false) {
        violations.push(`Missing required field '${rule.field}' in payload.`);
      }
      continue;
    }

    if (val === null) {
      if (!rule.nullable) {
        violations.push(`Field '${rule.field}' is null but rule does not allow nullable.`);
      }
      continue;
    }

    // Type validation
    if (rule.type === "array") {
      if (!Array.isArray(val)) {
        violations.push(`Field '${rule.field}' expected array, received '${typeof val}'.`);
      } else if (rule.itemType) {
        for (let i = 0; i < val.length; i++) {
          const item = val[i];
          if (rule.itemType === "object" && (typeof item !== "object" || item === null)) {
            violations.push(`Array item at '${rule.field}[${i}]' expected object.`);
          } else if (rule.itemType !== "object" && typeof item !== rule.itemType) {
            violations.push(
              `Array item at '${rule.field}[${i}]' expected ${rule.itemType}, received ${typeof item}.`,
            );
          }
        }
      }
    } else if (typeof val !== rule.type) {
      violations.push(
        `Field '${rule.field}' expected type '${rule.type}', received '${typeof val}'.`,
      );
    }

    // String bounds
    if (typeof val === "string") {
      if (rule.minLength !== undefined && val.length < rule.minLength) {
        violations.push(
          `Field '${rule.field}' length (${val.length}) is less than minLength (${rule.minLength}).`,
        );
      }
      if (rule.maxLength !== undefined && val.length > rule.maxLength) {
        violations.push(
          `Field '${rule.field}' length (${val.length}) exceeds maxLength (${rule.maxLength}).`,
        );
      }
      if (rule.pattern) {
        const regex = typeof rule.pattern === "string" ? new RegExp(rule.pattern) : rule.pattern;
        if (!regex.test(val)) {
          violations.push(`Field '${rule.field}' does not match required pattern ${regex.source}.`);
        }
      }
    }

    // Number bounds
    if (typeof val === "number") {
      if (rule.min !== undefined && val < rule.min) {
        violations.push(`Field '${rule.field}' value (${val}) is less than min (${rule.min}).`);
      }
      if (rule.max !== undefined && val > rule.max) {
        violations.push(`Field '${rule.field}' value (${val}) exceeds max (${rule.max}).`);
      }
    }

    // Nested object rules
    if (typeof val === "object" && val !== null && !Array.isArray(val) && rule.nestedRules) {
      const nestedResult = validatePayloadSchema(val, {
        name: `${schema.name}.${rule.field}`,
        rules: rule.nestedRules,
      });
      for (const nestedViolation of nestedResult.violations) {
        violations.push(`${rule.field}.${nestedViolation}`);
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Headless Mechanic Data-Layer Pre-Flight Certifier
 */
