import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../orchestrating-long-tasks/scripts/src/core/json.ts";
import { RUNTIME_VERSION } from "../../orchestrating-long-tasks/scripts/src/config/constants.ts";
import { initRun } from "../../orchestrating-long-tasks/scripts/src/store/capsule.ts";
import { loadRun } from "../../orchestrating-long-tasks/scripts/src/store/load.ts";
import { transact } from "../../orchestrating-long-tasks/scripts/src/store/transaction.ts";
import { verifyIntegrity } from "../../orchestrating-long-tasks/scripts/src/store/integrity.ts";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const messages = (issues: readonly { message: string }[]): string =>
  issues.map((issue) => issue.message).join("\n");

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "harness-capsule-"));
  const path = join(root, "repo");
  mkdirSync(path);
  return path;
}

function init(root = repo(), runId = "run-001", prompt = bytes("exact prompt\n")): string {
  return initRun(root, runId, prompt, "verbatim_context_copy", false);
}

describe("run capsule and integrity", () => {
  test("test_init_preserves_prompt_and_records_assurance_and_structure", () => {
    const root = repo();
    const prompt = new Uint8Array([0, 101, 120, 97, 99, 116, 255, 13, 10]);
    const run = init(root, "run-001", prompt);
    expect(run).toBe(join(realpathSync(root), ".capsules/run-001"));
    expect(new Uint8Array(readFileSync(join(run, "prompt.md")))).toEqual(prompt);
    const loaded = loadRun(run);
    expect(loaded.manifest.prompt_bytes).toBe(prompt.byteLength);
    expect(loaded.manifest.capture_mode).toBe("verbatim_context_copy");
    expect(loaded.manifest.assurance).toBe("recorded-unverified");
    expect(statSync(join(run, "prompt.md")).mode & 0o222).toBe(0);
    for (const directory of ["packets", "evidence", "findings", "commands"]) {
      expect(statSync(join(run, directory)).isDirectory()).toBeTrue();
    }
    expect(readFileSync(join(run, "events.jsonl"))).toHaveLength(0);
    expect(loaded.state.event_sequence).toBe(0);
  });

  test("test_verified_load_rejects_prompt_mutation", () => {
    const run = init(repo(), "run-001", bytes("original"));
    chmodSync(join(run, "prompt.md"), 0o644);
    writeFileSync(join(run, "prompt.md"), "tampered");
    expect(messages(verifyIntegrity(run))).toMatch(/prompt/i);
    expect(() => loadRun(run)).toThrow(/integrity/i);
  });

  test("test_collision_invalid_run_ids_and_blank_actor_are_rejected", () => {
    const root = repo();
    init(root);
    expect(() => init(root)).toThrow();
    for (const runId of ["", ".", "..", "has/slash", "white space"]) {
      expect(() => init(root, runId)).toThrow(/run_id/i);
    }
    expect(() =>
      transact(join(realpathSync(root), ".capsules/run-001"), "  ", "record", {}, () => undefined),
    ).toThrow(/actor/i);
    expect(() =>
      transact(join(realpathSync(root), ".capsules/run-001"), "worker", "", {}, () => undefined),
    ).toThrow(/kind/i);
  });

  test("test_deep_state_json_is_reported_as_integrity_error", () => {
    const run = init();
    writeFileSync(join(run, "state.json"), `{"nested":${"[".repeat(2000)}0${"]".repeat(2000)}}`);
    expect(messages(verifyIntegrity(run, { maxDepth: 128 }))).toMatch(/state\.json.*depth/i);
    expect(() => loadRun(run, true, { maxDepth: 128 })).toThrow();
  });

  test("test_json_size_limits_are_integrity_issues", () => {
    const run = init();
    writeFileSync(join(run, "state.json"), JSON.stringify({ padding: "x".repeat(256) }));
    expect(messages(verifyIntegrity(run, { maxJsonBytes: 128 }))).toMatch(/size limit/i);
  });

  test("test_manifest_run_id_and_prompt_digest_format_are_verified", () => {
    const run = init();
    const manifestPath = join(run, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.run_id = "swapped-run";
    writeFileSync(manifestPath, canonicalJsonBytes(manifest));
    expect(messages(verifyIntegrity(run))).toMatch(/run_id/i);
    manifest.run_id = "run-001";
    manifest.prompt_sha256 = "not-a-sha256";
    writeFileSync(manifestPath, canonicalJsonBytes(manifest));
    expect(messages(verifyIntegrity(run))).toMatch(/prompt.*digest/i);
  });

  test("lightweight capsule initializes without runtime directory and includes tmp directory", () => {
    const root = repo();
    const run = initRun(root, "lightweight", bytes("prompt"), "file", true);
    expect(existsSync(join(run, "tmp"))).toBeTrue();
    expect(existsSync(join(run, "runtime"))).toBeFalse();
    const loaded = loadRun(run);
    expect(loaded.manifest.run_id).toBe("lightweight");
    expect(loaded.manifest.created_at).toBeDefined();
    expect(messages(verifyIntegrity(run))).toBe("");
  });

  test("fails closed when a canonical store path is replaced by a symlink", () => {
    const run = init();
    const outside = join(run, "../outside-state.json");
    writeFileSync(outside, '{"safe":false}');
    const state = join(run, "state.json");
    rmSync(state);
    symlinkSync(outside, state);
    expect(messages(verifyIntegrity(run))).toMatch(/unsafe|state\.json/i);
    expect(() => loadRun(run)).toThrow();
  });
});
