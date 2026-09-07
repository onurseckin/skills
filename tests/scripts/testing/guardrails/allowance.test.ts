import { describe, expect, it } from "bun:test";
import {
  buildAuditResult,
  buildPurityAllowance,
  parsePurityAllowance,
  partitionByAllowance,
  resolveAllowance,
  type PurityAllowance,
  type PurityViolation,
} from "../../../../scripts/testing/guardrails/index.ts";

const BASELINED_FILE = "tests/docs/architecture/structure.test.ts";
const FRESH_FILE = "tests/docs/architecture/newcomer.test.ts";

function violation(file: string, rule: string, line: number): PurityViolation {
  return {
    file,
    line,
    column: 1,
    category: "filesystem",
    rule,
    message: `Prohibited physical filesystem call at line ${String(line)}.`,
  };
}

function repeat(file: string, rule: string, count: number): PurityViolation[] {
  return Array.from({ length: count }, (_unused, index) => violation(file, rule, index + 1));
}

function allowanceOf(file: string, rule: string, count: number): PurityAllowance {
  return buildPurityAllowance([{ file, rule, count }]);
}

const FOURTEEN = allowanceOf(BASELINED_FILE, "no-physical-fs-call", 14);

describe("purity allowance - the four states of a baselined file", () => {
  it("lands a zero-delta edit to a baselined file that is blocked without an allowance", () => {
    const observed = repeat(BASELINED_FILE, "no-physical-fs-call", 14);

    const withoutAllowance = buildAuditResult(1, observed, "explicit", 1);
    const withAllowance = buildAuditResult(1, observed, "explicit", 1, FOURTEEN);

    expect(withoutAllowance.passed).toBe(false);
    expect(withAllowance.passed).toBe(true);
    expect(withAllowance.blockingViolations).toHaveLength(0);
    expect(withAllowance.toleratedViolations).toHaveLength(14);
    expect(withAllowance.terminalReport).toContain("14 pre-existing baselined violation(s)");
  });

  it("blocks the fifteenth violation in a file whose baseline allows fourteen", () => {
    const observed = repeat(BASELINED_FILE, "no-physical-fs-call", 15);
    const result = buildAuditResult(1, observed, "explicit", 1, FOURTEEN);

    expect(result.passed).toBe(false);
    expect(result.blockingViolations).toHaveLength(15);
    expect(result.exceedances).toEqual([
      { file: BASELINED_FILE, rule: "no-physical-fs-call", observed: 15, allowed: 14 },
    ]);
    expect(result.terminalReport).toContain(BASELINED_FILE);
    expect(result.terminalReport).toContain("observed 15 > allowed 14");
  });

  it("blocks a single violation in a brand-new file that the baseline never mentions", () => {
    const observed = [violation(FRESH_FILE, "no-physical-fs-call", 7)];
    const result = buildAuditResult(1, observed, "explicit", 1, FOURTEEN);

    expect(result.passed).toBe(false);
    expect(result.blockingViolations).toHaveLength(1);
    expect(result.exceedances).toEqual([
      { file: FRESH_FILE, rule: "no-physical-fs-call", observed: 1, allowed: 0 },
    ]);
  });

  it("lands a partial improvement that leaves eleven of fourteen violations resolved", () => {
    const observed = repeat(BASELINED_FILE, "no-physical-fs-call", 3);
    const result = buildAuditResult(1, observed, "explicit", 1, FOURTEEN);

    expect(result.passed).toBe(true);
    expect(result.toleratedViolations).toHaveLength(3);
    expect(result.exceedances).toHaveLength(0);
  });
});

