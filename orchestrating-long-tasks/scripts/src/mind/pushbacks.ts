import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  categorizeBlunder,
  type BlunderCategory,
  type MindCandidateProposal,
} from "./blunders.ts";
import {
  readFeedbackQueue,
  type FeedbackCategory,
  type FeedbackItem,
} from "./feedback-queue.ts";

export interface PushbackItem {
  readonly id?: string | undefined;
  readonly title?: string | undefined;
  readonly issue: string;
  readonly resolution: string;
  readonly category?: BlunderCategory | undefined;
}

export interface PushbackInvariant {
  readonly invariant: string;
  readonly requirement: string;
  readonly status: string;
  readonly evidence: string;
}

export interface PushbackRecord {
  readonly pushback_number?: number | undefined;
  readonly generation?: number | undefined;
  readonly title: string;
  readonly items: readonly PushbackItem[];
  readonly invariants: readonly PushbackInvariant[];
  readonly raw_section?: string | undefined;
}

export interface PushbackAuditReport {
  readonly records: readonly PushbackRecord[];
  readonly feedback_items: readonly FeedbackItem[];
  readonly total_pushbacks: number;
  readonly total_feedback_items: number;
  readonly by_category: Readonly<Record<BlunderCategory, number>>;
  readonly candidate_proposals: readonly MindCandidateProposal[];
  readonly generated_at: string;
}

const DEFAULT_PUSHBACK_FILE = "USER_PUSHBACK_AND_SELF_AUDIT.md";

/**
 * Resolves the absolute path to USER_PUSHBACK_AND_SELF_AUDIT.md.
 */
export function resolvePushbackMarkdownPath(customPath?: string): string {
  if (customPath && customPath.trim()) {
    return resolve(customPath.trim());
  }
  const cwd = process.cwd();
  const directPath = join(cwd, DEFAULT_PUSHBACK_FILE);
  if (existsSync(directPath)) {
    return directPath;
  }
  const parentPath = join(dirname(cwd), DEFAULT_PUSHBACK_FILE);
  if (existsSync(parentPath)) {
    return parentPath;
  }
  return resolve(cwd, DEFAULT_PUSHBACK_FILE);
}

/**
 * Maps a feedback queue category or raw string to a canonical BlunderCategory:
 * - boundary_violation: AGENT_CONTRACTS, WATCHDOG, EXECUTION_EFFICIENCY, role_confusion, boundary violations
 * - model_reasoning_error: DOCUMENTATION, GENERAL, ARCHITECTURE, planning drift, reasoning errors
 * - code_defect: CLI_TOOLING, CORE_ENGINE, REPAIR, SCALING, CORE_SCHEDULER, VALIDATION_ENGINE, code defects
 */
export function mapFeedbackCategoryToBlunderCategory(
  category: FeedbackCategory | string,
): BlunderCategory {
  if (typeof category !== "string") {
    return "code_defect";
  }

  const normalized = category.trim().toUpperCase();

  if (normalized === "BOUNDARY_VIOLATION" || normalized === "ROLE_CONFUSION") {
    return "boundary_violation";
  }
  if (normalized === "MODEL_REASONING_ERROR") {
    return "model_reasoning_error";
  }
  if (normalized === "CODE_DEFECT") {
    return "code_defect";
  }

  switch (normalized) {
    case "AGENT_CONTRACTS":
    case "WATCHDOG":
    case "EXECUTION_EFFICIENCY":
      return "boundary_violation";

    case "DOCUMENTATION":
    case "GENERAL":
    case "ARCHITECTURE":
      return "model_reasoning_error";

    case "CLI_TOOLING":
    case "CORE_ENGINE":
    case "REPAIR":
    case "SCALING":
    case "CORE_SCHEDULER":
    case "VALIDATION_ENGINE":
      return "code_defect";

    default: {
      const lower = category.toLowerCase();
      if (
        lower.includes("boundary") ||
        lower.includes("role") ||
        lower.includes("restraint") ||
        lower.includes("contract") ||
        lower.includes("auth") ||
        lower.includes("confinement")
      ) {
        return "boundary_violation";
      }
      if (
        lower.includes("reason") ||
        lower.includes("logic") ||
        lower.includes("hallucination") ||
        lower.includes("doc") ||
        lower.includes("plan") ||
        lower.includes("paralysis") ||
        lower.includes("drift")
      ) {
        return "model_reasoning_error";
      }
      return "code_defect";
    }
  }
}

