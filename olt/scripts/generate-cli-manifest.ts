#!/usr/bin/env bun
import * as fs from "node:fs";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMAND_DOMAINS } from "./src/cli/registry/index.ts";
import {
  renderDomainMarkdown,
  renderManifestMarkdown,
  commandSection,
  capabilityManifest,
  domainCommandSpecs,
} from "./src/cli/manifest.ts";
import {
  renderCommandIndexJsonl,
  renderCommandDetailJson,
  splitManifest,
} from "./src/cli/manifest-split.ts";

export function manifestPaths(): { markdown: string; splitRoot: string } {
  const references = new URL("../references/", import.meta.url);
  return {
    markdown: fileURLToPath(new URL("cli-capabilities.md", references)),
    splitRoot: fileURLToPath(new URL("cli-capabilities/", references)),
  };
}

export function getShardKey(commandName: string, domain: string): string {
  if (domain === "mind") {
    if (commandName.includes("queue")) return "queue";
    if (commandName.includes("audit")) return "audit";
    if (["memory", "smart-task"].some((k) => commandName.includes(k))) return "knowledge";
    if (commandName.includes("pulse")) return "pulse";
    if (commandName.includes("round")) return "round";
    if (["admit", "decline", "candidate", "bootstrap", "init"].some((k) => commandName.includes(k)))
      return "admission";
    return "lifecycle";
  }
  if (domain === "reporting") {
    if (commandName.includes("quota")) return "quota";
    if (commandName.includes("dag")) return "dag";
    if (["report-", "test-summary", "report"].some((k) => commandName.includes(k)))
      return "reports";
    if (commandName.includes("stream")) return "stream";
    return "telemetry";
  }
  if (domain === "plan") {
    if (
      ["validate", "audit", "review", "claim", "apply", "replan"].some((k) =>
        commandName.includes(k),
      )
    )
      return "validation";
    return "authoring";
  }
  if (domain === "task") {
    if (["review", "validate"].some((k) => commandName.includes(k))) return "review";
    if (["claim", "submit", "assign", "lease", "heartbeat"].some((k) => commandName.includes(k)))
      return "lifecycle";
    if (["abandon", "release", "fail", "complete", "prune"].some((k) => commandName.includes(k)))
      return "terminal";
    return "ops";
  }
  if (domain === "diagnostics") {
    if (["doctor", "health", "recover"].some((k) => commandName.includes(k))) return "doctor";
    if (["finding", "defect", "audit", "coverage"].some((k) => commandName.includes(k)))
      return "audit";
    return "tools";
  }
  return "core";
}

