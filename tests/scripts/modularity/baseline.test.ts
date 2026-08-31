import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBaseline } from "../../../scripts/modularity/policy/index.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("loads bounded shards and rejects a duplicate identity across them", async () => {
  const root = await mkdtemp(join(tmpdir(), "modularity-baseline-"));
  roots.push(root);
  const viol = [
    {
      rule: "line_limit" as const,
      path: "a.ts",
      observed: 300,
      limit: 300,
      detail: "File exceeds limit.",
    },
  ];
  await writeFile(join(root, "one.json"), JSON.stringify(viol));
  await writeFile(join(root, "two.json"), JSON.stringify(viol));
  await writeFile(
    join(root, "baseline.json"),
    JSON.stringify({
      schema: "olt-modularity-baseline/v1",
      shards: ["one.json", "two.json"],
    }),
  );

  await expect(loadBaseline(root, "baseline.json")).rejects.toThrow("duplicate");
});

test("loads baseline with inline violations document", async () => {
  const root = await mkdtemp(join(tmpdir(), "modularity-baseline-"));
  roots.push(root);
  const doc = {
    schema: "olt-modularity-baseline/v1",
    violations: [
      {
        rule: "export_star",
        path: "src/index.ts",
        observed: 2,
        detail: "export star",
      },
      {
        rule: "directory_fanout",
        path: "src",
        observed: 12,
        limit: 10,
        detail: "fanout",
      },
    ],
  };
  await writeFile(join(root, "baseline.json"), JSON.stringify(doc));
  const loaded = await loadBaseline(root, "baseline.json");
  expect(loaded.schema).toBe("olt-modularity-baseline/v1");
  expect(loaded.violations.length).toBe(2);
});

test("loads baseline with valid multi-shard document", async () => {
  const root = await mkdtemp(join(tmpdir(), "modularity-baseline-"));
  roots.push(root);
  const shard1 = [
    {
      rule: "export_star",
      path: "src/index.ts",
      observed: 2,
      detail: "export star",
    },
  ];
  const shard2 = [
    {
      rule: "missing_facade",
      path: "src/pkg",
      observed: "missing index.ts",
      detail: "missing",
    },
  ];
  await writeFile(join(root, "shard1.json"), JSON.stringify(shard1));
  await writeFile(join(root, "shard2.json"), JSON.stringify(shard2));
  await writeFile(
    join(root, "baseline.json"),
    JSON.stringify({
      schema: "olt-modularity-baseline/v1",
      shards: ["shard1.json", "shard2.json"],
    }),
  );
  const loaded = await loadBaseline(root, "baseline.json");
  expect(loaded.violations.length).toBe(2);
});

