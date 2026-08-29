import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareBaseline,
  loadBaseline,
  type ModularityBaseline,
} from "../../../../../scripts/modularity/policy/index.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function baseline(observed: number): ModularityBaseline {
  return {
    schema: "olt-modularity-baseline/v1",
    violations: [
      {
        rule: "line_limit",
        path: "a.ts",
        observed,
        limit: 300,
        detail: "File exceeds the 300 physical-line limit.",
      },
    ],
  };
}

test("rejects growth and accepts reduction", () => {
  expect(compareBaseline(baseline(450), baseline(451)).passed).toBe(false);
  expect(compareBaseline(baseline(450), baseline(300)).passed).toBe(true);
});

test("rejects an added violation and duplicate baseline identity", () => {
  expect(
    compareBaseline(baseline(300), {
      ...baseline(300),
      violations: [
        ...baseline(300).violations,
        {
          rule: "export_star",
          path: "slice/index.ts",
          observed: 1,
          detail: "No export star.",
        },
      ],
    }).passed,
  ).toBe(false);
  expect(() =>
    compareBaseline(
      {
        ...baseline(450),
        violations: [...baseline(450).violations, ...baseline(450).violations],
      },
      baseline(450),
    ),
  ).toThrow("duplicate");
});

test("loads bounded shards and rejects a duplicate identity across them", async () => {
  const root = await mkdtemp(join(tmpdir(), "modularity-baseline-"));
  roots.push(root);
  await writeFile(join(root, "one.json"), JSON.stringify(baseline(300).violations));
  await writeFile(join(root, "two.json"), JSON.stringify(baseline(300).violations));
  await writeFile(
    join(root, "baseline.json"),
    JSON.stringify({
      schema: "olt-modularity-baseline/v1",
      shards: ["one.json", "two.json"],
    }),
  );

  await expect(loadBaseline(root, "baseline.json")).rejects.toThrow("duplicate");
});
