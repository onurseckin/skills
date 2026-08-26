#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDomainMarkdown, renderManifestMarkdown } from "./src/cli/manifest.ts";
import { domainFilePath, renderSplitFiles } from "./src/cli/manifest-split.ts";
import { COMMAND_DOMAINS } from "./src/cli/registry/index.ts";

export function manifestPaths(): { markdown: string; splitRoot: string } {
  const references = new URL("../references/", import.meta.url);
  return {
    markdown: fileURLToPath(new URL("cli-capabilities.md", references)),
    splitRoot: fileURLToPath(new URL("cli-capabilities/", references)),
  };
}

export function writeManifest(): { markdown: string; splitFiles: string[] } {
  const paths = manifestPaths();
  writeFileSync(paths.markdown, renderManifestMarkdown(), "utf-8");

  const splitFiles: string[] = [];
  for (const file of renderSplitFiles()) {
    const target = `${paths.splitRoot}${file.path}`;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, "utf-8");
    splitFiles.push(target);
  }
  for (const domain of COMMAND_DOMAINS) {
    const target = `${paths.splitRoot}${domainFilePath(domain)}`;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, renderDomainMarkdown(domain), "utf-8");
    splitFiles.push(target);
  }
  return { markdown: paths.markdown, splitFiles };
}

if (import.meta.main) {
  const result = writeManifest();
  process.stdout.write(
    `wrote ${result.markdown}\nwrote ${result.splitFiles.length} files under ${manifestPaths().splitRoot}\n`,
  );
}
