import { expect, test } from "bun:test";
import { findGeneratedCatalogViolations } from "../../../../../scripts/modularity/policy/index.ts";
import { blob } from "../graph/graph-fixture.ts";

const root = "olt/references/cli-capabilities/";

test("returns empty array when manifest or index.jsonl is missing", () => {
  expect(findGeneratedCatalogViolations([])).toEqual([]);
  expect(findGeneratedCatalogViolations([blob(`${root}manifest.json`, "{}")])).toEqual([
    {
      rule: "generated_catalog",
      path: "olt/references/cli-capabilities",
      observed: "missing index.json",
      detail: "Generated CLI directory requires a catalog index.",
    },
  ]);
});

test("handles malformed json in manifest or index.jsonl", () => {
  const findings = findGeneratedCatalogViolations([
    blob(`${root}manifest.json`, "invalid json"),
    blob(`${root}index.jsonl`, "{}"),
    blob(`${root}index.json`, "{}"),
  ]);
  expect(findings).toEqual([
    {
      rule: "generated_catalog",
      path: root,
      observed: "malformed generated catalog",
      detail: "Generated CLI catalog must reference every command exactly once.",
    },
  ]);
});

test("handles invalid catalog references", () => {
  const manifest = JSON.stringify({ schema: "olt/cli-capabilities-split@1" });
  const indexLines = [
    JSON.stringify(null),
    JSON.stringify({ file: "" }),
    JSON.stringify({ file: "/absolute/path.json" }),
    JSON.stringify({ file: "../escape.json" }),
    JSON.stringify({ file: 123 }),
  ].join("\n");

  const findings = findGeneratedCatalogViolations([
    blob(`${root}manifest.json`, manifest),
    blob(`${root}index.jsonl`, indexLines),
    blob(`${root}index.json`, "{}"),
  ]);

  expect(findings.filter((f) => f.observed === "invalid catalog reference").length).toBe(5);
});

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
  const staleRecord = JSON.stringify({
    name: "plan:missing",
    file: "commands/plan/missing.json",
  });
  const findings = findGeneratedCatalogViolations([
    blob(`${root}manifest.json`, manifest),
    blob(`${root}index.jsonl`, `${record}\n${record}\n${staleRecord}\n`),
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
    "stale catalog reference: commands/plan/missing.json",
  ]);
});
