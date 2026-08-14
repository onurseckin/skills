import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { initRun } from "../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { verifyIntegrity } from "../../orchestrating-long-tasks/scripts/src/store/integrity.ts";

const messages = (issues: readonly { message: string }[]): string =>
  issues.map((item) => item.message).join("\n");
const PINNED_SOURCE_VERSION = "9.8.7";

function fixture(): { repo: string; runtime: string } {
  const root = mkdtempSync(join(tmpdir(), "harness-runtime-identity-"));
  const repo = join(root, "repo");
  const runtime = join(repo, "source");
  mkdirSync(join(runtime, "src/config"), { recursive: true });
  writeFileSync(join(runtime, "harness.ts"), "export const pinned = true;\n");
  writeFileSync(join(runtime, "package.json"), '{"type":"module"}\n');
  writeFileSync(
    join(runtime, "src/config/constants.ts"),
    `export const RUNTIME_VERSION = ${JSON.stringify(PINNED_SOURCE_VERSION)};\n`,
  );
  return { repo, runtime };
}

function rewriteManifest(run: string, mutate: (manifest: Record<string, unknown>) => void): void {
  const path = join(run, "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  mutate(manifest);
  writeFileSync(path, canonicalJsonBytes(manifest));
}

describe("pinned runtime manifest identity", () => {
  test("records the frozen runtime contract instead of an undeclared count field", () => {
    const { repo, runtime } = fixture();
    const run = initRun(repo, "runtime", new TextEncoder().encode("prompt"), "file", true, {
      runtimeSource: runtime,
    });
    const manifest = JSON.parse(readFileSync(join(run, "manifest.json"), "utf8"));
    expect(manifest.runtime_files).toBe(3);
    expect(manifest.runtime_entrypoint).toBe("runtime/harness.ts");
    expect(manifest.bun_version).toBe(Bun.version);
    expect(manifest.runtime_version).toBe(PINNED_SOURCE_VERSION);
    expect("runtime_file_count" in manifest).toBeFalse();
    expect(verifyIntegrity(run)).toEqual([]);
  });

  test.each([
    ["runtime_files", -1, /runtime.*files/i],
    ["runtime_entrypoint", "runtime/other.ts", /entrypoint/i],
    ["bun_version", "", /bun.*version/i],
    ["runtime_version", "wrong", /runtime.*version/i],
  ] as const)("rejects invalid %s identity", (field, value, expected) => {
    const { repo, runtime } = fixture();
    const run = initRun(
      repo,
      `tamper-${field.replaceAll("_", "-")}`,
      new TextEncoder().encode("p"),
      "file",
      true,
      {
        runtimeSource: runtime,
      },
    );
    rewriteManifest(run, (manifest) => {
      manifest[field] = value;
    });
    expect(messages(verifyIntegrity(run))).toMatch(expected);
  });
});
