import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import type { MemoryDocument } from "./types.ts";
import { isRecord } from "./types.ts";
import { extractGenerationFromCapsuleId } from "./types.ts";
import { createMemoryDocument, normalizeTags } from "./storage.ts";
export function indexDecisionDocuments(
  capsulesDir: string,
  explicitRun?: string,
): MemoryDocument[] {
  const documents: MemoryDocument[] = [];
  const capsuleDirs: Array<{ name: string; path: string }> = [];

  if (existsSync(capsulesDir)) {
    try {
      const entries = readdirSync(capsulesDir, { withFileTypes: true });
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (entry !== undefined && entry.isDirectory() && !entry.name.startsWith(".")) {
          capsuleDirs.push({ name: entry.name, path: join(capsulesDir, entry.name) });
        }
      }
    } catch {
      // Non-fatal
    }
  }

  if (explicitRun !== undefined) {
    const explicitAbs = resolve(explicitRun);
    const capName = basename(explicitAbs);
    if (!capsuleDirs.some((c) => c.path === explicitAbs)) {
      capsuleDirs.push({ name: capName, path: explicitAbs });
    }
  }

  for (let i = 0; i < capsuleDirs.length; i += 1) {
    const cap = capsuleDirs[i];
    if (cap === undefined) continue;

    const gen = extractGenerationFromCapsuleId(cap.name);

    const statePath = join(cap.path, "state.json");
    if (existsSync(statePath)) {
      try {
        const stateRaw = readFileSync(statePath, "utf-8");
        const stateObj = JSON.parse(stateRaw) as Record<string, unknown>;

        // Index candidate admission/decline decisions
        if (Array.isArray(stateObj.candidates)) {
          for (let j = 0; j < stateObj.candidates.length; j += 1) {
            const cand = stateObj.candidates[j];
            if (isRecord(cand)) {
              const candId = typeof cand.id === "string" ? cand.id : `cand-${j}`;
              const statement = typeof cand.statement === "string" ? cand.statement : "";
              const rationale = typeof cand.rationale === "string" ? cand.rationale : "";
              const status = typeof cand.status === "string" ? cand.status : "unknown";
              const decidedBy = typeof cand.decided_by === "string" ? cand.decided_by : "";

              const content = `${candId} ${statement} ${rationale} ${status} ${decidedBy}`;
              const snippet = `Candidate [${candId}] (${status}): ${statement} | Rationale: ${rationale}`;

              documents.push(
                createMemoryDocument({
                  id: `decision-candidate-${candId}`,
                  kind: "decision",
                  title: `Candidate Decision: ${candId} (${status})`,
                  capsule_id: cap.name,
                  generation: gen,
                  tags: normalizeTags([
                    "decision",
                    "candidate",
                    status.toLowerCase(),
                    candId.toLowerCase(),
                    cap.name,
                    ...(gen !== null ? [`gen-${gen}`] : []),
                  ]),
                  source_path: statePath,
                  content,
                  snippet,
                  metadata: {
                    candidate_id: candId,
                    status,
                    statement,
                    rationale,
                    decided_by: decidedBy,
                    generation: gen,
                    capsule: cap.name,
                  },
                }),
              );
            }
          }
        }

        // Index audits
        if (Array.isArray(stateObj.audits)) {
          for (let j = 0; j < stateObj.audits.length; j += 1) {
            const audit = stateObj.audits[j];
            if (isRecord(audit)) {
              const auditId = typeof audit.id === "string" ? audit.id : `audit-${j}`;
              const verdict = typeof audit.verdict === "string" ? audit.verdict : "unknown";
              const actor = typeof audit.actor === "string" ? audit.actor : "";

              const content = `audit ${auditId} ${verdict} ${actor}`;
              const snippet = `Audit [${auditId}]: verdict ${verdict} decided by ${actor}`;

              documents.push(
                createMemoryDocument({
                  id: `decision-audit-${auditId}`,
                  kind: "decision",
                  title: `Audit Decision: ${auditId} (${verdict})`,
                  capsule_id: cap.name,
                  generation: gen,
                  tags: normalizeTags([
                    "decision",
                    "audit",
                    verdict.toLowerCase(),
                    auditId.toLowerCase(),
                    cap.name,
                    ...(gen !== null ? [`gen-${gen}`] : []),
                  ]),
                  source_path: statePath,
                  content,
                  snippet,
                  metadata: {
                    audit_id: auditId,
                    verdict,
                    actor,
                    generation: gen,
                    capsule: cap.name,
                  },
                }),
              );
            }
          }
        }
      } catch {
        // Ignore state parse error
      }
    }
  }

  return documents;
}