export function writeManifest(): { markdown: string; splitFiles: string[] } {
  const paths = manifestPaths();

  if (!existsSync(paths.splitRoot)) {
    mkdirSync(paths.splitRoot, { recursive: true });
  }

  writeFileSync(paths.markdown, renderManifestMarkdown(), "utf-8");
  const splitFiles: string[] = [];

  const manifestData = splitManifest();
  writeFileSync(
    join(paths.splitRoot, "manifest.json"),
    JSON.stringify(manifestData, null, 2) + "\n",
    "utf-8",
  );
  splitFiles.push(join(paths.splitRoot, "manifest.json"));

  const largeDomains = ["mind", "reporting", "plan", "task", "diagnostics"];
  const allCommands = capabilityManifest().commands;

  let indexJsonl = renderCommandIndexJsonl();
  for (const cmd of allCommands) {
    if (largeDomains.includes(cmd.domain)) {
      const shard = getShardKey(cmd.name, cmd.domain);
      const oldPath = `commands/${cmd.domain}/${cmd.name.replaceAll(":", "-")}.json`;
      const newPath = `commands/${cmd.domain}/${shard}/${cmd.name.replaceAll(":", "-")}.json`;
      indexJsonl = indexJsonl.replace(oldPath, newPath);
    }
  }

  writeFileSync(join(paths.splitRoot, "index.jsonl"), indexJsonl, "utf-8");
  splitFiles.push(join(paths.splitRoot, "index.jsonl"));

  for (const domain of COMMAND_DOMAINS) {
    const specs = domainCommandSpecs(domain);
    const domainCommands = allCommands.filter((c) => c.domain === domain);

    let domainMarkdown = renderDomainMarkdown(domain);
    const domainLines = domainMarkdown.split("\n");

    if (domainLines.length > 300 && largeDomains.includes(domain)) {
      const shards = new Map<string, string[]>();
      for (const spec of specs) {
        const shard = getShardKey(spec.name, domain);
        const existing = shards.get(shard);
        if (existing) {
          existing.push(...commandSection(spec));
        } else {
          shards.set(shard, [
            `# CLI Capability Manifest \u2014 ${domain} (${shard})`,
            "",
            `Generated from \`olt/scripts/src/cli/registry\` by \`olt/scripts/generate-cli-manifest.ts\`. Do not edit by`,
            "hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).",
            "",
            ...commandSection(spec),
          ]);
        }
      }

      const domainIndexContent = [
        `# CLI Capability Manifest \u2014 ${domain}`,
        "",
        `Generated from \`olt/scripts/src/cli/registry\` by \`olt/scripts/generate-cli-manifest.ts\`. Do not edit by`,
        "hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).",
        "",
        "## Shards",
        "",
      ];

      const sortedShards = Array.from(shards.keys()).sort();
      for (const shard of sortedShards) {
        const lines = shards.get(shard);
        if (!lines) {
          continue;
        }
        const shardFile = `domains/${domain}/${shard}.md`;
        domainIndexContent.push(`- [${shard}](${domain}/${shard}.md)`);

        const target = join(paths.splitRoot, shardFile);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, lines.join("\n").trimEnd() + "\n", "utf-8");
        splitFiles.push(target);
      }

      const target = join(paths.splitRoot, `domains/${domain}.md`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, domainIndexContent.join("\n") + "\n", "utf-8");
      splitFiles.push(target);
    } else {
      const target = join(paths.splitRoot, `domains/${domain}.md`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, domainMarkdown, "utf-8");
      splitFiles.push(target);
    }

    if (largeDomains.includes(domain)) {
      const entries: Array<{ id: string; path: string }> = [];
      const shards = new Map<string, Array<{ id: string; path: string }>>();

      for (const cmd of domainCommands) {
        const shard = getShardKey(cmd.name, domain);
        const targetPath = `${shard}/${cmd.name.replaceAll(":", "-")}.json`;

        const fullTarget = join(paths.splitRoot, `commands/${domain}`, targetPath);
        mkdirSync(dirname(fullTarget), { recursive: true });
        writeFileSync(fullTarget, renderCommandDetailJson(cmd), "utf-8");
        splitFiles.push(fullTarget);

        const existingShard = shards.get(shard);
        if (existingShard) {
          existingShard.push({ id: cmd.name, path: `${cmd.name.replaceAll(":", "-")}.json` });
        } else {
          shards.set(shard, [{ id: cmd.name, path: `${cmd.name.replaceAll(":", "-")}.json` }]);
        }
      }

      const domainEntries: Array<{ id: string; path: string }> = [];
      const sortedShards = Array.from(shards.keys()).sort();
      for (const shard of sortedShards) {
        const shardEntries = shards.get(shard);
        if (!shardEntries) {
          continue;
        }
        const shardIndex = {
          schema: "olt-cli-catalog/v1",
          domain: domain,
          entries: shardEntries,
        };
        const shardIndexPath = join(paths.splitRoot, `commands/${domain}/${shard}/index.json`);
        writeFileSync(shardIndexPath, JSON.stringify(shardIndex, null, 2) + "\n", "utf-8");
        splitFiles.push(shardIndexPath);

        domainEntries.push({ id: shard, path: `${shard}/index.json` });
      }

      const domainIndex = {
        schema: "olt-cli-catalog/v1",
        domain: domain,
        entries: domainEntries,
      };

      const target = join(paths.splitRoot, `commands/${domain}/index.json`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(domainIndex, null, 2) + "\n", "utf-8");
      splitFiles.push(target);
    } else {
      for (const cmd of domainCommands) {
        const targetPath = `${cmd.name.replaceAll(":", "-")}.json`;

        const fullTarget = join(paths.splitRoot, `commands/${domain}`, targetPath);
        mkdirSync(dirname(fullTarget), { recursive: true });
        writeFileSync(fullTarget, renderCommandDetailJson(cmd), "utf-8");
        splitFiles.push(fullTarget);
      }
    }
  }

  const generated = new Set(splitFiles);
  function cleanDir(dir: string) {
    if (!existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = require("node:path").join(dir, entry.name);
      if (entry.isDirectory()) {
        cleanDir(fullPath);
        if (fs.readdirSync(fullPath).length === 0) {
          fs.rmdirSync(fullPath);
        }
      } else {
        if (!generated.has(fullPath)) {
          fs.rmSync(fullPath);
        }
      }
    }
  }
  cleanDir(paths.splitRoot);

  return { markdown: paths.markdown, splitFiles };
}

if (import.meta.main) {
  const result = writeManifest();
  process.stdout.write(
    `wrote ${result.markdown}\nwrote ${result.splitFiles.length} files under ${manifestPaths().splitRoot}\n`,
  );
}
