import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { normalizeRoleName } from "../authority/manifest-parser.ts";
import type {
  AgentIdentity,
  AgentRoleDefinition,
  AgentReferenceDoc,
  AgentTriadOptions,
} from "./agent-triad-types.ts";
import { resolveWorkspacePaths } from "./agent-triad-paths.ts";

function extractDocTitle(content: string, fallbackId: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match && match[1]) {
    return match[1].trim();
  }
  return fallbackId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function inferDocCategory(id: string): string {
  if (id.startsWith("cli")) return "cli";
  if (id.includes("protocol")) return "protocol";
  if (id.includes("playbook")) return "playbook";
  if (id.includes("state") || id.includes("matrix")) return "architecture";
  if (id.includes("failure")) return "diagnostics";
  if (id.includes("schema")) return "schema";
  if (id.includes("adapter")) return "adapters";
  if (id.includes("config")) return "configuration";
  return "general";
}

const KNOWN_ROLES_TO_MATCH = [
  "mind",
  "orchestrator",
  "mind-auditor",
  "coordinator",
  "implementer",
  "validator",
  "mechanic-validator",
  "ui-mechanic-validator",
  "ui-validator",
  "repairer",
  "completeness-critic",
  "planner",
  "plan-validator",
  "validator-code-quality",
  "validator-ui-design",
  "validator-security",
  "validator-product",
  "validator-system-design",
  "sub-implementer",
  "sub-validator",
  "sub-investigator",
];

function extractReferencedRoles(content: string): readonly string[] {
  const found = new Set<string>();
  const lower = content.toLowerCase();
  for (const r of KNOWN_ROLES_TO_MATCH) {
    const pattern = new RegExp(`\\b${r}\\b`, "i");
    if (pattern.test(lower)) {
      found.add(r);
    }
  }
  return Array.from(found).sort();
}

export function loadAgentReferenceDocs(options?: AgentTriadOptions): readonly AgentReferenceDoc[] {
  const { referencesDir } = resolveWorkspacePaths(options);
  if (!existsSync(referencesDir)) {
    return [];
  }

  const docs: AgentReferenceDoc[] = [];
  try {
    const files = readdirSync(referencesDir);
    for (const file of files) {
      if (file.endsWith(".md") || file.endsWith(".json")) {
        const fullPath = join(referencesDir, file);
        const st = statSync(fullPath);
        const ext = extname(file);
        const id = basename(file, ext);
        const format = ext === ".json" ? "json" : "markdown";
        const content = readFileSync(fullPath, "utf-8");
        const title = format === "markdown" ? extractDocTitle(content, id) : `${id} (Schema)`;
        const category = inferDocCategory(id);
        const referencedRoles = extractReferencedRoles(content);

        docs.push({
          id,
          title,
          filePath: fullPath,
          category,
          description: `Reference documentation for ${title}`,
          sizeBytes: st.size,
          format,
          content,
          referencedRoles,
        });
      }
    }
  } catch {
    // Non-fatal, return collected docs
  }

  return docs.sort((a, b) => a.id.localeCompare(b.id));
}

export function findRelevantReferencesForRole(
  roleInput: string,
  allDocs: readonly AgentReferenceDoc[],
  identity?: AgentIdentity,
  definition?: AgentRoleDefinition,
): readonly AgentReferenceDoc[] {
  const normRole = normalizeRoleName(roleInput);
  const relevant: AgentReferenceDoc[] = [];

  const instructions = identity?.protocol?.instructions ?? "";
  const contractBody = definition?.body ?? "";
  const combinedContext = `${instructions} ${contractBody}`.toLowerCase();

  for (const doc of allDocs) {
    const docIdLower = doc.id.toLowerCase();
    const docRefRegex = new RegExp(`\\b${docIdLower}\\b`, "i");

    if (docRefRegex.test(combinedContext)) {
      relevant.push(doc);
      continue;
    }

    if (doc.referencedRoles && doc.referencedRoles.includes(normRole)) {
      relevant.push(doc);
      continue;
    }

    if (
      doc.id === "cli-capabilities" ||
      doc.id === "protocol" ||
      doc.id === "configuration" ||
      doc.id === "cli"
    ) {
      relevant.push(doc);
    }
  }

  const seen = new Set<string>();
  return relevant.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
}