test("validates all failure modes of loadBaseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "modularity-baseline-"));
  roots.push(root);

  await expect(loadBaseline(root, "nonexistent.json")).rejects.toThrow("missing baseline file");

  await writeFile(join(root, "invalid.json"), "{ invalid");
  await expect(loadBaseline(root, "invalid.json")).rejects.toThrow("invalid JSON");

  await writeFile(join(root, "not-obj.json"), JSON.stringify("string"));
  await expect(loadBaseline(root, "not-obj.json")).rejects.toThrow("root must be an object");

  await writeFile(
    join(root, "unknown-root.json"),
    JSON.stringify({ schema: "olt-modularity-baseline/v1", extra: 123, violations: [] }),
  );
  await expect(loadBaseline(root, "unknown-root.json")).rejects.toThrow("unknown root key");

  await writeFile(
    join(root, "bad-schema.json"),
    JSON.stringify({ schema: "wrong/v1", violations: [] }),
  );
  await expect(loadBaseline(root, "bad-schema.json")).rejects.toThrow("stale or missing schema");

  await writeFile(
    join(root, "both.json"),
    JSON.stringify({ schema: "olt-modularity-baseline/v1", violations: [], shards: [] }),
  );
  await expect(loadBaseline(root, "both.json")).rejects.toThrow("stale or missing schema");

  await writeFile(
    join(root, "invalid-shard.json"),
    JSON.stringify({ schema: "olt-modularity-baseline/v1", shards: [""] }),
  );
  await expect(loadBaseline(root, "invalid-shard.json")).rejects.toThrow("invalid shard path");

  await writeFile(join(root, "empty-shard.json"), "[]");
  await writeFile(
    join(root, "dup-shard.json"),
    JSON.stringify({
      schema: "olt-modularity-baseline/v1",
      shards: ["empty-shard.json", "empty-shard.json"],
    }),
  );
  await expect(loadBaseline(root, "dup-shard.json")).rejects.toThrow("duplicate shard");

  await writeFile(
    join(root, "missing-shard-doc.json"),
    JSON.stringify({ schema: "olt-modularity-baseline/v1", shards: ["missing.json"] }),
  );
  await expect(loadBaseline(root, "missing-shard-doc.json")).rejects.toThrow(
    "missing baseline shard",
  );

  await writeFile(join(root, "obj-shard.json"), "{}");
  await writeFile(
    join(root, "obj-shard-doc.json"),
    JSON.stringify({ schema: "olt-modularity-baseline/v1", shards: ["obj-shard.json"] }),
  );
  await expect(loadBaseline(root, "obj-shard-doc.json")).rejects.toThrow("must be an array");

  await writeFile(
    join(root, "viol-not-obj.json"),
    JSON.stringify({ schema: "olt-modularity-baseline/v1", violations: [123] }),
  );
  await expect(loadBaseline(root, "viol-not-obj.json")).rejects.toThrow(
    "violation must be an object",
  );

  await writeFile(
    join(root, "viol-unknown-key.json"),
    JSON.stringify({
      schema: "olt-modularity-baseline/v1",
      violations: [{ rule: "export_star", path: "a.ts", detail: "d", observed: 1, bogus: true }],
    }),
  );
  await expect(loadBaseline(root, "viol-unknown-key.json")).rejects.toThrow(
    "violation has unknown keys",
  );

  await writeFile(
    join(root, "viol-bad-rule.json"),
    JSON.stringify({
      schema: "olt-modularity-baseline/v1",
      violations: [{ rule: "invalid_rule", path: "a.ts", detail: "d", observed: 1 }],
    }),
  );
  await expect(loadBaseline(root, "viol-bad-rule.json")).rejects.toThrow(
    "violation has invalid required fields",
  );

  await writeFile(
    join(root, "viol-empty-path.json"),
    JSON.stringify({
      schema: "olt-modularity-baseline/v1",
      violations: [{ rule: "export_star", path: "", detail: "d", observed: 1 }],
    }),
  );
  await expect(loadBaseline(root, "viol-empty-path.json")).rejects.toThrow(
    "violation has invalid required fields",
  );

  await writeFile(
    join(root, "viol-bad-observed.json"),
    JSON.stringify({
      schema: "olt-modularity-baseline/v1",
      violations: [{ rule: "export_star", path: "a.ts", detail: "d", observed: false }],
    }),
  );
  await expect(loadBaseline(root, "viol-bad-observed.json")).rejects.toThrow(
    "violation has invalid observed value",
  );

  await writeFile(
    join(root, "viol-neg-observed.json"),
    JSON.stringify({
      schema: "olt-modularity-baseline/v1",
      violations: [{ rule: "export_star", path: "a.ts", detail: "d", observed: -1 }],
    }),
  );
  await expect(loadBaseline(root, "viol-neg-observed.json")).rejects.toThrow(
    "violation has negative or invalid observed value",
  );

  await writeFile(
    join(root, "viol-bad-limit.json"),
    JSON.stringify({
      schema: "olt-modularity-baseline/v1",
      violations: [{ rule: "line_limit", path: "a.ts", detail: "d", observed: 350, limit: -5 }],
    }),
  );
  await expect(loadBaseline(root, "viol-bad-limit.json")).rejects.toThrow(
    "violation has invalid limit",
  );
});
