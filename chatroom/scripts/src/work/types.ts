import { createHash } from "node:crypto";

export type WorkItemType = "story" | "task" | "bug" | "question" | "decision";
export type WorkItemStatus = "open" | "in_progress" | "blocked" | "review" | "done" | "dropped";

export interface WorkItemNote {
  readonly author: string;
  readonly text: string;
  readonly at: string;
  readonly seq: number;
}

export interface WorkItem {
  readonly id: string;
  readonly room: string;
  readonly title: string;
  readonly type: WorkItemType;
  readonly status: WorkItemStatus;
  readonly assignee: string | null;
  readonly parent: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly accepted_at: string | null;
  readonly initial_seq: number;
  readonly notes: readonly WorkItemNote[];
  readonly topic_seqs: readonly number[];
}

export const TASK_NEW_SCHEMA = "chatroom.task.new.v1";
export const TASK_STATUS_SCHEMA = "chatroom.task.status.v1";
export const TASK_NOTE_SCHEMA = "chatroom.task.note.v1";
export const TASK_ACCEPTED_SCHEMA = "chatroom.task.accepted.v1";
export const BRIEF_SET_SCHEMA = "chatroom.member.brief.v1" as const;

export interface TaskNewPayload {
  readonly id?: string;
  readonly task_id?: string;
  readonly title?: string;
  readonly type?: WorkItemType;
  readonly status?: WorkItemStatus;
  readonly assignee?: string | null;
  readonly parent?: string | null;
  readonly parent_id?: string | null;
  readonly created_at?: string;
  readonly accepted_at?: string | null;
}

export interface TaskStatusPayload {
  readonly id?: string;
  readonly task_id?: string;
  readonly status: WorkItemStatus;
  readonly reason?: string;
}

export interface TaskNotePayload {
  readonly id?: string;
  readonly task_id?: string;
  readonly text: string;
  readonly author?: string;
  readonly at?: string;
  readonly seq?: number;
}

export interface TaskAcceptedPayload {
  readonly id?: string;
  readonly task_id?: string;
  readonly accepted_at?: string;
}

export interface MemberBriefPayload {
  readonly member_id: string;
  readonly text: string;
  readonly updated_at: string;
}

export interface MemberBriefRecord {
  readonly member_id: string;
  readonly text: string;
  readonly updated_at: string;
  readonly seq: number;
}

export function generateTaskId(seq: number, ts: string): string {
  const digest = createHash("sha256").update(`${seq}:${ts}`, "utf8").digest("hex").slice(0, 4);
  return `T-${digest}`;
}
