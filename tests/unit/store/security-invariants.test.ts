import { describe, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { initRun } from "../../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/load.ts";
import { recoverProjection } from "../../../orchestrating-long-tasks/scripts/src/store/recovery.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";
import { verifyIntegrity } from "../../../orchestrating-long-tasks/scripts/src/store/integrity.ts";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const messages = (issues: readonly { message: string }[]): string =>
  issues.map((item) => item.message).join("\n");

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "harness-security-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  return repo;
}

describe("capsule security invariants", () => {
  test("verbatim context capture can never claim source verification", () => {
    const repo = repository();
    expect(() =>
      initRun(repo, "invalid-assurance", bytes("prompt"), "verbatim_context_copy", true),
    ).toThrow(/verbatim_context_copy|source_verified/i);
    expect(() =>
      initRun(repo, "valid-assurance", bytes("prompt"), "verbatim_context_copy", false),
    ).not.toThrow();
  });

  test("integrity rejects an upgraded verbatim capture manifest", () => {
    const run = initRun(
      repository(),
      "assurance-tamper",
      bytes("prompt"),
      "verbatim_context_copy",
      false,
    );
    const path = join(run, "manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.source_verified = true;
    manifest.assurance = "source-verified";
    writeFileSync(path, canonicalJsonBytes(manifest));
    expect(messages(verifyIntegrity(run))).toMatch(/verbatim_context_copy|source.verify/i);
    expect(() => loadRun(run)).toThrow(/integrity/i);
  });

  test("event history is bound to its originating run", () => {
    const repo = repository();
    const original = initRun(repo, "original", bytes("same prompt"), "file", true);
    const recipient = initRun(repo, "recipient", bytes("same prompt"), "file", true);
    transact(original, "worker", "record", {}, (state) => {
      state.marker = "from-original";
    });
    copyFileSync(join(original, "events.jsonl"), join(recipient, "events.jsonl"));
    copyFileSync(join(original, "state.json"), join(recipient, "state.json"));
    expect(messages(verifyIntegrity(recipient))).toMatch(/event.*run.id|run.id.*event/i);
    expect(() => loadRun(recipient)).toThrow(/integrity/i);
    expect(() => recoverProjection(recipient, "recovery-agent")).toThrow(/integrity/i);
  });

  test("canonical store files cannot be substituted by an internal symlink", () => {
    const run = initRun(repository(), "internal-link", bytes("prompt"), "file", true);
    const shadow = join(run, "shadow");
    mkdirSync(shadow);
    copyFileSync(join(run, "state.json"), join(shadow, "state.json"));
    rmSync(join(run, "state.json"));
    symlinkSync(join(shadow, "state.json"), join(run, "state.json"));
    expect(messages(verifyIntegrity(run))).toMatch(/unsafe|symbolic|state\.json/i);
    expect(() => loadRun(run)).toThrow(/integrity|unsafe|symbolic/i);
  });
});