/**
 * Indexes reports and packets.
 */
export function indexReportDocuments(capsulesDir: string, explicitRun?: string): MemoryDocument[] {
  const documents: MemoryDocument[] = [];
  const capsuleDirs: Array<{ name: string; path: string }> = [];

  if (existsSync(capsulesDir)) {
    try {
      const entries = readdirSync(capsulesDir, { withFileTypes: true });
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (entry !== undefined && entry.isDirectory() && !entry.name.startsWith(".")) {
          capsuleDirs.push({ name: entry.name, path: join(capsulesDir, entry.name) });
        }
      }
    } catch {
      // Non-fatal
    }
  }

  if (explicitRun !== undefined) {
    const explicitAbs = resolve(explicitRun);
    const capName = basename(explicitAbs);
    if (!capsuleDirs.some((c) => c.path === explicitAbs)) {
      capsuleDirs.push({ name: capName, path: explicitAbs });
    }
  }

  for (let i = 0; i < capsuleDirs.length; i += 1) {
    const cap = capsuleDirs[i];
    if (cap === undefined) continue;

    const gen = extractGenerationFromCapsuleId(cap.name);

    // Scan reports directory
    const reportsDir = join(cap.path, "reports");
    if (existsSync(reportsDir)) {
      try {
        const reportEntries = readdirSync(reportsDir, { withFileTypes: true });
        for (let j = 0; j < reportEntries.length; j += 1) {
          const rentry = reportEntries[j];
          if (rentry !== undefined && rentry.isFile()) {
            const reportPath = join(reportsDir, rentry.name);
            try {
              const content = readFileSync(reportPath, "utf-8");
              const reportBase = rentry.name.replace(/\.[^/.]+$/, "");
              documents.push(
                createMemoryDocument({
                  id: `report-${cap.name}-${reportBase}`,
                  kind: "report",
                  title: `Report: ${rentry.name} (${cap.name})`,
                  capsule_id: cap.name,
                  generation: gen,
                  tags: normalizeTags([
                    "report",
                    reportBase.toLowerCase(),
                    cap.name,
                    ...(gen !== null ? [`gen-${gen}`] : []),
                  ]),
                  source_path: reportPath,
                  content,
                  snippet: content.slice(0, 200),
                  metadata: { filename: rentry.name, generation: gen, capsule: cap.name },
                }),
              );
            } catch {
              // Ignore single report error
            }
          }
        }
      } catch {
        // Non-fatal
      }
    }

    // Scan packets directory
    const packetsDir = join(cap.path, "packets");
    if (existsSync(packetsDir)) {
      try {
        const packetEntries = readdirSync(packetsDir, { withFileTypes: true });
        for (let j = 0; j < packetEntries.length; j += 1) {
          const pentry = packetEntries[j];
          if (pentry !== undefined && pentry.isDirectory()) {
            const packetMd = join(packetsDir, pentry.name, "packet.md");
            if (existsSync(packetMd)) {
              try {
                const packetContent = readFileSync(packetMd, "utf-8");
                documents.push(
                  createMemoryDocument({
                    id: `packet-${cap.name}-${pentry.name}`,
                    kind: "report",
                    title: `Role Packet: ${pentry.name} (${cap.name})`,
                    capsule_id: cap.name,
                    generation: gen,
                    tags: normalizeTags([
                      "report",
                      "packet",
                      pentry.name.toLowerCase(),
                      cap.name,
                      ...(gen !== null ? [`gen-${gen}`] : []),
                    ]),
                    source_path: packetMd,
                    content: packetContent,
                    snippet: packetContent.slice(0, 200),
                    metadata: { packet_id: pentry.name, generation: gen, capsule: cap.name },
                  }),
                );
              } catch {
                // Ignore
              }
            }
          }
        }
      } catch {
        // Non-fatal
      }
    }
  }

  return documents;
}

/**
 * Indexes archived objectives and candidate records from ARCHIVED_OBJECTIVES.jsonl.
 */
