#!/usr/bin/env bun

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderManifestJson, renderManifestMarkdown } from "./src/cli/manifest.ts";

export function manifestPaths(): { markdown: string; json: string } {
  const references = new URL("../references/", import.meta.url);
  return {
    markdown: fileURLToPath(new URL("cli-capabilities.md", references)),
    json: fileURLToPath(new URL("cli-capabilities.json", references)),
  };
}

export function writeManifest(): { markdown: string; json: string } {
  const paths = manifestPaths();
  writeFileSync(paths.markdown, renderManifestMarkdown(), "utf-8");
  writeFileSync(paths.json, renderManifestJson(), "utf-8");
  return paths;
}

if (import.meta.main) {
  const paths = writeManifest();
  process.stdout.write(`wrote ${paths.markdown}\nwrote ${paths.json}\n`);
}
