import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseScenarioMarkdown } from "./scenario-loader.test.ts";

describe("Recovery-Pressure Scenario Contract Verification (RP-1..RP-6)", () => {
  const markdownPath = join(import.meta.dir, "recovery-pressure.md");
  const content = readFileSync(markdownPath, "utf-8");
  const spec = parseScenarioMarkdown(content);

  it("RP-1: distinguishes observed idle/wall timeout from inferred network cause", () => {
    expect(spec.assertions.some((a) => a.id === "RP-1")).toBe(true);
    expect(content).toContain("RP-1");
    expect(content).toContain("Distinguish an observed timeout from an inferred network cause");
    expect(content).toContain("15 minutes of silence proves an idle timeout");
  });

  it("RP-2: expires stale leases without accepting unauthenticated late mutations", () => {
    expect(spec.assertions.some((a) => a.id === "RP-2")).toBe(true);
    expect(content).toContain("RP-2");
    expect(content).toContain("Expire stale leases without accepting late mutation");
    expect(content).toContain("impl-2");
    expect(content).toContain("late_result_rejected");
  });

  it("RP-3: produces an exact executable handoff artifact with concrete commands", () => {
    expect(spec.assertions.some((a) => a.id === "RP-3")).toBe(true);
    expect(content).toContain("RP-3");
    expect(content).toContain("handoff.md");
    expect(content).toContain("doctor");
    expect(content).toContain("handoff");
  });

  it("RP-4: keeps exhausted bounded retries failed or escalated", () => {
    expect(spec.assertions.some((a) => a.id === "RP-4")).toBe(true);
    expect(content).toContain("RP-4");
    expect(content).toContain("retry_exhausted");
    expect(content).toContain("Keep exhausted retries failed or escalated");
  });

  it("RP-5: never fabricates missing history or completion events", () => {
    expect(spec.assertions.some((a) => a.id === "RP-5")).toBe(true);
    expect(content).toContain("RP-5");
    expect(content).toContain("Never fabricate missing history");
    expect(content).toContain("projection-recover");
  });

  it("RP-6: excludes prior validator notes from a fresh validator authoritative packet", () => {
    expect(spec.assertions.some((a) => a.id === "RP-6")).toBe(true);
    expect(content).toContain("RP-6");
    expect(content).toContain(
      "Exclude prior validator notes from a fresh validator's authoritative packet",
    );
    expect(content).toContain("quarantined");
  });
});
