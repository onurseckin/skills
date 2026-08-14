import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const assetsRoot = join(import.meta.dir, "..", "..", "orchestrating-long-tasks", "scripts", "assets");

async function role(name: string): Promise<string> {
  return readFile(join(assetsRoot, name), "utf8");
}

describe("role instruction assets", () => {
  test("contain complete operational duties instead of truncated bullets", async () => {
    const [implementer, validator, critic] = await Promise.all([
      role("implementer.md"),
      role("validator.md"),
      role("completeness-critic.md"),
    ]);

    expect(implementer).toContain("expected\n  artifacts before editing.");
    expect(validator).toContain("artifacts, and\n  repository instructions.");
    expect(validator).toContain(
      "When resolving prior\n  findings, explicitly map each finding ID to fresh revalidation evidence.",
    );
    expect(critic).toContain(
      "actual\n  repository diff, authoritative command/gate records, open findings, and integrity report.",
    );

    for (const content of [implementer, validator, critic]) {
      const lines = content.split("\n");
      for (const [index, line] of lines.entries()) {
        if (/^- .*\b(?:actual|and|expected|prior)\s*$/u.test(line)) {
          expect(lines[index + 1]).toMatch(/^\s{2}\S/u);
        }
      }
    }
  });
});
