import { extractGeneration } from "./types.ts";
import { normalizeTags } from "./storage.ts";
import { resolveCharterPath, parseCharter } from "../../lifecycle/charter/index.ts";
import { parseDefectLog } from "../../defects/index.ts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import type { MemoryDocument } from "./types.ts";
import { createMemoryDocument } from "./storage.ts";
export function indexCharterDocuments(repoRoot: string): MemoryDocument[] {
  const documents: MemoryDocument[] = [];
  const visitedPaths = new Set<string>();

  const charterFullPath = resolveCharterPath(repoRoot);
  if (existsSync(charterFullPath)) {
    visitedPaths.add(resolve(charterFullPath));
    try {
      const content = readFileSync(charterFullPath, "utf-8");
      const parsed = parseCharter(content);
      const relPath = "olt/agents/mind.yaml";

      // Add root charter document
      documents.push(
        createMemoryDocument({
          id: "charter-root",
          kind: "charter",
          title: "Mind Charter (Core Directives & Invariants)",
          source_path: relPath,
          generation: null,
          tags: ["charter", "directive", "invariant", "core"],
          content,
          snippet: content.slice(0, 200),
          metadata: { file: relPath },
        }),
      );

      // Extract parsed goals G1, G2, etc.
      for (const goal of parsed.goals) {
        documents.push(
          createMemoryDocument({
            id: `charter-goal-${goal.id.toLowerCase()}`,
            kind: "charter",
            title: `Charter Goal ${goal.id}`,
            source_path: relPath,
            generation: null,
            tags: ["charter", "goal", goal.id.toLowerCase()],
            content: `${goal.id}: ${goal.statement}`,
            snippet: goal.statement,
            metadata: { goal_id: goal.id },
          }),
        );
      }
    } catch {
      // Charter parsing error handled non-fatally
    }
  }

  // Scan references directory for additional knowledge artifacts
  const refDir = join(repoRoot, "olt", "references");
  if (existsSync(refDir)) {
    try {
      const entries = readdirSync(refDir, { withFileTypes: true });
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (
          entry !== undefined &&
          entry.isFile() &&
          (entry.name.endsWith(".md") || entry.name.endsWith(".json"))
        ) {
          const filePath = join(refDir, entry.name);
          const absPath = resolve(filePath);
          if (!visitedPaths.has(absPath)) {
            visitedPaths.add(absPath);
            try {
              const content = readFileSync(filePath, "utf-8");
              documents.push(
                createMemoryDocument({
                  id: `reference-${entry.name.replace(/\.[^/.]+$/, "")}`,
                  kind: "charter",
                  title: `Reference: ${entry.name}`,
                  source_path: filePath,
                  generation: null,
                  tags: ["charter", "reference", entry.name.toLowerCase().replace(/\.[^/.]+$/, "")],
                  content,
                  snippet: content.slice(0, 200),
                  metadata: { file: entry.name },
                }),
              );
            } catch {
              // Ignore single file error
            }
          }
        }
      }
    } catch {
      // Non-fatal references scan error
    }
  }

  return documents;
}

/**
 * Indexes defects from defects.jsonl files across capsules and root directories.
 */
export function indexDefectDocuments(capsulesDir: string, explicitRun?: string): MemoryDocument[] {
  const documents: MemoryDocument[] = [];
  const filesToScan: Array<{ capsule: string; filePath: string }> = [];

  const rootDefects = join(capsulesDir, "defects.jsonl");
  if (existsSync(rootDefects)) {
    filesToScan.push({ capsule: "capsules-root", filePath: rootDefects });
  }

  if (existsSync(capsulesDir)) {
    try {
      const entries = readdirSync(capsulesDir, { withFileTypes: true });
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (entry !== undefined && entry.isDirectory()) {
          const defectPath = join(capsulesDir, entry.name, "defects.jsonl");
          if (existsSync(defectPath)) {
            filesToScan.push({ capsule: entry.name, filePath: defectPath });
          }
        }
      }
    } catch {
      // Non-fatal capsules directory scan error
    }
  }

  if (explicitRun !== undefined) {
    const explicitDefects = join(resolve(explicitRun), "defects.jsonl");
    if (existsSync(explicitDefects)) {
      filesToScan.push({ capsule: basename(resolve(explicitRun)), filePath: explicitDefects });
    }
  }

  for (let i = 0; i < filesToScan.length; i += 1) {
    const item = filesToScan[i];
    if (item === undefined) continue;
    try {
      const content = readFileSync(item.filePath, "utf-8");
      const lines = content.split("\n");
      for (let j = 0; j < lines.length; j += 1) {
        const line = lines[j];
        if (line === undefined || !line.trim()) continue;
        try {
          const parsed = JSON.parse(line.trim()) as Record<string, unknown>;
          if (typeof parsed.id === "string" && typeof parsed.type === "string") {
            const observation = typeof parsed.observation === "string" ? parsed.observation : "";
            const remediation = typeof parsed.remediation === "string" ? parsed.remediation : "";
            const status = typeof parsed.status === "string" ? parsed.status : "open";
            const severity = typeof parsed.severity === "string" ? parsed.severity : "warning";
            const category = typeof parsed.category === "string" ? parsed.category : "code_defect";

            const gen = extractGeneration(
              parsed,
              item.capsule !== "capsules-root" ? item.capsule : null,
            );
            const extraTags = Array.isArray(parsed.tags)
              ? (parsed.tags as string[])
              : Array.isArray(parsed.labels)
                ? (parsed.labels as string[])
                : [];

            const tags = normalizeTags([
              "defect",
              severity,
              status,
              category,
              parsed.type,
              ...(gen !== null ? [`gen-${gen}`] : []),
              ...extraTags,
            ]);

            const searchableContent = `${parsed.id} ${parsed.type} ${category} ${status} ${severity} ${observation} ${remediation}`;
            const snippet = `[${severity.toUpperCase()} | ${status}] ${observation} Remediation: ${remediation}`;

            documents.push(
              createMemoryDocument({
                id: `defect-${parsed.id}`,
                kind: "defect",
                title: `Defect [${parsed.id}]: ${parsed.type}`,
                capsule_id: item.capsule !== "capsules-root" ? item.capsule : null,
                generation: gen,
                tags,
                source_path: item.filePath,
                content: searchableContent,
                snippet,
                metadata: {
                  defect_id: parsed.id,
                  type: parsed.type,
                  severity,
                  status,
                  category,
                  observation,
                  remediation,
                  generation: gen,
                  tags,
                  pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
                  ppid: typeof parsed.ppid === "number" ? parsed.ppid : undefined,
                  agent_id: typeof parsed.agent_id === "string" ? parsed.agent_id : undefined,
                },
              }),
            );
          }
        } catch {
          // Ignore malformed line
        }
      }
    } catch {
      // Ignore file read error
    }
  }

  return documents;
}

/**
 * Indexes capsule state, prompt, trace, and tasks.
 */
