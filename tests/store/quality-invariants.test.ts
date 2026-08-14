import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { initRun } from "../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { transact } from "../../orchestrating-long-tasks/scripts/src/store/transaction.ts";
import { verifyIntegrity } from "../../orchestrating-long-tasks/scripts/src/store/integrity.ts";

const bytes = (value: string) => new TextEncoder().encode(value);
const messages = (issues: readonly { message: string }[]) =>
  issues.map((entry) => entry.message).join("\n");

function repo(name = "repo"): string {
  const root = mkdtempSync(join(tmpdir(), "store-quality-"));
  const path = join(root, name);
  mkdirSync(path);
  return path;
}

function rewriteManifest(run: string, mutate: (value: Record<string, unknown>) => void): void {
  const path = join(run, "manifest.json");
  const value = JSON.parse(readFileSync(path, "utf8"));
  mutate(value);
  writeFileSync(path, canonicalJsonBytes(value));
}

describe("capsule identity and creator policy", () => {
  test("capture modes form a closed set with derived source assurance", () => {
    const root = repo();
    expect(() => initRun(root, "unknown", bytes("p"), "local", true)).toThrow(/capture.mode/i);
    expect(() => initRun(root, "file-false", bytes("p"), "file", false)).toThrow(
      /source.verified/i,
    );
    expect(() => initRun(root, "stdin-false", bytes("p"), "stdin", false)).toThrow(
      /source.verified/i,
    );
    expect(() => initRun(root, "context-true", bytes("p"), "verbatim_context_copy", true)).toThrow(
      /source.verified/i,
    );
    expect(() => initRun(root, "file", bytes("p"), "file", true)).not.toThrow();
    expect(() => initRun(root, "stdin", bytes("p"), "stdin", true)).not.toThrow();
    expect(() =>
      initRun(root, "context", bytes("p"), "verbatim_context_copy", false),
    ).not.toThrow();
  });

  test("same-slug histories cannot move between repository capsules", () => {
    const first = initRun(repo("one"), "same", bytes("same"), "file", true);
    const second = initRun(repo("two"), "same", bytes("same"), "file", true);
    transact(first, "worker", "record", {}, (state) => {
      state.source = "first";
    });
    copyFileSync(join(first, "events.jsonl"), join(second, "events.jsonl"));
    copyFileSync(join(first, "state.json"), join(second, "state.json"));
    expect(messages(verifyIntegrity(second))).toMatch(/capsule.*identity|capsule.id/i);
  });

  test("records creator Bun and applies an explicit compatibility policy", () => {
    const run = initRun(repo(), "creator", bytes("p"), "file", true);
    const manifest = JSON.parse(readFileSync(join(run, "manifest.json"), "utf8"));
    expect(manifest.bun_version).toBe(Bun.version);
    expect(manifest.bun_compatibility).toBe("same-major-not-older");
    rewriteManifest(run, (value) => {
      value.bun_version = `${Bun.version.split(".")[0]}.0.0`;
    });
    expect(messages(verifyIntegrity(run))).not.toMatch(/Bun version/i);
    rewriteManifest(run, (value) => {
      value.bun_compatibility = "anything-goes";
    });
    expect(messages(verifyIntegrity(run))).toMatch(/compatibility policy/i);
  });

  test("rejects the .harness directory itself as a runtime source", () => {
    const root = repo();
    const source = join(root, ".harness");
    mkdirSync(join(source, "src/config"), { recursive: true });
    writeFileSync(join(source, "harness.ts"), "export {};\n");
    writeFileSync(join(source, "src/config/constants.ts"), 'export const RUNTIME_VERSION="1";\n');
    try {
      initRun(root, "unsafe-source", bytes("p"), "file", true, { runtimeSource: source });
      throw new Error("expected initRun to reject .harness");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("PATH_SAFETY");
    }
  });
});
