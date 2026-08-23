import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  capabilityManifest,
  commandSlice,
  domainSlice,
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

describe("CLI capability manifest & digest", () => {
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

  test("contains mind command domain registrations", () => {
    const manifest = capabilityManifest();
    const mindCommands = manifest.commands.filter((cmd) => cmd.name.startsWith("mind:"));
    expect(mindCommands.length).toBeGreaterThanOrEqual(4);
    const mindInit = manifest.commands.find((cmd) => cmd.name === "mind:init");
    expect(mindInit).toBeDefined();
    expect(mindInit?.domain).toBe("mind");
  });

  test("pruned JSON manifest is compact and under 200KB", () => {
    const jsonContent = readFileSync(join(references, "cli-capabilities.json"), "utf-8");
    expect(Buffer.byteLength(jsonContent, "utf-8")).toBeLessThan(200_000);
  });

  test("provides on-demand commandSlice for individual commands and aliases", () => {
    const mindInitSlice = commandSlice("mind:init");
    expect(mindInitSlice).toBeDefined();
    expect(mindInitSlice?.name).toBe("mind:init");
    expect(mindInitSlice?.domain).toBe("mind");

    const execSlice = commandSlice("run:exec");
    expect(execSlice).toBeDefined();
    expect(execSlice?.name).toBe("run:exec");
    expect(execSlice?.takes_remainder).toBeTrue();
  });

  test("provides on-demand domainSlice filtering commands by domain", () => {
    const mindSlice = domainSlice("mind");
    expect(mindSlice.schema).toBe(MANIFEST_SCHEMA);
    expect(mindSlice.commands.length).toBeGreaterThanOrEqual(4);
    expect(mindSlice.commands.every((c) => c.domain === "mind")).toBeTrue();
  });

  test("renders deterministically so the freshness check cannot drift", () => {
    expect(renderManifestJson()).toBe(renderManifestJson());
    expect(renderManifestMarkdown()).toBe(renderManifestMarkdown());
  });

  test("static invariant verification: zero any and zero suppressions", () => {
    const testFile = readFileSync(__filename, "utf-8");
    expect(testFile).not.toContain("@ts-" + "ignore");
    expect(testFile).not.toContain("@ts-" + "expect-error");
    expect(testFile).not.toContain("eslint-" + "disable");
    expect(testFile).not.toContain(": " + "any");
  });
});
