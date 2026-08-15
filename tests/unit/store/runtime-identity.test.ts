import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { RUNTIME_VERSION } from "../../../orchestrating-long-tasks/scripts/src/config/constants.ts";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { verifyIntegrity } from "../../../orchestrating-long-tasks/scripts/src/store/integrity.ts";

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

describe("capsule manifest identity", () => {
  test("records the capsule contract with run_id, bun_version, and created_at", () => {
    const { repo } = fixture();
    const run = initRun(repo, "capsule-id-test", new TextEncoder().encode("prompt"), "file", true);
    const manifest = JSON.parse(readFileSync(join(run, "manifest.json"), "utf8"));
    expect(manifest.run_id).toBe("capsule-id-test");
    expect(manifest.bun_version).toBe(Bun.version);
    expect(manifest.runtime_version).toBe(RUNTIME_VERSION);
    expect(manifest.created_at).toBeDefined();
    expect(verifyIntegrity(run)).toEqual([]);
  });

  test.each([
    ["schema", "invalid.schema", /schema/i],
    ["run_id", "invalid/run/id", /run_id/i],
    ["prompt_sha256", "invalid-sha", /digest/i],
    ["runtime_version", "   ", /runtime.*version/i],
  ] as const)("rejects invalid %s in manifest", (field, value, expected) => {
    const { repo } = fixture();
    const run = initRun(
      repo,
      `tamper-${field.replaceAll("_", "-")}`,
      new TextEncoder().encode("p"),
      "file",
      true,
    );
    rewriteManifest(run, (manifest) => {
      manifest[field] = value;
    });
    expect(messages(verifyIntegrity(run))).toMatch(expected);
  });
});
