import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND_REGISTRY } from "../../../olt/scripts/src/cli/registry/index.ts";
import type { CommandSpec } from "../../../olt/scripts/src/cli/registry/types.ts";

interface JsonFlagSpec {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly repeatable: boolean;
  readonly default: unknown;
}

interface JsonCommandCapability {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly domain: string;
  readonly summary: string;
  readonly flags: readonly JsonFlagSpec[];
  readonly reads_stdin: boolean;
  readonly takes_remainder: boolean;
}

function collectJsonManifestPaths(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsonManifestPaths(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".json") && entry.name !== "index.json") {
      results.push(fullPath);
    }
  }
  return results;
}

describe("CLI Capabilities Schema Parity", () => {
  const capabilitiesRoot = join(process.cwd(), "olt", "references", "cli-capabilities", "commands");
  const manifestPaths = collectJsonManifestPaths(capabilitiesRoot);
  const jsonManifests: JsonCommandCapability[] = manifestPaths.map((p) => {
    const raw = readFileSync(p, "utf8");
    return JSON.parse(raw) as JsonCommandCapability;
  });
  const jsonByName = new Map<string, JsonCommandCapability>();
  for (const m of jsonManifests) {
    jsonByName.set(m.name, m);
  }

  const specByName = new Map<string, CommandSpec>();
  for (const s of COMMAND_REGISTRY) {
    specByName.set(s.name, s);
  }

  it("loads valid JSON manifests from capability references", () => {
    expect(manifestPaths.length).toBeGreaterThan(0);
    expect(jsonManifests.length).toBeGreaterThan(0);
  });

  it("ensures every registered command has a matching JSON capability manifest", () => {
    const missingInJson: string[] = [];
    for (const spec of COMMAND_REGISTRY) {
      if (!jsonByName.has(spec.name)) {
        missingInJson.push(spec.name);
      }
    }
    expect(missingInJson).toEqual([]);
  });

  it("ensures every JSON capability manifest corresponds to a registered command", () => {
    const extraInJson: string[] = [];
    for (const manifest of jsonManifests) {
      if (!specByName.has(manifest.name)) {
        extraInJson.push(manifest.name);
      }
    }
    expect(extraInJson).toEqual([]);
  });

  it("verifies 1:1 bidirectional property parity between CommandSpec and JSON capability manifests", () => {
    for (const spec of COMMAND_REGISTRY) {
      const json = jsonByName.get(spec.name);
      expect(json).toBeDefined();
      if (!json) continue;

      expect(json.name).toBe(spec.name);
      expect(json.domain).toBe(spec.domain);
      expect(json.reads_stdin).toBe(spec.readsStdin);
      expect(json.takes_remainder).toBe(spec.takesRemainder);

      const specFlagNames = spec.flags.map((f) => f.name).sort();
      const jsonFlagNames = json.flags.map((f) => f.name).sort();
      expect(jsonFlagNames).toEqual(specFlagNames);

      for (const specFlag of spec.flags) {
        const jsonFlag = json.flags.find((f) => f.name === specFlag.name);
        expect(jsonFlag).toBeDefined();
        if (jsonFlag) {
          expect(jsonFlag.type).toBe(specFlag.type);
          expect(jsonFlag.repeatable).toBe(specFlag.repeatable);
        }
      }
    }
  });
});