describe("purity allowance - per rule isolation", () => {
  it("blocks only the rule that exceeded its allowance and tolerates the rest of the file", () => {
    const allowance = buildPurityAllowance([
      { file: BASELINED_FILE, rule: "no-physical-fs-call", count: 14 },
      { file: BASELINED_FILE, rule: "no-physical-fs-import", count: 1 },
    ]);
    const observed = [
      ...repeat(BASELINED_FILE, "no-physical-fs-call", 14),
      ...repeat(BASELINED_FILE, "no-physical-fs-import", 2),
    ];
    const tolerance = partitionByAllowance(observed, allowance);

    expect(tolerance.blocking).toHaveLength(2);
    expect(tolerance.blocking.every((entry) => entry.rule === "no-physical-fs-import")).toBe(true);
    expect(tolerance.tolerated).toHaveLength(14);
    expect(tolerance.exceedances).toEqual([
      { file: BASELINED_FILE, rule: "no-physical-fs-import", observed: 2, allowed: 1 },
    ]);
  });

  it("grants no allowance across two files that share a rule name", () => {
    const observed = [violation(FRESH_FILE, "no-physical-fs-call", 1)];
    const tolerance = partitionByAllowance(observed, FOURTEEN);

    expect(tolerance.blocking).toHaveLength(1);
    expect(tolerance.tolerated).toHaveLength(0);
  });
});

describe("purity allowance - scope and strictness reachability", () => {
  it("withholds the allowance from the whole-repository backlog gate", () => {
    const allowance = resolveAllowance(
      { scope: "repository", files: [BASELINED_FILE] },
      { all: true, allowance: FOURTEEN },
    );
    expect(allowance.size).toBe(0);
  });

  it("withholds the allowance whenever a caller asks for strict zero tolerance", () => {
    const allowance = resolveAllowance(
      { scope: "explicit", files: [BASELINED_FILE] },
      { files: [BASELINED_FILE], strict: true, allowance: FOURTEEN },
    );
    expect(allowance.size).toBe(0);
  });

  it("grants the allowance to the staged and changed scopes that gate a commit", () => {
    const staged = resolveAllowance(
      { scope: "staged", files: [BASELINED_FILE] },
      {
        stagedOnly: true,
        allowance: FOURTEEN,
      },
    );
    const explicit = resolveAllowance(
      { scope: "explicit", files: [BASELINED_FILE] },
      {
        files: [BASELINED_FILE],
        allowance: FOURTEEN,
      },
    );

    expect(staged.get(`${BASELINED_FILE} no-physical-fs-call`)).toBe(14);
    expect(explicit.get(`${BASELINED_FILE} no-physical-fs-call`)).toBe(14);
  });
});

describe("purity allowance - vacuity still dominates", () => {
  it("refuses to call an audit that examined nothing a pass however large the allowance", () => {
    const result = buildAuditResult(0, [], "explicit", 0, FOURTEEN);
    expect(result.passed).toBe(false);
    expect(result.vacuous).toBe(true);
  });

  it("refuses to pass an explicit audit whose files were all unreadable", () => {
    const result = buildAuditResult(0, [], "explicit", 3, FOURTEEN);
    expect(result.passed).toBe(false);
    expect(result.vacuous).toBe(true);
  });
});

describe("purity allowance - baseline document contract", () => {
  it("reads the committed baseline document into per file and rule counts", () => {
    const document = [
      JSON.stringify({ schema: "olt-purity-baseline/v1" }),
      JSON.stringify({ file: BASELINED_FILE, rule: "no-physical-fs-call", count: 14 }),
      JSON.stringify({ file: BASELINED_FILE, rule: "no-physical-fs-import", count: 1 }),
      "",
    ].join("\n");

    const allowance = parsePurityAllowance(document);

    expect(allowance.get(`${BASELINED_FILE} no-physical-fs-call`)).toBe(14);
    expect(allowance.get(`${BASELINED_FILE} no-physical-fs-import`)).toBe(1);
    expect(allowance.get(`${FRESH_FILE} no-physical-fs-call`)).toBeUndefined();
  });

  it("rejects a baseline document carrying a foreign schema instead of trusting it", () => {
    const document = JSON.stringify({ schema: "someone-elses-baseline/v9" });
    expect(() => parsePurityAllowance(document)).toThrow("stale or missing schema");
  });
});
