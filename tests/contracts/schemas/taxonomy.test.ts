import { describe, expect, test } from "bun:test";
import {
  isAgentGrantRecord,
  isAgentToolRef,
  type AgentGrantRecord,
} from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  isCategoryExtras,
  isKnownToolCategory,
  isToolCategory,
  TOOL_CATEGORIES,
} from "../../../olt/scripts/src/core/contracts/index.ts";

export const taxonomySuiteName = "the tool category and telemetry taxonomy vocabulary";

function grant(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "worker-1",
    role: "implementer",
    parent_agent_id: null,
    parent_task_id: null,
    host: "some-host",
    granted_at: "2026-08-19T10:00:00.000Z",
    status: "active",
    ...extra,
  };
}

describe(taxonomySuiteName, () => {
  describe("the tool category vocabulary", () => {
    test("seeds the kinds of tool a run can name", () => {
      expect(TOOL_CATEGORIES).toContain("browser-automation");
      expect(TOOL_CATEGORIES).toContain("test-runner");
      expect(TOOL_CATEGORIES).toContain("version-control");
      expect(isKnownToolCategory("linter")).toBeTrue();
    });

    test("stays open: a category nobody has seen is valid and simply unrecognised", () => {
      expect(isKnownToolCategory("model-evaluation")).toBeFalse();
      expect(isToolCategory("model-evaluation")).toBeTrue();
    });

    test("a blank or non-string category is not a category at all", () => {
      for (const value of ["", "   ", 7, null, undefined, ["linter"]]) {
        expect(isToolCategory(value)).toBeFalse();
        expect(isKnownToolCategory(value)).toBeFalse();
      }
    });

    test("extras are an open object and nothing else", () => {
      expect(isCategoryExtras({ traceFormat: "zip" })).toBeTrue();
      expect(isCategoryExtras({})).toBeTrue();
      expect(isCategoryExtras(["zip"])).toBeFalse();
      expect(isCategoryExtras("zip")).toBeFalse();
      expect(isCategoryExtras(null)).toBeFalse();
    });
  });

  describe("a tool as it is recorded", () => {
    test("needs a name; the category and the extras are optional", () => {
      expect(isAgentToolRef({ name: "Read" })).toBeTrue();
      expect(isAgentToolRef({ name: "Read", category: "file-edit" })).toBeTrue();
      expect(isAgentToolRef({ name: "Read", extras: { mode: "text" } })).toBeTrue();
      expect(isAgentToolRef({ name: "  " })).toBeFalse();
      expect(isAgentToolRef({ category: "file-edit" })).toBeFalse();
      expect(isAgentToolRef("Read")).toBeFalse();
    });

    test("rejects a category or an extras bag of the wrong shape", () => {
      expect(isAgentToolRef({ name: "Read", category: "" })).toBeFalse();
      expect(isAgentToolRef({ name: "Read", extras: "mode=text" })).toBeFalse();
    });
  });

  describe("the grant record carries the whole telemetry taxonomy", () => {
    test("accepts a grant with provider, context window, tool refs and extra counters", () => {
      const record = grant({
        provider: { value: "some-provider", evidence_class: "host_reported" },
        model: { value: "a-model-id", evidence_class: "host_reported" },
        context_window: { value: 200000, evidence_class: "host_reported" },
        tools_granted: {
          value: [{ name: "Read", category: "file-edit", extras: { mode: "text" } }],
          evidence_class: "agent_reported",
        },
        tools_used: [
          {
            name: "Read",
            category: "file-edit",
            evidence_class: "agent_reported",
            first_reported_at: "2026-08-19T10:01:00.000Z",
          },
        ],
        token_extras: { cache_read: { value: 91000, evidence_class: "host_reported" } },
      });
      expect(isAgentGrantRecord(record)).toBeTrue();
    });

    test("refuses a provider, context window or counter that is not what it claims", () => {
      expect(
        isAgentGrantRecord(grant({ provider: { value: 1, evidence_class: "host_reported" } })),
      ).toBeFalse();
      expect(
        isAgentGrantRecord(
          grant({ context_window: { value: 1.5, evidence_class: "host_reported" } }),
        ),
      ).toBeFalse();
      expect(isAgentGrantRecord(grant({ token_extras: { cache_read: 91000 } }))).toBeFalse();
      expect(isAgentGrantRecord(grant({ token_extras: ["cache_read"] }))).toBeFalse();
    });

    test("refuses a last_reported_at that is not a string", () => {
      expect(isAgentGrantRecord(grant({ last_reported_at: 12345 }))).toBeFalse();
    });

    test("refuses a released_at or release_reason that is not a string", () => {
      expect(isAgentGrantRecord(grant({ released_at: 12345 }))).toBeFalse();
      expect(isAgentGrantRecord(grant({ release_reason: 12345 }))).toBeFalse();
    });

    test("refuses a granted toolset that is still a bare list of names", () => {
      expect(
        isAgentGrantRecord(
          grant({ tools_granted: { value: ["Read"], evidence_class: "agent_reported" } }),
        ),
      ).toBeFalse();
    });

    test("refuses a recorded tool use with no evidence class or no first sighting", () => {
      expect(isAgentGrantRecord(grant({ tools_used: [{ name: "Read" }] }))).toBeFalse();
      expect(
        isAgentGrantRecord(
          grant({ tools_used: [{ name: "Read", evidence_class: "agent_reported" }] }),
        ),
      ).toBeFalse();
    });

    test("a grant carrying none of it is still a grant", () => {
      const record = grant();
      expect(isAgentGrantRecord(record)).toBeTrue();
      const typed = record as unknown as AgentGrantRecord;
      expect(typed.provider).toBeUndefined();
      expect(typed.token_extras).toBeUndefined();
    });
  });
});
