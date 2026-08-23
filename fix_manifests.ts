import { writeFileSync } from "fs";
import { join } from "path";
import { renderManifestMarkdown, renderManifestJson } from "./olt/scripts/src/cli/manifest.ts";
import { findRepoRoot } from "./olt/scripts/src/shared/paths.ts";

const repoRoot = findRepoRoot(process.cwd());
const references = join(repoRoot, "olt", "references");

writeFileSync(join(references, "cli-capabilities.md"), renderManifestMarkdown(), "utf-8");
writeFileSync(join(references, "cli-capabilities.json"), renderManifestJson(), "utf-8");
