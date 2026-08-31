import { afterAll, describe, expect, test } from "bun:test";
import { checkLiteralFallbacks } from "../../../olt/scripts/src/health/fallbacks.ts";
import { cleanupTempRoots, sourceOf } from "../fixture.ts";

afterAll(cleanupTempRoots);

function details(text: string): string[] {
  return checkLiteralFallbacks([sourceOf("sample.ts", text)]).findings.map((entry) => entry.detail);
}

describe("Health Checks - Plausible Literal Fallbacks", () => {
  describe("a plausible literal standing in for a value nobody had", () => {
    test("the file path the submission never observed is reported", () => {
      expect(details('const files = observed ?? "src/index.ts";')[0]).toContain("src/index.ts");
    });

    test("a defaulted status is reported", () => {
      expect(details('const status = completion?.status ?? "pending";')).toHaveLength(1);
    });

    test("a defaulted actor is reported, whichever operator wrote it", () => {
      expect(details('const actor = event.actor || "agent";')).toHaveLength(1);
      expect(details('const actor = event.actor ?? "agent";')).toHaveLength(1);
    });

    test("the finding quotes the expression, so the reader can find it without the line", () => {
      expect(details('const mime = props.mimeType || "image/png";')[0]).toContain(
        '`props.mimeType || "image/png"`',
      );
    });
  });

  describe("rendering an absence as an absence is not a fabrication", () => {
    test("the empty string, a dash and a question mark are not values", () => {
      expect(details('const a = x ?? ""; const b = y ?? "-"; const c = z ?? "?";')).toEqual([]);
    });

    test("a marker word is not a value", () => {
      expect(
        details(
          'const a = x ?? "unknown"; const b = y ?? "none recorded"; const c = z ?? "No summary";',
        ),
      ).toEqual([]);
    });

    test("an admission mid-phrase is still an admission", () => {
      expect(details('const at = grant.released_at ?? "an unrecorded time";')).toEqual([]);
    });

    test("a decorated marker is still a marker", () => {
      expect(details('const list = joined || "`none`";')).toEqual([]);
    });

    test("a placeholder the reader fills in is not a claim", () => {
      expect(details('const agent = subTask.agent_id ?? "<AGENT>";')).toEqual([]);
    });
  });

  describe("a measurement that was never taken must not read as zero", () => {
    test("token counts and byte counts are reported", () => {
      expect(details("const input = hostTokens.inputTokens ?? 0;")).toHaveLength(1);
      expect(details("const size = cmd.logs?.stdout?.bytes ?? 0;")).toHaveLength(1);
      expect(details("const code = attempt.exitCode ?? 0;")).toHaveLength(1);
    });

    test("a bound is a policy, not a reading", () => {
      expect(details("const cap = limits.maxBytes ?? 64 * 1024;")).toEqual([]);
      expect(details("const grace = options.graceSeconds ?? 30;")).toEqual([]);
    });

    test("a count with no measurement word on the left is not judged", () => {
      expect(details("const index = position ?? 0;")).toEqual([]);
    });

    test("the finding says the reading was never taken", () => {
      expect(details("const spent = usage ?? 0;")[0]).toContain("never taken");
    });
  });

  describe("the sweep reads code, not prose", () => {
    test("a fallback inside a comment is not production behaviour", () => {
      expect(details('// const files = observed ?? "src/index.ts";')).toEqual([]);
    });

    test("the check reports what it cannot see", () => {
      const result = checkLiteralFallbacks([sourceOf("a.ts", "const a = 1;")]);
      expect(result.findings).toEqual([]);
      expect(result.scanned).toBe(1);
      expect(result.limitations.join(" ")).toContain("ternary");
    });
  });
});
