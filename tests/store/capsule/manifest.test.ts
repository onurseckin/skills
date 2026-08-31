import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { canonicalJsonBytes, sha256Bytes } from "../../../olt/scripts/src/core/json.ts";
import { checkManifest } from "../../../olt/scripts/src/engine/store/layout/manifest.ts";
import type { Manifest } from "../../../olt/scripts/src/core/contracts/index.ts";
import { scratchRoot as makeScratchRoot } from "../../../support/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

function writeCanonical(path: string, value: unknown): void {
  writeFileSync(path, canonicalJsonBytes(value as never));
}

function validManifest(runRoot: string, promptBytes: Uint8Array): Manifest {
  return {
    schema: "harness.manifest",
    version: 1,
    run_id: basename(runRoot),
    capsule_id: "a".repeat(32),
    mode: "feature",
    prompt_sha256: sha256Bytes(promptBytes),
    prompt_bytes: promptBytes.byteLength,
    capture_mode: "file",
    source_verified: true,
    assurance: "source-verified",
    bun_version: Bun.version,
    runtime_version: "0.1.0",
  };
}

function seedValid(root: string): { promptBytes: Uint8Array } {
  const promptBytes = new TextEncoder().encode("hello prompt");
  writeFileSync(join(root, "prompt.md"), promptBytes, { mode: 0o444 });
  writeCanonical(join(root, "manifest.json"), validManifest(root, promptBytes));
  return { promptBytes };
}

