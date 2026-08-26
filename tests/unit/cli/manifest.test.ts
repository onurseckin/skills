import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  capabilityManifest,
  commandSlice,
  domainSlice,
  MANIFEST_SCHEMA,
  renderDomainMarkdown,
  renderManifestMarkdown,
} from "../../../olt/scripts/src/cli/manifest.ts";
import {
  commandFilePath,
  loadCapabilitySplit,
  loadCommandDetail,
  renderCommandDetailJson,
  renderCommandIndexJsonl,
  renderSplitManifestJson,
  SPLIT_MANIFEST_SCHEMA,
} from "../../../olt/scripts/src/cli/manifest-split.ts";
import { COMMAND_DOMAINS, COMMAND_REGISTRY } from "../../../olt/scripts/src/cli/registry/index.ts";

const references = join(import.meta.dir, "..", "..", "..", "olt", "references");
const splitRoot = join(references, "cli-capabilities");

describe("CLI capability manifest", () => {
  test("checked-in index markdown matches the registry render", () => {
    expect(readFileSync(join(references, "cli-capabilities.md"), "utf-8")).toBe(
      renderManifestMarkdown(),
    );
  });

  test("checked-in per-domain markdown matches the registry render, for every domain", () => {
    for (const domain of COMMAND_DOMAINS) {
      const onDisk = readFileSync(join(splitRoot, "domains", `${domain}.md`), "utf-8");
      expect(onDisk).toBe(renderDomainMarkdown(domain));
    }
  });

  test("checked-in split manifest.json matches the registry render", () => {
    expect(readFileSync(join(splitRoot, "manifest.json"), "utf-8")).toBe(renderSplitManifestJson());
  });

  test("checked-in index.jsonl matches the registry render", () => {
    expect(readFileSync(join(splitRoot, "index.jsonl"), "utf-8")).toBe(renderCommandIndexJsonl());
  });

  test("checked-in per-command json matches the registry render, for every command", () => {
    const manifest = capabilityManifest();
    for (const command of manifest.commands) {
      const onDisk = readFileSync(
        join(splitRoot, commandFilePath(command.domain, command.name)),
        "utf-8",
      );
      expect(onDisk).toBe(renderCommandDetailJson(command));
    }
  });

  test("no stale generated files survive on disk beyond what the registry renders", () => {
    const expected = new Set<string>(["manifest.json", "index.jsonl"]);
    for (const command of capabilityManifest().commands) {
      expected.add(commandFilePath(command.domain, command.name));
    }
    for (const domain of COMMAND_DOMAINS) expected.add(`domains/${domain}.md`);

    const actual = new Set<string>();
    for (const entry of readdirSync(splitRoot)) {
      if (entry === "domains" || entry === "commands") continue;
      actual.add(entry);
    }
    for (const entry of readdirSync(join(splitRoot, "domains"))) actual.add(`domains/${entry}`);
    for (const domain of readdirSync(join(splitRoot, "commands"))) {
      for (const entry of readdirSync(join(splitRoot, "commands", domain))) {
        actual.add(`commands/${domain}/${entry}`);
      }
    }

    expect([...actual].sort()).toEqual([...expected].sort());
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

  test("every generated command file stays small enough to read in one grep hit", () => {
    for (const command of capabilityManifest().commands) {
      const path = join(splitRoot, commandFilePath(command.domain, command.name));
      const bytes = Buffer.byteLength(readFileSync(path, "utf-8"), "utf-8");
      expect(bytes).toBeLessThan(10_000);
    }
  });

  test("provides on-demand commandSlice for individual commands and aliases", () => {
    const execSlice = commandSlice("run:exec");
    expect(execSlice).toBeDefined();
    expect(execSlice?.name).toBe("run:exec");
    expect(execSlice?.takes_remainder).toBeTrue();

    const initAliasSlice = commandSlice("init");
    expect(initAliasSlice).toBeDefined();
    expect(initAliasSlice?.name).toBe("plan:init");

    const nonExistent = commandSlice("non:existent:command");
    expect(nonExistent).toBeUndefined();
  });

  test("provides on-demand domainSlice filtering commands by domain", () => {
    const planSlice = domainSlice("plan");
    expect(planSlice.schema).toBe(MANIFEST_SCHEMA);
    expect(planSlice.commands.length).toBeGreaterThan(0);
    expect(planSlice.commands.every((c) => c.domain === "plan")).toBeTrue();
  });

  test("renders deterministically so the freshness check cannot drift", () => {
    expect(renderCommandIndexJsonl()).toBe(renderCommandIndexJsonl());
    expect(renderSplitManifestJson()).toBe(renderSplitManifestJson());
    expect(renderManifestMarkdown()).toBe(renderManifestMarkdown());
    expect(renderDomainMarkdown("mind")).toBe(renderDomainMarkdown("mind"));
  });

  test("split manifest.json carries a digest that changes when the tree would change", () => {
    const parsed: unknown = JSON.parse(renderSplitManifestJson());
    if (typeof parsed !== "object" || parsed === null || !("digest" in parsed)) {
      throw new Error("split manifest must carry a digest field");
    }
    const digest = (parsed as { digest: unknown }).digest;
    expect(typeof digest).toBe("string");
    expect((digest as string).length).toBe(64);
    expect((parsed as { schema: unknown }).schema).toBe(SPLIT_MANIFEST_SCHEMA);
  });

  test("loader reconstitutes the exact in-memory shape the split tree was rendered from", () => {
    const loaded = loadCapabilitySplit({ root: splitRoot });
    const rendered = capabilityManifest();
    const byName = (manifest: typeof rendered) =>
      [...manifest.commands].sort((left, right) => left.name.localeCompare(right.name));
    expect(byName(loaded)).toEqual(byName(rendered));
    expect(loaded.schema).toBe(rendered.schema);
    expect(loaded.source).toBe(rendered.source);
  });

  test("loadCommandDetail resolves a single command file without touching the rest of the tree", () => {
    const detail = loadCommandDetail("mind", "mind:queue:add", { root: splitRoot });
    expect(detail.name).toBe("mind:queue:add");
    expect(detail.domain).toBe("mind");
    expect(detail.flags.some((flag) => flag.name === "title" && flag.required)).toBeTrue();
  });

  test("static invariant verification: zero any and zero suppressions", () => {
    const testFile = readFileSync(__filename, "utf-8");
    expect(testFile).not.toContain("@ts-" + "ignore");
    expect(testFile).not.toContain("@ts-" + "expect-error");
    expect(testFile).not.toContain("eslint-" + "disable");
    expect(testFile).not.toContain(": " + "any");
  });
});
