import { describe, expect, test } from "bun:test";
import {
  collectReplanFindings,
  UNREPORTED_REMEDIATION,
} from "../../../olt/scripts/src/cli/commands/plan-replan-findings.ts";
import { createSampleFinding, createSampleOpenTaskFinding, REPLAN_SUITES } from "./index.ts";

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

const DECLARED = createSampleFinding();

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

  test("a recorded finding's `revalidation` field resolves the repair gate on its own", () => {
    const findings = collectReplanFindings({
      inline: undefined,
      file: undefined,
      readFile: () => {
        throw new Error("no file was named");
      },
      recorded: { findings: [{ ...DECLARED, revalidation: "bun gate-t1.ts" }] },
    });
    expect(findings[0]!.revalidation_gate).toBe("bun gate-t1.ts");
  });

  describe("validator findings recorded via task:reject", () => {
    const OPEN_TASK_FINDING = createSampleOpenTaskFinding();

    test("an open task finding is picked up when nothing else is supplied", () => {
      const findings = collectReplanFindings({
        inline: undefined,
        file: undefined,
        readFile: () => {
          throw new Error("no file was named");
        },
        recorded: undefined,
        tasks: { "task-1": { findings: [OPEN_TASK_FINDING] } },
      });
      expect(findings).toHaveLength(1);
      expect(findings[0]!.id).toBe("F-VALIDATOR-01");
      expect(findings[0]!.revalidation_gate).toBe("bun gate-t1.ts");
    });

    test("a resolved task finding is excluded — only status: open is replan fodder", () => {
      const findings = collectReplanFindings({
        inline: undefined,
        file: undefined,
        readFile: () => {
          throw new Error("no file was named");
        },
        recorded: undefined,
        tasks: {
          "task-1": { findings: [{ ...OPEN_TASK_FINDING, status: "resolved" }] },
        },
      });
      expect(findings).toEqual([]);
    });

    test("critic-recorded findings and open task findings combine into one pool", () => {
      const findings = collectReplanFindings({
        inline: undefined,
        file: undefined,
        readFile: () => {
          throw new Error("no file was named");
        },
        recorded: { findings: [{ ...DECLARED, severity: "minor" }] },
        tasks: { "task-2": { findings: [OPEN_TASK_FINDING] } },
      });
      expect(findings.map((f) => f.id)).toEqual(["F-01", "F-VALIDATOR-01"]);
    });

    test("tolerates a missing, non-object, or task-less tasks value", () => {
      const readFile = (): string => {
        throw new Error("no file was named");
      };
      const base = { inline: undefined, file: undefined, readFile, recorded: undefined } as const;
      expect(collectReplanFindings(base)).toEqual([]);
      expect(collectReplanFindings({ ...base, tasks: "not-an-object" })).toEqual([]);
      expect(collectReplanFindings({ ...base, tasks: { "task-1": "not-an-object" } })).toEqual([]);
      expect(
        collectReplanFindings({ ...base, tasks: { "task-1": { findings: "not-an-array" } } }),
      ).toEqual([]);
      expect(REPLAN_SUITES.length).toBe(1);
    });
  });
});