/**
 * Parses markdown table rows for invariants into PushbackInvariant objects.
 */
function parseInvariantsTable(lines: readonly string[]): PushbackInvariant[] {
  const invariants: PushbackInvariant[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    const trimmed = line.trim();

    if (trimmed.startsWith("|") && trimmed.includes("Invariant") && trimmed.includes("Requirement")) {
      inTable = true;
      continue;
    }

    if (inTable && trimmed.startsWith("|") && trimmed.includes("---")) {
      continue;
    }

    if (inTable && trimmed.startsWith("|")) {
      const parts = trimmed
        .split("|")
        .map((p) => p.trim())
        .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);

      if (parts.length >= 4) {
        const rawInv = parts[0] ?? "";
        const rawReq = parts[1] ?? "";
        const rawStat = parts[2] ?? "";
        const rawEv = parts[3] ?? "";

        // Clean markdown bolding
        const invName = rawInv.replace(/\*\*/g, "").trim();
        invariants.push({
          invariant: invName,
          requirement: rawReq,
          status: rawStat,
          evidence: rawEv,
        });
      }
    } else if (inTable && !trimmed.startsWith("|")) {
      inTable = false;
    }
  }

  return invariants;
}

/**
 * Parses USER_PUSHBACK_AND_SELF_AUDIT.md into structured PushbackRecord items.
 */
