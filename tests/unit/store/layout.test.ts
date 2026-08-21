import { describe, expect, test } from "bun:test";
import {
  CAPSULE_LAYOUT,
  LOCKS_DIRECTORY,
  initialCapsuleDirectories,
  isDeclaredCapsuleEntry,
  renderLayoutReadme,
} from "../../../orchestrating-long-tasks/scripts/src/store/layout.ts";

describe("isDeclaredCapsuleEntry", () => {
  test("recognizes every declared entry by its bare name, directories included", () => {
    for (const entry of CAPSULE_LAYOUT) {
      expect(isDeclaredCapsuleEntry(entry.name.replace(/\/$/u, ""))).toBe(true);
    }
  });

  test("rejects a name that is not part of the declared layout", () => {
    expect(isDeclaredCapsuleEntry("not-a-real-entry")).toBe(false);
  });
});

describe("initialCapsuleDirectories", () => {
  test("returns only directory entries created at init, without trailing slashes", () => {
    const directories = initialCapsuleDirectories();
    expect(directories.length).toBeGreaterThan(0);
    for (const name of directories) {
      expect(name.endsWith("/")).toBe(false);
      const entry = CAPSULE_LAYOUT.find((candidate) => candidate.name === `${name}/`);
      expect(entry?.createdAtInit).toBe(true);
    }
    expect(directories).toContain("blobs");
    expect(directories).not.toContain("packets");
  });
});

describe("renderLayoutReadme", () => {
  test("embeds the run id and every declared entry name", () => {
    const readme = renderLayoutReadme("2026-08-20-example-run");
    expect(readme).toContain("# Capsule `2026-08-20-example-run`");
    for (const entry of CAPSULE_LAYOUT) expect(readme).toContain(entry.name);
    expect(readme).toContain(LOCKS_DIRECTORY);
  });

  test("aligns every row to the width of the longest entry name", () => {
    const readme = renderLayoutReadme("run");
    const width = Math.max(...CAPSULE_LAYOUT.map((entry) => entry.name.length));
    const row = readme.split("\n").find((line) => line.startsWith("manifest.json"));
    expect(row?.slice(0, width)).toBe("manifest.json".padEnd(width));
  });
});
