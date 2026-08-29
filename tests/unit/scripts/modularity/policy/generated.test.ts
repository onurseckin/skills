import { expect, test } from "bun:test";
import { findGeneratedCatalogViolations } from "../../../../../scripts/modularity/policy/index.ts";
import { blob } from "../graph/graph-fixture.ts";

const root = "olt/references/cli-capabilities/";

test("rejects duplicate, orphan, stale, and missing generated command catalog entries", () => {
  const manifest = JSON.stringify({
    schema: "olt/cli-capabilities-split@1",
    index_file: "index.jsonl",
    domains: [
      {
        domain: "plan",
        commands_dir: "commands/plan",
        markdown_file: "domains/plan.md",
      },
    ],
  });
  const record = JSON.stringify({
    name: "plan:one",
    file: "commands/plan/one.json",
  });
  const findings = findGeneratedCatalogViolations([
    blob(`${root}manifest.json`, manifest),
    blob(`${root}index.jsonl`, `${record}\n${record}\n`),
    blob(`${root}index.json`, "{}"),
    blob(`${root}commands/plan/one.json`, "{}"),
    blob(`${root}commands/plan/orphan.json`, "{}"),
    blob(`${root}commands/plan/index.json`, "{}"),
    blob(`${root}domains/plan.md`, "plan"),
    blob(`${root}domains/index.json`, "{}"),
  ]);

  expect(findings.map((finding) => finding.observed)).toEqual([
    "duplicate catalog reference: commands/plan/one.json",
    "orphan command file: commands/plan/orphan.json",
  ]);
});
