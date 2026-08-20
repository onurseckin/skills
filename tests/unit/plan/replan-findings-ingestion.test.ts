import { describe, expect, test } from "bun:test";
import {
  collectReplanFindings,
  UNREPORTED_REMEDIATION,
} from "../../../orchestrating-long-tasks/scripts/src/cli/commands/plan-replan-findings.ts";

function ingest(payload: string): ReturnType<typeof collectReplanFindings> {
  return collectReplanFindings({
    inline: payload,
    file: undefined,
    readFile: () => {
      throw new Error("no file was named");
    },
    recorded: undefined,
  });
}

const DECLARED = {
  id: "F-01",
  severity: "critical",
  observation: "Toggle handler drops its callback",
  remediation: "Restore the callback",
  file_paths: ["src/components/EdgeDrawer.tsx"],
};

describe("plan:replan findings ingestion reports only what the reporter declared", () => {
  test("carries the declared fields through untouched", () => {
    const [finding] = ingest(JSON.stringify([DECLARED]));
    expect(finding).toEqual({
      id: "F-01",
      requirement_id: undefined,
      severity: "critical",
      file_paths: ["src/components/EdgeDrawer.tsx"],
      observation: "Toggle handler drops its callback",
      remediation: "Restore the callback",
      revalidation_gate: undefined,
    });
  });

  test("refuses a finding that declares no severity", () => {
    const { severity: _omitted, ...unrated } = DECLARED;
    expect(() => ingest(JSON.stringify([unrated]))).toThrow(
      /finding F-01 must declare severity critical, important, minor, suggestion/,
    );
  });

  test("refuses a severity outside the scale rather than rounding it inward", () => {
    expect(() => ingest(JSON.stringify([{ ...DECLARED, severity: "blocker" }]))).toThrow(
      /must declare severity/,
    );
  });

  test("refuses an unparseable payload instead of reading it as one finding", () => {
    expect(() => ingest("the drawer toggle is broken")).toThrow(/not valid JSON/);
    expect(() => ingest('[{"id":"F-01",}]')).toThrow(/not valid JSON/);
  });

  test("an unreported remediation is marked absent, never prescribed", () => {
    const { remediation: _unreported, ...silent } = DECLARED;
    const [finding] = ingest(JSON.stringify([silent]));
    expect(finding!.remediation).toBe(UNREPORTED_REMEDIATION);
  });

  test("recorded review findings are read when the caller supplies none", () => {
    const findings = collectReplanFindings({
      inline: undefined,
      file: undefined,
      readFile: () => {
        throw new Error("no file was named");
      },
      recorded: { findings: [{ ...DECLARED, severity: "minor" }] },
    });
    expect(findings.map((entry) => entry.severity)).toEqual(["minor"]);
  });
});
