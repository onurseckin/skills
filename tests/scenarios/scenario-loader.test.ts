import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ScenarioSpec {
  readonly title: string;
  readonly prompt: string;
  readonly assertions: readonly { id: string; description: string }[];
  readonly rawBaselineResponse: string;
  readonly forwardRunResponse?: string;
  readonly forwardAssertions?: readonly { id: string; passed: boolean }[];
}

export function parseScenarioMarkdown(content: string): ScenarioSpec {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? (titleMatch[1] ?? "").trim() : "Unknown Scenario";

  const promptMatch = content.match(/## Scenario prompt\s+```text\s+([\s\S]*?)\s+```/);
  const prompt = promptMatch ? (promptMatch[1] ?? "").trim() : "";

  const assertions: { id: string; description: string }[] = [];
  const assertionSection = content.match(/## Assertions\s+([\s\S]*?)(?=\n##|$)/);
  if (assertionSection && assertionSection[1]) {
    const lines = assertionSection[1].split("\n");
    for (const line of lines) {
      const match = line.match(/^-\s+`([^`]+)`:\s*(.+)$/);
      if (match && match[1] && match[2]) {
        assertions.push({ id: match[1].trim(), description: match[2].trim() });
      }
    }
  }

  const rawBaselineMatch = content.match(
    /## Raw baseline response\s+(?:`{3,4}|~{3,4})(?:markdown)?\s+([\s\S]*?)\s+(?:`{3,4}|~{3,4})/,
  );
  const rawBaselineResponse = rawBaselineMatch ? (rawBaselineMatch[1] ?? "").trim() : "";

  const forwardMatch = content.match(
    /## Forward test[\s\S]*?#### Raw response\s+(?:`{3,4}|~{3,4})(?:markdown)?\s+([\s\S]*?)\s+(?:`{3,4}|~{3,4})/,
  );
  const forwardRunResponse = forwardMatch ? (forwardMatch[1] ?? "").trim() : undefined;

  return {
    title,
    prompt,
    assertions: Object.freeze(assertions),
    rawBaselineResponse,
    forwardRunResponse,
  };
}

export function computeScenarioDigest(payload: string): string {
  return createHash("sha256").update(payload, "utf-8").digest("hex");
}

describe("Scenario Specification Loader & Parser", () => {
  const scenarioDir = import.meta.dir;

  it("loads and parses long-prompt.md scenario with all LP assertions", () => {
    const filePath = join(scenarioDir, "long-prompt.md");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    const spec = parseScenarioMarkdown(content);

    expect(spec.title).toBe("Long-Prompt Scenario");
    expect(spec.prompt).toContain("Preserve this entire request for future agents.");
    expect(spec.assertions.length).toBe(6);
    expect(spec.assertions.map((a) => a.id)).toEqual([
      "LP-1",
      "LP-2",
      "LP-3",
      "LP-4",
      "LP-5",
      "LP-6",
    ]);
    expect(spec.rawBaselineResponse).toContain("Operational plan");
  });

  it("loads and parses recovery-pressure.md scenario with all RP assertions", () => {
    const filePath = join(scenarioDir, "recovery-pressure.md");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    const spec = parseScenarioMarkdown(content);

    expect(spec.title).toBe("Recovery-Pressure Scenario");
    expect(spec.prompt).toContain("Interrupted run: plan-1 claimed complete");
    expect(spec.assertions.length).toBe(6);
    expect(spec.assertions.map((a) => a.id)).toEqual([
      "RP-1",
      "RP-2",
      "RP-3",
      "RP-4",
      "RP-5",
      "RP-6",
    ]);
  });

  it("loads and parses validator-pressure.md scenario with all VP assertions", () => {
    const filePath = join(scenarioDir, "validator-pressure.md");
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    const spec = parseScenarioMarkdown(content);

    expect(spec.title).toBe("Validator-Pressure Scenario");
    expect(spec.prompt).toContain("Act as final validator");
    expect(spec.assertions.length).toBe(5);
    expect(spec.assertions.map((a) => a.id)).toEqual(["VP-1", "VP-2", "VP-3", "VP-4", "VP-5"]);
  });

  it("verifies SHA-256 digest computation produces deterministic hash outputs", () => {
    const testText = "Deterministic scenario payload";
    const digest1 = computeScenarioDigest(testText);
    const digest2 = computeScenarioDigest(testText);

    expect(digest1).toBe(digest2);
    expect(digest1.length).toBe(64);
  });
});
