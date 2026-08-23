import { describe, expect, test } from "bun:test";
import {
  applicableValidatorDomains,
  isValidatorDomain,
  textSignalsUiDomain,
  uiDomainApplies,
} from "../../../olt/scripts/src/core/contracts/workflow.ts";

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