describe("checkManifest", () => {
  test("returns no issues for a fully valid manifest and prompt pair", () => {
    const root = scratchRoot("returns-no-issues-for-a-fully-valid-manifest-and-p");
    seedValid(root);
    const result = checkManifest(root);
    expect(result.issues).toEqual([]);
    expect(result.manifest?.run_id).toBe(basename(root));
    expect(result.prompt).toBeDefined();
  });

  test("reports MANIFEST_JSON when manifest.json is missing or not canonical JSON", () => {
    const root = scratchRoot("reports-manifest-json-when-manifest-json-is-missin");
    writeFileSync(join(root, "prompt.md"), "x", { mode: 0o444 });
    expect(checkManifest(root).issues.some((i) => i.code === "MANIFEST_JSON")).toBe(true);
    writeFileSync(join(root, "manifest.json"), "not json");
    expect(checkManifest(root).issues.some((i) => i.code === "MANIFEST_JSON")).toBe(true);
  });

  test("reports PROMPT_READ when prompt.md is missing, a directory, or a symlink", () => {
    const root = scratchRoot("reports-prompt-read-when-prompt-md-is-missing-a-di");
    seedValid(root);
    rmSync(join(root, "prompt.md"));
    expect(checkManifest(root).issues.some((i) => i.code === "PROMPT_READ")).toBe(true);

    const dirRoot = scratchRoot("reports-prompt-read-when-prompt-md-is-missing-a-di-dirRoot");
    seedValid(dirRoot);
    rmSync(join(dirRoot, "prompt.md"));
    mkdirSync(join(dirRoot, "prompt.md"));
    expect(checkManifest(dirRoot).issues.some((i) => i.code === "PROMPT_READ")).toBe(true);

    const linkRoot = scratchRoot("reports-prompt-read-when-prompt-md-is-missing-a-di-linkRoot");
    seedValid(linkRoot);
    rmSync(join(linkRoot, "prompt.md"));
    const target = join(linkRoot, "real-prompt.md");
    writeFileSync(target, "elsewhere");
    symlinkSync(target, join(linkRoot, "prompt.md"));
    expect(checkManifest(linkRoot).issues.some((i) => i.code === "PROMPT_READ")).toBe(true);
  });

  test("reports PROMPT_MODE when prompt.md is writable", () => {
    const root = scratchRoot("reports-prompt-mode-when-prompt-md-is-writable");
    seedValid(root);
    chmodSync(join(root, "prompt.md"), 0o644);
    expect(checkManifest(root).issues.some((i) => i.code === "PROMPT_MODE")).toBe(true);
  });

  test("stops early with only the collected issues when manifest is undefined but prompt is readable", () => {
    const root = scratchRoot("stops-early-with-only-the-collected-issues-when-ma");
    writeFileSync(join(root, "prompt.md"), "readable", { mode: 0o444 });
    const result = checkManifest(root);
    expect(result.manifest).toBeUndefined();
    expect(result.prompt).toBeDefined();
    expect(result.issues.some((i) => i.code === "MANIFEST_JSON")).toBe(true);
  });

  test("reports MANIFEST_SCHEMA for a wrong schema, version, or non-numeric version", () => {
    const root = scratchRoot("reports-manifest-schema-for-a-wrong-schema-version");
    const { promptBytes } = (() => {
      const bytes = new TextEncoder().encode("p");
      writeFileSync(join(root, "prompt.md"), bytes, { mode: 0o444 });
      return { promptBytes: bytes };
    })();
    writeCanonical(join(root, "manifest.json"), {
      ...validManifest(root, promptBytes),
      schema: "wrong.schema",
    });
    expect(checkManifest(root).issues.some((i) => i.code === "MANIFEST_SCHEMA")).toBe(true);
  });

  test("reports MANIFEST_RUN_ID for an invalid slug and for a slug mismatching the directory name", () => {
    const root = scratchRoot("reports-manifest-run-id-for-an-invalid-slug-and-fo");
    const { promptBytes } = seedValid(root);
    writeCanonical(join(root, "manifest.json"), {
      ...validManifest(root, promptBytes),
      run_id: "-bad-slug",
    });
    expect(checkManifest(root).issues.some((i) => i.code === "MANIFEST_RUN_ID")).toBe(true);

    writeCanonical(join(root, "manifest.json"), {
      ...validManifest(root, promptBytes),
      run_id: "some-other-run-name",
    });
    expect(checkManifest(root).issues.some((i) => i.code === "MANIFEST_RUN_ID")).toBe(true);
  });

  test("reports MANIFEST_CAPTURE for an unsupported capture_mode", () => {
    const root = scratchRoot("reports-manifest-capture-for-an-unsupported-captur");
    const { promptBytes } = seedValid(root);
    writeCanonical(join(root, "manifest.json"), {
      ...validManifest(root, promptBytes),
      capture_mode: "bogus",
    });
    expect(checkManifest(root).issues.some((i) => i.code === "MANIFEST_CAPTURE")).toBe(true);
  });

  test("reports MANIFEST_CAPSULE_ID for a malformed or missing capsule_id", () => {
    const root = scratchRoot("reports-manifest-capsule-id-for-a-malformed-or-mis");
    const { promptBytes } = seedValid(root);
    writeCanonical(join(root, "manifest.json"), {
      ...validManifest(root, promptBytes),
      capsule_id: "too-short",
    });
    expect(checkManifest(root).issues.some((i) => i.code === "MANIFEST_CAPSULE_ID")).toBe(true);
  });

  test("reports MANIFEST_ASSURANCE for a non-boolean source_verified", () => {
    const root = scratchRoot("reports-manifest-assurance-for-a-non-boolean-sourc");
    const { promptBytes } = seedValid(root);
    writeCanonical(join(root, "manifest.json"), {
      ...validManifest(root, promptBytes),
      source_verified: "yes",
    });
    expect(checkManifest(root).issues.some((i) => i.code === "MANIFEST_ASSURANCE")).toBe(true);
  });

  test("reports MANIFEST_ASSURANCE when assurance contradicts the capture mode", () => {
    const root = scratchRoot("reports-manifest-assurance-when-assurance-contradi");
    const { promptBytes } = seedValid(root);
    writeCanonical(join(root, "manifest.json"), {
      ...validManifest(root, promptBytes),
      assurance: "recorded-unverified",
    });
    expect(checkManifest(root).issues.some((i) => i.code === "MANIFEST_ASSURANCE")).toBe(true);
  });

  test("reports MANIFEST_ASSURANCE when captureAssurance itself throws for the given inputs", () => {
    const root = scratchRoot("reports-manifest-assurance-when-captureassurance-i");
    const { promptBytes } = seedValid(root);
    writeCanonical(join(root, "manifest.json"), {
      ...validManifest(root, promptBytes),
      capture_mode: "verbatim_context_copy",
      source_verified: true,
      assurance: "recorded-unverified",
    });
    const result = checkManifest(root);
    expect(result.issues.some((i) => i.code === "MANIFEST_ASSURANCE")).toBe(true);
  });

  test("reports PROMPT_DIGEST when prompt_sha256 is missing or malformed", () => {
    const root = scratchRoot("reports-prompt-digest-when-prompt-sha256-is-missin");
    const { promptBytes } = seedValid(root);
    writeCanonical(join(root, "manifest.json"), {
      ...validManifest(root, promptBytes),
      prompt_sha256: "not-a-digest",
    });
    expect(checkManifest(root).issues.some((i) => i.code === "PROMPT_DIGEST")).toBe(true);
  });

  test("reports PROMPT_SIZE when prompt_bytes disagrees with the actual prompt length", () => {
    const root = scratchRoot("reports-prompt-size-when-prompt-bytes-disagrees-wi");
    const { promptBytes } = seedValid(root);
    writeCanonical(join(root, "manifest.json"), {
      ...validManifest(root, promptBytes),
      prompt_bytes: promptBytes.byteLength + 1,
    });
    expect(checkManifest(root).issues.some((i) => i.code === "PROMPT_SIZE")).toBe(true);
  });

  test("reports PROMPT_DIGEST when the recorded digest no longer matches the prompt bytes on disk", () => {
    const root = scratchRoot("reports-prompt-digest-when-the-recorded-digest-no-");
    const { promptBytes } = seedValid(root);
    writeCanonical(join(root, "manifest.json"), {
      ...validManifest(root, promptBytes),
      prompt_sha256: "b".repeat(64),
    });
    expect(checkManifest(root).issues.some((i) => i.code === "PROMPT_DIGEST")).toBe(true);
  });

  test("reports RUNTIME_VERSION when the recorded runtime_version is a blank string", () => {
    const root = scratchRoot("reports-runtime-version-when-the-recorded-runtime-");
    const { promptBytes } = seedValid(root);
    writeCanonical(join(root, "manifest.json"), {
      ...validManifest(root, promptBytes),
      runtime_version: "   ",
    });
    expect(checkManifest(root).issues.some((i) => i.code === "RUNTIME_VERSION")).toBe(true);
  });

  test("reports BUN_COMPATIBILITY when bun_version is blank while a compatibility policy is recorded", () => {
    const root = scratchRoot("reports-bun-compatibility-when-bun-version-is-blan");
    const { promptBytes } = seedValid(root);
    writeCanonical(join(root, "manifest.json"), {
      ...validManifest(root, promptBytes),
      bun_version: "",
      bun_compatibility: "same-major-not-older",
    });
    expect(checkManifest(root).issues.some((i) => i.code === "BUN_COMPATIBILITY")).toBe(true);
  });

  test("reports BUN_COMPATIBILITY when the recorded bun_version fails the compatibility policy", () => {
    const root = scratchRoot("reports-bun-compatibility-when-the-recorded-bun-ve");
    const { promptBytes } = seedValid(root);
    writeCanonical(join(root, "manifest.json"), {
      ...validManifest(root, promptBytes),
      bun_version: "0.0.1",
      bun_compatibility: "same-major-not-older",
    });
    expect(checkManifest(root).issues.some((i) => i.code === "BUN_COMPATIBILITY")).toBe(true);
  });

  test("accepts a manifest with a compatible bun_compatibility policy and no issues", () => {
    const root = scratchRoot("accepts-a-manifest-with-a-compatible-bun-compatibi");
    const { promptBytes } = seedValid(root);
    writeCanonical(join(root, "manifest.json"), {
      ...validManifest(root, promptBytes),
      bun_version: Bun.version,
      bun_compatibility: "same-major-not-older",
    });
    expect(checkManifest(root).issues).toEqual([]);
  });

  test("respects a custom maxJsonBytes limit by reporting MANIFEST_JSON when it is exceeded", () => {
    const root = scratchRoot("respects-a-custom-maxjsonbytes-limit-by-reporting-");
    seedValid(root);
    expect(
      checkManifest(root, { maxJsonBytes: 1 }).issues.some((i) => i.code === "MANIFEST_JSON"),
    ).toBe(true);
  });
});
