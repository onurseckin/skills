import { describe, expect, test } from "bun:test";
import {
  applicableValidatorDomains,
  isCoordinatorPushback,
  isCoordinatorPushbackCause,
  isMicroCycleRecord,
  isStructuredFinding,
  isValidatorDomain,
  textSignalsUiDomain,
  uiDomainApplies,
  type CoordinatorPushback,
  type Finding,
  type MicroCycleRecord,
} from "../../olt/scripts/src/core/contracts/index.ts";

describe("isValidatorDomain", () => {
  test("recognizes the known domains and rejects anything else", () => {
    expect(isValidatorDomain("code-quality")).toBeTrue();
    expect(isValidatorDomain("security")).toBeTrue();
    expect(isValidatorDomain("made-up-domain")).toBeFalse();
  });
});

describe("applicableValidatorDomains", () => {
  test("always includes code-quality, even for an empty write scope", () => {
    expect(applicableValidatorDomains([])).toEqual(["code-quality"]);
  });

  test("adds ui-design for a UI file extension, case-insensitively", () => {
    expect(applicableValidatorDomains(["src/Button.TSX"])).toEqual(["code-quality", "ui-design"]);
    expect(applicableValidatorDomains(["styles/theme.scss"])).toContain("ui-design");
  });

  test("adds system-design for a schema-ish extension or a path marker", () => {
    expect(applicableValidatorDomains(["api/schema.graphql"])).toEqual([
      "code-quality",
      "system-design",
    ]);
    expect(applicableValidatorDomains(["db/migrations/001_init.sql"])).toContain("system-design");
    expect(applicableValidatorDomains(["src/contracts/agents.ts"])).toContain("system-design");
  });

  test("can add both ui-design and system-design from a mixed write scope", () => {
    const domains = applicableValidatorDomains(["src/Button.tsx", "api/schema.proto"]);
    expect(domains).toEqual(["code-quality", "system-design", "ui-design"]);
  });

  test("adds neither for a plain backend file with no markers", () => {
    expect(applicableValidatorDomains(["src/services/auth.ts"])).toEqual(["code-quality"]);
  });

  // QUEUE-5: classification must not key on write_scope extensions alone. A real run had a task
  // named for dual-channel UI validation declare write_scope ["src/types/dsa.ts"] — no UI
  // extension, no UI directory marker — and its own UI mandate never fired. Requirement text (the
  // task's own words about what it is) is the second signal that catches this.
  test("adds ui-design from requirement text alone, when write_scope carries no UI marker", () => {
    expect(applicableValidatorDomains(["src/types/dsa.ts"])).toEqual(["code-quality"]);
    expect(
      applicableValidatorDomains(["src/types/dsa.ts"], ["Verify the UI screenshot proof"]),
    ).toEqual(["code-quality", "ui-design"]);
  });

  test("ignores empty or non-matching requirement text", () => {
    expect(applicableValidatorDomains(["src/services/auth.ts"], [])).toEqual(["code-quality"]);
    expect(applicableValidatorDomains(["src/services/auth.ts"], ["Fix the retry backoff"])).toEqual(
      ["code-quality"],
    );
  });
});

describe("textSignalsUiDomain", () => {
  test("recognizes UI vocabulary case-insensitively without over-matching similar words", () => {
    expect(textSignalsUiDomain(["Capture a SCREENSHOT of the dashboard"])).toBeTrue();
    expect(textSignalsUiDomain(["Verify the responsive layout on mobile"])).toBeTrue();
    expect(textSignalsUiDomain(["Run the Dual-Channel Validator Protocol"])).toBeTrue();
    // "domain" and "custom" must not match the bare-word "dom"/"ui" markers.
    expect(textSignalsUiDomain(["Migrate the domain model to a custom adapter"])).toBeFalse();
    expect(textSignalsUiDomain([])).toBeFalse();
  });
});

describe("uiDomainApplies", () => {
  test("is a convenience wrapper equivalent to checking ui-design membership", () => {
    expect(uiDomainApplies(["src/Button.tsx"])).toBeTrue();
    expect(uiDomainApplies(["src/types/dsa.ts"])).toBeFalse();
    expect(uiDomainApplies(["src/types/dsa.ts"], ["a dual-channel screenshot task"])).toBeTrue();
  });
});

describe("isCoordinatorPushbackCause, isMicroCycleRecord, isStructuredFinding, and isCoordinatorPushback", () => {
  test("isCoordinatorPushbackCause validates cause", () => {
    expect(isCoordinatorPushbackCause("procedural")).toBe(true);
    expect(isCoordinatorPushbackCause("substantive")).toBe(true);
    expect(isCoordinatorPushbackCause("invalid")).toBe(false);
  });

  test("isMicroCycleRecord validates micro-cycle records", () => {
    const valid: MicroCycleRecord = {
      round: 1,
      validator_id: "val-1",
      critique: "Needs refinement",
      suggested_remediation: "Refactor logic",
      observed_defect: "Off-by-one",
      created_at: "2026-08-24T00:00:00.000Z",
      status: "open",
    };

    expect(isMicroCycleRecord(valid)).toBe(true);
    expect(isMicroCycleRecord({ ...valid, round: 0 })).toBe(false);
    expect(isMicroCycleRecord({ ...valid, validator_id: "" })).toBe(false);
    expect(isMicroCycleRecord({ ...valid, status: "closed" })).toBe(false);
    expect(isMicroCycleRecord(null)).toBe(false);
  });

  test("isStructuredFinding validates finding records", () => {
    const validFinding: Finding = {
      id: "f-1",
      requirement_id: "req-1",
      severity: "critical",
      observation: "Fatal crash",
      evidence: [],
      remediation: "Add null check",
      revalidation: "Run unit test",
      status: "open",
    };

    expect(isStructuredFinding(validFinding)).toBe(true);
    expect(isStructuredFinding({ ...validFinding, severity: "other" })).toBe(false);
    expect(isStructuredFinding({ ...validFinding, status: "closed" })).toBe(false);
    expect(isStructuredFinding({ ...validFinding, evidence: "not-array" })).toBe(false);
    expect(isStructuredFinding(null)).toBe(false);
  });

  test("isCoordinatorPushback validates pushback objects", () => {
    const validPushback: CoordinatorPushback = {
      id: "pb-1",
      validator_id: "val-1",
      domain: "code-quality",
      cause: "procedural",
      observation: "Missing evidence",
      remediation: "Attach command receipt",
      review_round: 1,
      created_at: "2026-08-24T00:00:00.000Z",
    };

    expect(isCoordinatorPushback(validPushback)).toBe(true);
    expect(isCoordinatorPushback({ ...validPushback, domain: "invalid-domain" })).toBe(false);
    expect(isCoordinatorPushback({ ...validPushback, cause: "invalid-cause" })).toBe(false);
    expect(isCoordinatorPushback(null)).toBe(false);
  });
});
