import { type Envelope } from "../core/index.ts";
import { BRIEF_SET_SCHEMA, type MemberBriefPayload, type MemberBriefRecord } from "./types.ts";

export { BRIEF_SET_SCHEMA, type MemberBriefPayload, type MemberBriefRecord } from "./types.ts";

function isValidBriefPayload(value: unknown): value is MemberBriefPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.member_id === "string" &&
    candidate.member_id.length > 0 &&
    typeof candidate.text === "string" &&
    typeof candidate.updated_at === "string"
  );
}

function resolveBriefPayload(envelope: Envelope): MemberBriefPayload | null {
  if (envelope.body?.schema !== BRIEF_SET_SCHEMA) {
    return null;
  }
  if (isValidBriefPayload(envelope.body.data)) {
    return envelope.body.data;
  }
  if (isValidBriefPayload(envelope.body)) {
    return envelope.body;
  }
  return null;
}

export function foldMemberBriefs(
  envelopes: readonly Envelope[],
): ReadonlyMap<string, MemberBriefRecord> {
  const briefs = new Map<string, MemberBriefRecord>();
  const sorted = [...envelopes].sort((a, b) => a.seq - b.seq);

  for (const envelope of sorted) {
    const payload = resolveBriefPayload(envelope);
    if (payload === null) {
      continue;
    }

    const existing = briefs.get(payload.member_id);
    if (!existing || envelope.seq >= existing.seq) {
      briefs.set(payload.member_id, {
        member_id: payload.member_id,
        text: payload.text,
        updated_at: payload.updated_at,
        seq: envelope.seq,
      });
    }
  }

  return briefs;
}

export function extractMemberBrief(
  envelopes: readonly Envelope[],
  memberId: string,
): MemberBriefRecord | null {
  const briefs = foldMemberBriefs(envelopes);
  return briefs.get(memberId) ?? null;
}
