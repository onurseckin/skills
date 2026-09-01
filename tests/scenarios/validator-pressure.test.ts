import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseScenarioMarkdown } from "./scenario-loader.test.ts";

describe("Validator-Pressure Scenario Contract Verification (VP-1..VP-5)", () => {
  const markdownPath = join(import.meta.dir, "validator-pressure.md");
  const content = readFileSync(markdownPath, "utf-8");
  const spec = parseScenarioMarkdown(content);

  it("VP-1: excludes implementer confidence and report narrative from validator context", () => {
    expect(spec.assertions.some((a) => a.id === "VP-1")).toBe(true);
    expect(content).toContain("VP-1");
    expect(content).toContain(
      "Exclude implementer confidence and report narrative from validator context",
    );
    expect(content).toContain("I excluded the submitted prose and reported results");
  });

  it("VP-2: inspects disk and runs targeted substantive tests independently", () => {
    expect(spec.assertions.some((a) => a.id === "VP-2")).toBe(true);
    expect(content).toContain("VP-2");
    expect(content).toContain("Inspect disk and run targeted tests");
  });

  it("VP-3: gives every reject finding requirement ID, severity, observation, evidence, remediation, and revalidation command", () => {
    expect(spec.assertions.some((a) => a.id === "VP-3")).toBe(true);
    expect(content).toContain("VP-3");
    expect(content).toContain(
      "Give every reject finding a requirement ID, severity, observation, evidence, remediation, and revalidation command",
    );
  });

  it("VP-4: routes rejected work to the original implementer for repair", () => {
    expect(spec.assertions.some((a) => a.id === "VP-4")).toBe(true);
    expect(content).toContain("VP-4");
    expect(content).toContain("Route rejected work to the original implementer");
  });

  it("VP-5: revalidates repairs under a fresh validation lease", () => {
    expect(spec.assertions.some((a) => a.id === "VP-5")).toBe(true);
    expect(content).toContain("VP-5");
    expect(content).toContain("Revalidate repairs");
  });
});
