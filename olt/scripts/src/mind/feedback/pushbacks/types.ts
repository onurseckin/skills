import type { DefectCategory, MindCandidateProposal } from "../../defects/index.ts";
import type { FeedbackItem } from "../queue/index.ts";

export interface PushbackItem {
  readonly id?: string | undefined;
  readonly title?: string | undefined;
  readonly issue: string;
  readonly resolution: string;
  readonly category?: DefectCategory | undefined;
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
  readonly by_category: Readonly<Record<DefectCategory, number>>;
  readonly candidate_proposals: readonly MindCandidateProposal[];
  readonly generated_at: string;
}
