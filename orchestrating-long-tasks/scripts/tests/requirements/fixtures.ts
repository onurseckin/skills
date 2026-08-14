import { createHash } from "node:crypto";

export function requirement(id: string, line: number, excerpt: string): Record<string, unknown> {
  return {
    id,
    source_lines: [line],
    source_excerpt: excerpt,
    instruction: `Instruction for ${id}`,
    implementation: `Expanded implementation for ${id}`,
    subsystem: "runtime/planning",
    acceptance: [
      {
        id: `A-${id.slice(2)}`,
        criterion: `Criterion for ${id}`,
        evidence: [`Evidence for ${id}`],
      },
    ],
    candidate_gates: [{ argv: ["bun", "test", "tests/planning"], cwd: "." }],
    priority: 50,
    risk: "medium",
    ambiguity: [],
    dependencies: [],
    disposition: "actionable",
    status: "planned",
  };
}

export function requirementsDocument(prompt: string): Record<string, unknown> {
  const lines = prompt.split(/\r?\n/);
  const requirements = [requirement("R-001", 1, lines[0] ?? "")];
  const dispositions: Record<string, unknown>[] = [
    { line: 1, kind: "requirement", requirement_id: "R-001" },
  ];
  if ((lines[2] ?? "").trim()) {
    requirements.push(requirement("R-002", 3, lines[2] ?? ""));
    dispositions.push({ line: 3, kind: "requirement", requirement_id: "R-002" });
  }
  return {
    schema: "harness.requirements",
    version: 1,
    prompt_sha256: createHash("sha256").update(prompt, "utf8").digest("hex"),
    requirements,
    dispositions,
  };
}
