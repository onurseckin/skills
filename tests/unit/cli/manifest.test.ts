import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  capabilityManifest,
  MANIFEST_SCHEMA,
  renderManifestJson,
  renderManifestMarkdown,
} from "../../../orchestrating-long-tasks/scripts/src/cli/manifest.ts";
import { COMMAND_REGISTRY } from "../../../orchestrating-long-tasks/scripts/src/cli/registry/index.ts";

const references = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "orchestrating-long-tasks",
  "references",
);

describe("CLI capability manifest", () => {
  test("checked-in markdown matches the registry render", () => {
    expect(readFileSync(join(references, "cli-capabilities.md"), "utf-8")).toBe(
      renderManifestMarkdown(),
    );
  });

  test("checked-in json matches the registry render", () => {
    expect(readFileSync(join(references, "cli-capabilities.json"), "utf-8")).toBe(
      renderManifestJson(),
    );
  });

  test("carries every command with its flags and stdin rule", () => {
    const manifest = capabilityManifest();
    expect(manifest.schema).toBe(MANIFEST_SCHEMA);
    expect(manifest.commands.map((entry) => entry.name)).toEqual(
      COMMAND_REGISTRY.map((spec) => spec.name),
    );
    const exec = manifest.commands.find((entry) => entry.name === "run:exec");
    expect(exec?.takes_remainder).toBeTrue();
    expect(exec?.flags.map((flag) => flag.name)).toContain("gate");
    const init = manifest.commands.find((entry) => entry.name === "plan:init");
    expect(init?.reads_stdin).toBeTrue();
    expect(init?.aliases).toEqual(["init"]);
  });

  test("renders deterministically so the freshness check cannot drift", () => {
    expect(renderManifestJson()).toBe(renderManifestJson());
    expect(renderManifestMarkdown()).toBe(renderManifestMarkdown());
  });
});