export function parsePushbackMarkdown(content: string): PushbackRecord[] {
  if (typeof content !== "string" || !content.trim()) {
    return [];
  }

  const lines = content.split("\n");
  const records: PushbackRecord[] = [];

  let currentSectionTitle = "";
  let currentPushbackNum: number | undefined = undefined;
  let currentGenNum: number | undefined = undefined;
  let lastKnownGenNum: number | undefined = undefined;
  let currentSectionLines: string[] = [];

  const flushSection = () => {
    if (!currentSectionTitle && currentSectionLines.length === 0) {
      return;
    }

    const items: PushbackItem[] = [];
    const invariants = parseInvariantsTable(currentSectionLines);

    // If section title is about invariants and generation wasn't in title, use lastKnownGenNum
    const effectiveGenNum =
      currentGenNum !== undefined
        ? currentGenNum
        : invariants.length > 0 && lastKnownGenNum !== undefined
          ? lastKnownGenNum
          : undefined;

    // Extract item blocks: e.g. "- **Pushback Item 1 (G1: Command De-duplication)**:"
    for (let j = 0; j < currentSectionLines.length; j += 1) {
      const line = currentSectionLines[j];
      if (line === undefined) {
        continue;
      }
      const trimmed = line.trim();

      const itemMatch = trimmed.match(
        /^(?:[-*]|\d+\.)\s+\*\*(?:Pushback Item|Item|\d+)?\s*(?:(\d+)|([^*]+))\*\*:\s*(.*)$/i,
      );

      const objectiveMatch = trimmed.match(
        /^\d+\.\s+\*\*(.+?)\*\*\s*(?:\((.+?)\))?:\s*(.*)$/,
      );

      if (itemMatch || objectiveMatch) {
        const itemTitle = itemMatch ? (itemMatch[2] ?? itemMatch[1] ?? "").trim() : (objectiveMatch ? (objectiveMatch[1] ?? "").trim() : "");
        let issue = itemMatch && itemMatch[3] ? itemMatch[3].trim() : "";
        let resolution = "";

        // Search following lines for Issue and Resolution or bullet sub-items
        for (let k = j + 1; k < Math.min(j + 15, currentSectionLines.length); k += 1) {
          const subLine = currentSectionLines[k];
          if (subLine === undefined) {
            break;
          }
          const subTrimmed = subLine.trim();

          if (
            subTrimmed.startsWith("###") ||
            subTrimmed.startsWith("##") ||
            subTrimmed.match(/^(?:[-*]|\d+\.)\s+\*\*(?:Pushback Item|Item|\d+)/i)
          ) {
            break;
          }

          if (subTrimmed.toLowerCase().includes("*issue*:") || subTrimmed.toLowerCase().includes("**issue**:")) {
            const issuePart = subTrimmed.split(/:/i)[1];
            if (issuePart) {
              issue = issuePart.replace(/\*/g, "").trim();
            }
          } else if (subTrimmed.toLowerCase().includes("*resolution*:") || subTrimmed.toLowerCase().includes("**resolution**:")) {
            const resPart = subTrimmed.split(/:/i)[1];
            if (resPart) {
              resolution = resPart.replace(/\*/g, "").trim();
            }
          } else if (subTrimmed.startsWith("-") && !issue && !resolution) {
            const bulletContent = subTrimmed.slice(1).trim();
            if (bulletContent) {
              if (!issue) {
                issue = bulletContent;
              } else if (!resolution) {
                resolution = bulletContent;
              }
            }
          }
        }

        if (itemTitle || issue || resolution) {
          const inferredCategory = categorizeBlunder({
            type: itemTitle,
            observation: issue,
            remediation: resolution,
          });

          items.push({
            title: itemTitle || undefined,
            issue: issue || itemTitle || "Pushback requirement",
            resolution: resolution || "Remediate pushback violation",
            category: inferredCategory,
          });
        }
      }
    }

    // If no individual bullet items were found, create a composite item from the section
    if (items.length === 0 && (currentPushbackNum !== undefined || effectiveGenNum !== undefined)) {
      const firstFewLines = currentSectionLines
        .filter((l) => l.trim() && !l.trim().startsWith("#") && !l.trim().startsWith("|"))
        .slice(0, 3)
        .join(" ");

      items.push({
        title: currentSectionTitle,
        issue: firstFewLines || currentSectionTitle,
        resolution: "Satisfy all canonical invariants for this generation",
        category: categorizeBlunder({
          type: currentSectionTitle,
          observation: firstFewLines,
          remediation: "Satisfy all canonical invariants",
        }),
      });
    }

    if (effectiveGenNum !== undefined) {
      const existingGenIdx = records.findIndex((r) => r.generation === effectiveGenNum && r.pushback_number === undefined);
      if (existingGenIdx !== -1) {
        const existingRec = records[existingGenIdx];
        if (existingRec !== undefined) {
          records[existingGenIdx] = {
            ...existingRec,
            title: existingRec.title.includes("Convergence") ? existingRec.title : currentSectionTitle,
            items: [...existingRec.items, ...items],
            invariants: [...existingRec.invariants, ...invariants],
            raw_section: `${existingRec.raw_section ?? ""}\n\n${currentSectionLines.join("\n")}`,
          };
          return;
        }
      }
    }

    records.push({
      ...(currentPushbackNum !== undefined ? { pushback_number: currentPushbackNum } : {}),
      ...(effectiveGenNum !== undefined ? { generation: effectiveGenNum } : {}),
      title: currentSectionTitle,
      items,
      invariants,
      raw_section: currentSectionLines.join("\n"),
    });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (rawLine === undefined) {
      continue;
    }
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("## ") || trimmed.startsWith("### ")) {
      flushSection();
      currentSectionTitle = trimmed.replace(/^#{2,3}\s+/, "").trim();
      currentSectionLines = [rawLine];

      // Extract Pushback Number e.g. "User Pushback #8: ..."
      const pushbackMatch = currentSectionTitle.match(/Pushback\s*#?(\d+)/i);
      currentPushbackNum = pushbackMatch && pushbackMatch[1] ? Number.parseInt(pushbackMatch[1], 10) : undefined;

      // Extract Generation Number e.g. "Pulse Generation 1 Convergence"
      const genMatch = currentSectionTitle.match(/Generation\s*(\d+)/i);
      currentGenNum = genMatch && genMatch[1] ? Number.parseInt(genMatch[1], 10) : undefined;
      if (currentGenNum !== undefined) {
        lastKnownGenNum = currentGenNum;
      }
    } else {
      currentSectionLines.push(rawLine);
    }
  }

  flushSection();

  return records;
}

/**
 * Ingests pushbacks from markdown audit docs and FEEDBACK_QUEUE.jsonl,
 * returning an aggregated PushbackAuditReport with candidate proposals.
 */
export function ingestPushbacks(
  markdownPath?: string,
  feedbackQueuePath?: string,
): PushbackAuditReport {
  const mdPath = resolvePushbackMarkdownPath(markdownPath);
  let records: PushbackRecord[] = [];
  if (existsSync(mdPath)) {
    try {
      const content = readFileSync(mdPath, "utf8");
      records = parsePushbackMarkdown(content);
    } catch {
      // Gracefully handle file read error
    }
  }

  const feedbackItems = readFeedbackQueue(feedbackQueuePath);

  const categoryCounts: Record<BlunderCategory, number> = {
    code_defect: 0,
    model_reasoning_error: 0,
    boundary_violation: 0,
  };

  const proposals: MindCandidateProposal[] = [];

  for (let i = 0; i < records.length; i += 1) {
    const rec = records[i];
    if (rec === undefined) {
      continue;
    }
    for (let j = 0; j < rec.items.length; j += 1) {
      const item = rec.items[j];
      if (item === undefined) {
        continue;
      }
      const cat = item.category ?? categorizeBlunder({
        type: item.title ?? rec.title,
        observation: item.issue,
        remediation: item.resolution,
      });

      categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;

      const candId = item.id
        ? `cand-pushback-${item.id}`
        : `cand-pushback-${rec.pushback_number ?? rec.generation ?? "audit"}-${j + 1}`;

      const statement = item.title
        ? `Remediate pushback: ${rec.title} - ${item.title}`
        : `Remediate pushback: ${rec.title} - ${item.issue.slice(0, 60)}`;

      const rationale = `Pushback issue: ${item.issue}. Prescribed resolution: ${item.resolution}`;

      const charterGoals =
        cat === "boundary_violation" ? ["G2"] : cat === "model_reasoning_error" ? ["G1"] : ["G1", "G2"];

      proposals.push({
        id: candId,
        kind: cat === "code_defect" ? "defect" : "proposal",
        statement,
        rationale,
        charter_goal_ids: charterGoals,
        write_scope: ["orchestrating-long-tasks/"],
        status: "needs_authority",
        disposition: "actionable",
        evidence_class: "user_pushback",
        created_at: new Date().toISOString(),
      });
    }
  }

  for (let i = 0; i < feedbackItems.length; i += 1) {
    const fb = feedbackItems[i];
    if (fb === undefined) {
      continue;
    }
    const cat = mapFeedbackCategoryToBlunderCategory(fb.category);
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;

    if (fb.status === "PENDING" || fb.status === "ADMITTED") {
      const candId = fb.candidate_id ?? `cand-feedback-${fb.id}`;
      const statement = `Remediate feedback [${fb.id}]: ${fb.title}`;
      const rationale = fb.content;
      const charterGoals =
        cat === "boundary_violation" ? ["G2"] : ["G1"];

      proposals.push({
        id: candId,
        kind: cat === "code_defect" ? "defect" : "proposal",
        statement,
        rationale,
        charter_goal_ids: charterGoals,
        write_scope: ["orchestrating-long-tasks/"],
        status: fb.status === "ADMITTED" ? "admitted" : "needs_authority",
        disposition: "actionable",
        evidence_class: "feedback_queue",
        created_at: fb.timestamp,
      });
    }
  }

  return {
    records,
    feedback_items: feedbackItems,
    total_pushbacks: records.length,
    total_feedback_items: feedbackItems.length,
    by_category: categoryCounts,
    candidate_proposals: proposals,
    generated_at: new Date().toISOString(),
  };
}
