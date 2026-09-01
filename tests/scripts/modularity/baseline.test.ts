import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import * as fsPromises from "node:fs/promises";
import { join } from "node:path";
import { loadBaseline } from "../../../scripts/modularity/policy/index.ts";

describe("modularity baseline loader (in-memory virtual)", () => {
  const root = `${process.cwd()}/.olt/virtual-modularity-baseline`;
  const mockFiles = new Map<string, string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockFiles.clear();
    spies.push(
      spyOn(fsPromises, "readFile").mockImplementation(
        async (p: Parameters<typeof fsPromises.readFile>[0]) => {
          const pathStr = String(p);
          const content = mockFiles.get(pathStr);
          if (content !== undefined) return content;
          throw new Error(`ENOENT: no such file or directory, open '${pathStr}'`);
        },
      ),
    );
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  function setFile(relativePath: string, data: unknown): void {
    const fullPath = join(root, relativePath);
    mockFiles.set(fullPath, typeof data === "string" ? data : JSON.stringify(data));
  }

  test("loads bounded shards and rejects a duplicate identity across them", async () => {
    const viol = [
      {
        rule: "line_limit" as const,
        path: "a.ts",
        observed: 300,
        limit: 300,
        detail: "File exceeds limit.",
      },
    ];
    setFile("one.json", viol);
    setFile("two.json", viol);
    setFile("baseline.json", {
      schema: "olt-modularity-baseline/v1",
      shards: ["one.json", "two.json"],
    });

    await expect(loadBaseline(root, "baseline.json")).rejects.toThrow("duplicate");
  });

  test("loads baseline with inline violations document", async () => {
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
    setFile("baseline.json", doc);
    const loaded = await loadBaseline(root, "baseline.json");
    expect(loaded.schema).toBe("olt-modularity-baseline/v1");
    expect(loaded.violations.length).toBe(2);
  });

  test("loads baseline with valid multi-shard document", async () => {
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
    setFile("shard1.json", shard1);
    setFile("shard2.json", shard2);
    setFile("baseline.json", {
      schema: "olt-modularity-baseline/v1",
      shards: ["shard1.json", "shard2.json"],
    });
    const loaded = await loadBaseline(root, "baseline.json");
    expect(loaded.violations.length).toBe(2);
  });

  test("validates all failure modes of loadBaseline", async () => {
    await expect(loadBaseline(root, "nonexistent.json")).rejects.toThrow("missing baseline file");

    setFile("invalid.json", "{ invalid");
    await expect(loadBaseline(root, "invalid.json")).rejects.toThrow("invalid JSON");

    setFile("not-obj.json", JSON.stringify("string"));
    await expect(loadBaseline(root, "not-obj.json")).rejects.toThrow("root must be an object");

    setFile("unknown-root.json", {
      schema: "olt-modularity-baseline/v1",
      extra: 123,
      violations: [],
    });
    await expect(loadBaseline(root, "unknown-root.json")).rejects.toThrow("unknown root key");

    setFile("bad-schema.json", { schema: "wrong/v1", violations: [] });
    await expect(loadBaseline(root, "bad-schema.json")).rejects.toThrow("stale or missing schema");

    setFile("both.json", { schema: "olt-modularity-baseline/v1", violations: [], shards: [] });
    await expect(loadBaseline(root, "both.json")).rejects.toThrow("stale or missing schema");

    setFile("invalid-shard.json", { schema: "olt-modularity-baseline/v1", shards: [""] });
    await expect(loadBaseline(root, "invalid-shard.json")).rejects.toThrow("invalid shard path");

    setFile("empty-shard.json", "[]");
    setFile("dup-shard.json", {
      schema: "olt-modularity-baseline/v1",
      shards: ["empty-shard.json", "empty-shard.json"],
    });
    await expect(loadBaseline(root, "dup-shard.json")).rejects.toThrow("duplicate shard");

    setFile("missing-shard-doc.json", {
      schema: "olt-modularity-baseline/v1",
      shards: ["missing.json"],
    });
    await expect(loadBaseline(root, "missing-shard-doc.json")).rejects.toThrow(
      "missing baseline shard",
    );

    setFile("obj-shard.json", "{}");
    setFile("obj-shard-doc.json", {
      schema: "olt-modularity-baseline/v1",
      shards: ["obj-shard.json"],
    });
    await expect(loadBaseline(root, "obj-shard-doc.json")).rejects.toThrow("must be an array");

    setFile("viol-not-obj.json", { schema: "olt-modularity-baseline/v1", violations: [123] });
    await expect(loadBaseline(root, "viol-not-obj.json")).rejects.toThrow(
      "violation must be an object",
    );

    setFile("viol-unknown-key.json", {
      schema: "olt-modularity-baseline/v1",
      violations: [{ rule: "export_star", path: "a.ts", detail: "d", observed: 1, bogus: true }],
    });
    await expect(loadBaseline(root, "viol-unknown-key.json")).rejects.toThrow(
      "violation has unknown keys",
    );

    setFile("viol-bad-rule.json", {
      schema: "olt-modularity-baseline/v1",
      violations: [{ rule: "invalid_rule", path: "a.ts", detail: "d", observed: 1 }],
    });
    await expect(loadBaseline(root, "viol-bad-rule.json")).rejects.toThrow(
      "violation has invalid required fields",
    );

    setFile("viol-empty-path.json", {
      schema: "olt-modularity-baseline/v1",
      violations: [{ rule: "export_star", path: "", detail: "d", observed: 1 }],
    });
    await expect(loadBaseline(root, "viol-empty-path.json")).rejects.toThrow(
      "violation has invalid required fields",
    );

    setFile("viol-bad-observed.json", {
      schema: "olt-modularity-baseline/v1",
      violations: [{ rule: "export_star", path: "a.ts", detail: "d", observed: false }],
    });
    await expect(loadBaseline(root, "viol-bad-observed.json")).rejects.toThrow(
      "violation has invalid observed value",
    );

    setFile("viol-neg-observed.json", {
      schema: "olt-modularity-baseline/v1",
      violations: [{ rule: "export_star", path: "a.ts", detail: "d", observed: -1 }],
    });
    await expect(loadBaseline(root, "viol-neg-observed.json")).rejects.toThrow(
      "violation has negative or invalid observed value",
    );

    setFile("viol-bad-limit.json", {
      schema: "olt-modularity-baseline/v1",
      violations: [{ rule: "line_limit", path: "a.ts", detail: "d", observed: 350, limit: -5 }],
    });
    await expect(loadBaseline(root, "viol-bad-limit.json")).rejects.toThrow(
      "violation has invalid limit",
    );
  });
});
