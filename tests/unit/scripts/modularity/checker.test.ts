import { expect, test } from "bun:test";
import { checkModularity } from "../../../../scripts/modularity/index.ts";

test("rejects a baseline path outside the repository", async () => {
  await expect(
    checkModularity({
      repoRoot: process.cwd(),
      mode: "ratchet",
      source: "index",
      baselinePath: "../outside.json",
    }),
  ).rejects.toThrow("outside");
});
