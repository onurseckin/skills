import { describe, expect, test } from "bun:test";
import {
  applicableValidatorDomains,
  isValidatorDomain,
} from "../../../orchestrating-long-tasks/scripts/src/contracts/workflow.ts";

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
});
