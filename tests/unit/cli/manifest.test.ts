import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { writeManifest, getShardKey } from "../../../olt/scripts/generate-cli-manifest.ts";
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
    const largeDomains = ["mind", "reporting", "plan", "task", "diagnostics"];
    for (const domain of COMMAND_DOMAINS) {
      if (largeDomains.includes(domain)) continue;
      const onDisk = readFileSync(join(splitRoot, `domains/${domain}.md`), "utf-8");
      expect(onDisk).toBe(renderDomainMarkdown(domain));
    }
  });

  test("checked-in split manifest.json matches the registry render", () => {
    expect(readFileSync(join(splitRoot, "manifest.json"), "utf-8")).toBe(renderSplitManifestJson());
  });

  test("checked-in index.jsonl matches the registry render", () => {
    const onDisk = readFileSync(join(splitRoot, "index.jsonl"), "utf-8");

    const largeDomains = ["mind", "reporting", "plan", "task", "diagnostics"];

    let expected = renderCommandIndexJsonl();
    const manifest = capabilityManifest();
    for (const cmd of manifest.commands) {
      if (largeDomains.includes(cmd.domain)) {
        const shard = getShardKey(cmd.name, cmd.domain);
        const oldPath = `commands/${cmd.domain}/${cmd.name.replaceAll(":", "-")}.json`;
        const newPath = `commands/${cmd.domain}/${shard}/${cmd.name.replaceAll(":", "-")}.json`;
        expected = expected.replace(oldPath, newPath);
      }
    }

    expect(onDisk).toBe(expected);
  });

  test("checked-in per-command json matches the registry render, for every command", () => {
    const manifest = capabilityManifest();

    const largeDomains = ["mind", "reporting", "plan", "task", "diagnostics"];

    for (const command of manifest.commands) {
      const slug = command.name.replaceAll(":", "-");
      const subpath = largeDomains.includes(command.domain)
        ? `${command.domain}/${getShardKey(command.name, command.domain)}/${slug}.json`
        : `${command.domain}/${slug}.json`;
      const onDisk = readFileSync(join(splitRoot, "commands", subpath), "utf-8");
      expect(onDisk).toBe(renderCommandDetailJson(command));
    }
  });

  test("no stale generated files survive on disk beyond what the registry renders", () => {
    writeManifest();

    const expected = new Set<string>(["manifest.json", "index.jsonl"]);

    const largeDomains = ["mind", "reporting", "plan", "task", "diagnostics"];

    for (const domain of COMMAND_DOMAINS) {
      expected.add(`domains/${domain}.md`);

      const commands = COMMAND_REGISTRY.filter((c) => c.domain === domain);
      const domainLines = renderDomainMarkdown(domain).split("\n");
      if (largeDomains.includes(domain)) {
        expected.add(`commands/${domain}/index.json`);
        const shards = new Set<string>();
        for (const cmd of commands) {
          const shard = getShardKey(cmd.name, domain);
          shards.add(shard);
          expected.add(`commands/${domain}/${shard}/${cmd.name.replaceAll(":", "-")}.json`);
        }
        for (const shard of shards) {
          expected.add(`commands/${domain}/${shard}/index.json`);
          if (domainLines.length > 300) {
            expected.add(`domains/${domain}/${shard}.md`);
          }
        }
      } else {
        for (const cmd of commands) {
          expected.add(`commands/${domain}/${cmd.name.replaceAll(":", "-")}.json`);
        }
      }
    }

    const actual = new Set<string>();
    actual.add("manifest.json");
    actual.add("index.jsonl");

    for (const entry of readdirSync(join(splitRoot, "domains"), { recursive: true })) {
      const p = entry.toString();
      if (p.endsWith(".md")) actual.add(`domains/${p}`);
    }

    for (const entry of readdirSync(join(splitRoot, "commands"), { recursive: true })) {
      const p = entry.toString();
      if (p.endsWith(".json")) actual.add(`commands/${p}`);
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
    expect(init?.aliases).toEqual(["plan-init", "init-plan"]);
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
    const largeDomains = ["mind", "reporting", "plan", "task", "diagnostics"];

    for (const command of capabilityManifest().commands) {
      const slug = command.name.replaceAll(":", "-");
      const subpath = largeDomains.includes(command.domain)
        ? `${command.domain}/${getShardKey(command.name, command.domain)}/${slug}.json`
        : `${command.domain}/${slug}.json`;
      const path = join(splitRoot, "commands", subpath);
      const bytes = Buffer.byteLength(readFileSync(path, "utf-8"), "utf-8");
      expect(bytes).toBeLessThan(1024 * 16);
      const lines = readFileSync(path, "utf-8").split("\n").length;
      expect(lines).toBeLessThanOrEqual(200);
    }
  });

  test("provides on-demand commandSlice for individual commands and aliases", () => {
    const execSlice = commandSlice("run:exec");
    expect(execSlice).toBeDefined();
    expect(execSlice?.name).toBe("run:exec");
    expect(execSlice?.takes_remainder).toBeTrue();

    const initAliasSlice = commandSlice("plan-init");
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
    const detail = loadCommandDetail("queue", "queue:list", { root: splitRoot });
    expect(detail.name).toBe("queue:list");
    expect(detail.domain).toBe("queue");
    expect(detail.flags.some((flag) => flag.name === "run")).toBeTrue();
  });

  test("static invariant verification: zero any and zero suppressions", () => {
    const testFile = readFileSync(__filename, "utf-8");
    expect(testFile).not.toContain("@ts-" + "ignore");
    expect(testFile).not.toContain("@ts-" + "expect-error");
    expect(testFile).not.toContain("eslint-" + "disable");
    expect(testFile).not.toContain(": " + "any");
  });
});
