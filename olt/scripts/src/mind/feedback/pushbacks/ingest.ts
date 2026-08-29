import { existsSync, readFileSync } from "node:fs";
import {
  categorizeDefect,
  type DefectCategory,
  type MindCandidateProposal,
} from "../../defects/index.ts";
import { readFeedbackQueue } from "../queue/index.ts";
import type { PushbackRecord, PushbackAuditReport } from "./types.ts";
import { resolvePushbackMarkdownPath, mapFeedbackCategoryToDefectCategory } from "./resolver.ts";
import { parsePushbackMarkdown } from "./parser.ts";

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

  const categoryCounts: Record<DefectCategory, number> = {
    code_defect: 0,
    model_reasoning_error: 0,
    boundary_violation: 0,
    documentation: 0,
    security_risk: 0,
    modularity_violation: 0,
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
      const cat =
        item.category ??
        categorizeDefect({
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
        cat === "boundary_violation"
          ? ["G2"]
          : cat === "model_reasoning_error"
            ? ["G1"]
            : ["G1", "G2"];

      proposals.push({
        id: candId,
        kind: cat === "code_defect" ? "defect" : "proposal",
        statement,
        rationale,
        charter_goal_ids: charterGoals,
        write_scope: ["olt/"],
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
    const cat = mapFeedbackCategoryToDefectCategory(fb.category);
    categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;

    if (fb.status === "PENDING" || fb.status === "ADMITTED") {
      const candId = fb.candidate_id ?? `cand-feedback-${fb.id}`;
      const statement = `Remediate feedback [${fb.id}]: ${fb.title}`;
      const rationale = fb.content;
      const charterGoals = cat === "boundary_violation" ? ["G2"] : ["G1"];

      proposals.push({
        id: candId,
        kind: cat === "code_defect" ? "defect" : "proposal",
        statement,
        rationale,
        charter_goal_ids: charterGoals,
        write_scope: ["olt/"],
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
