export const ID_REGEX = /^[a-z0-9][a-z0-9._-]{1,62}$/;

export type EnvelopeKind =
  | "message"
  | "dispatch"
  | "verdict"
  | "gate_result"
  | "roster"
  | "handshake"
  | "control";

export interface EnvelopeSender {
  readonly id: string;
  readonly role: string;
  readonly host: string;
  readonly repo_hint?: string;
  readonly pid?: number;
}

export interface EnvelopeBody {
  readonly schema: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface Envelope {
  readonly v: 1;
  readonly id: string;
  readonly room: string;
  readonly seq: number;
  readonly ts: string;
  readonly sender: EnvelopeSender;
  readonly kind: EnvelopeKind;
  readonly thread?: string;
  readonly reply_to: string | null;
  readonly mentions: readonly string[];
  readonly text?: string;
  readonly body: EnvelopeBody;
  readonly key_fingerprint: string;
  readonly redelivery_count?: number;
  readonly sig: string;
}

export type UnsignedEnvelope = Omit<Envelope, "sig" | "redelivery_count">;

export type RoomVisibility = "keyed" | "public";

export interface RoomSettings {
  readonly lease_ttl_ms: number;
  readonly max_payload_bytes: number;
  readonly segment_max_bytes: number;
  readonly segment_max_lines: number;
}

export interface RoomManifest {
  readonly v: 1;
  readonly id: string;
  readonly title: string;
  readonly visibility: RoomVisibility;
  readonly key_fingerprint: string;
  readonly created_at: string;
  readonly created_by: string;
  readonly settings: RoomSettings;
}

export interface MemberRecord {
  readonly v: 1;
  readonly id: string;
  readonly display_name: string;
  readonly role: string;
  readonly host: string;
  readonly repo_hint?: string;
  readonly joined_at: string;
  readonly key_fingerprint: string;
  readonly aliases: readonly string[];
}

export interface LogIndex {
  readonly next_seq: number;
  readonly segments: readonly string[];
  readonly head_seq: number;
  readonly updated_at: string;
}

export interface HeldLease {
  readonly lease: string;
  readonly from: number;
  readonly to: number;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly attempt: number;
}

export interface ReaderCursor {
  readonly v: 1;
  readonly room: string;
  readonly reader: string;
  readonly contiguous_seq: number;
  readonly held: readonly HeldLease[];
  readonly acked_above: readonly number[];
  readonly last_ack_at: string | null;
  readonly last_ack_kind: "spooled" | "explicit" | null;
  readonly updated_at: string;
  readonly checksum: string;
}

export interface RepoBinding {
  readonly member_id: string;
  readonly room_id?: string;
  readonly host?: string;
}

export interface InviteRecord {
  readonly code: string;
  readonly room: string;
  readonly expires_at: string;
  readonly uses_remaining: number;
  readonly wrapped_key: string;
  readonly created_by?: string;
}

export interface LockPayload {
  readonly pid: number;
  readonly holder: string;
  readonly created_at: string;
  readonly start_time?: string;
  readonly boot_id?: string;
  readonly host?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isValidId(value: unknown): value is string {
  return typeof value === "string" && ID_REGEX.test(value);
}

export function isEnvelopeKind(value: unknown): value is EnvelopeKind {
  return (
    value === "message" ||
    value === "dispatch" ||
    value === "verdict" ||
    value === "gate_result" ||
    value === "roster" ||
    value === "handshake" ||
    value === "control"
  );
}

export function isEnvelopeSender(value: unknown): value is EnvelopeSender {
  if (!isRecord(value)) return false;
  if (!isString(value.id) || value.id.length === 0) return false;
  if (!isString(value.role) || value.role.length === 0) return false;
  if (!isString(value.host) || value.host.length === 0) return false;
  if (value.repo_hint !== undefined && !isString(value.repo_hint)) return false;
  if (value.pid !== undefined && !isInteger(value.pid)) return false;
  return true;
}

export function isEnvelopeBody(value: unknown): value is EnvelopeBody {
  if (!isRecord(value)) return false;
  if (!isString(value.schema) || value.schema.length === 0) return false;
  if (!isRecord(value.data)) return false;
  return true;
}

export function isEnvelope(value: unknown): value is Envelope {
  if (!isRecord(value)) return false;
  if (value.v !== 1) return false;
  if (!isString(value.id) || value.id.length === 0) return false;
  if (!isString(value.room) || !isValidId(value.room)) return false;
  if (!isNonNegativeInteger(value.seq)) return false;
  if (!isString(value.ts) || value.ts.length === 0) return false;
  if (!isEnvelopeSender(value.sender)) return false;
  if (!isEnvelopeKind(value.kind)) return false;
  if (value.thread !== undefined && !isString(value.thread)) return false;
  if (value.reply_to !== null && !isString(value.reply_to)) return false;
  if (!isStringArray(value.mentions)) return false;
  if (value.text !== undefined && !isString(value.text)) return false;
  if (!isEnvelopeBody(value.body)) return false;
  if (!isString(value.key_fingerprint) || value.key_fingerprint.length === 0) return false;
  if (value.redelivery_count !== undefined && !isNonNegativeInteger(value.redelivery_count)) {
    return false;
  }
  if (!isString(value.sig) || value.sig.length === 0) return false;
  return true;
}

export function isUnsignedEnvelope(value: unknown): value is UnsignedEnvelope {
  if (!isRecord(value)) return false;
  if (value.v !== 1) return false;
  if (!isString(value.id) || value.id.length === 0) return false;
  if (!isString(value.room) || !isValidId(value.room)) return false;
  if (!isNonNegativeInteger(value.seq)) return false;
  if (!isString(value.ts) || value.ts.length === 0) return false;
  if (!isEnvelopeSender(value.sender)) return false;
  if (!isEnvelopeKind(value.kind)) return false;
  if (value.thread !== undefined && !isString(value.thread)) return false;
  if (value.reply_to !== null && !isString(value.reply_to)) return false;
  if (!isStringArray(value.mentions)) return false;
  if (value.text !== undefined && !isString(value.text)) return false;
  if (!isEnvelopeBody(value.body)) return false;
  if (!isString(value.key_fingerprint) || value.key_fingerprint.length === 0) return false;
  return true;
}

export function isRoomVisibility(value: unknown): value is RoomVisibility {
  return value === "keyed" || value === "public";
}

export function isRoomSettings(value: unknown): value is RoomSettings {
  if (!isRecord(value)) return false;
  if (!isPositiveInteger(value.lease_ttl_ms)) return false;
  if (!isPositiveInteger(value.max_payload_bytes)) return false;
  if (!isPositiveInteger(value.segment_max_bytes)) return false;
  if (!isPositiveInteger(value.segment_max_lines)) return false;
  return true;
}

export function isRoomManifest(value: unknown): value is RoomManifest {
  if (!isRecord(value)) return false;
  if (value.v !== 1) return false;
  if (!isValidId(value.id)) return false;
  if (!isString(value.title) || value.title.length === 0) return false;
  if (!isRoomVisibility(value.visibility)) return false;
  if (!isString(value.key_fingerprint) || value.key_fingerprint.length === 0) return false;
  if (!isString(value.created_at) || value.created_at.length === 0) return false;
  if (!isString(value.created_by) || value.created_by.length === 0) return false;
  if (!isRoomSettings(value.settings)) return false;
  return true;
}

export function isMemberRecord(value: unknown): value is MemberRecord {
  if (!isRecord(value)) return false;
  if (value.v !== 1) return false;
  if (!isValidId(value.id)) return false;
  if (!isString(value.display_name) || value.display_name.length === 0) return false;
  if (!isString(value.role) || value.role.length === 0) return false;
  if (!isString(value.host) || value.host.length === 0) return false;
  if (value.repo_hint !== undefined && !isString(value.repo_hint)) return false;
  if (!isString(value.joined_at) || value.joined_at.length === 0) return false;
  if (!isString(value.key_fingerprint) || value.key_fingerprint.length === 0) return false;
  if (!isStringArray(value.aliases)) return false;
  return true;
}

export function isLogIndex(value: unknown): value is LogIndex {
  if (!isRecord(value)) return false;
  if (!isPositiveInteger(value.next_seq)) return false;
  if (!isStringArray(value.segments)) return false;
  if (!isNonNegativeInteger(value.head_seq)) return false;
  if (!isString(value.updated_at) || value.updated_at.length === 0) return false;
  return true;
}

export function isHeldLease(value: unknown): value is HeldLease {
  if (!isRecord(value)) return false;
  if (!isString(value.lease) || value.lease.length === 0) return false;
  if (!isPositiveInteger(value.from)) return false;
  if (!isPositiveInteger(value.to) || value.to < value.from) return false;
  if (!isString(value.issued_at) || value.issued_at.length === 0) return false;
  if (!isString(value.expires_at) || value.expires_at.length === 0) return false;
  if (!isPositiveInteger(value.attempt)) return false;
  return true;
}

export function isReaderCursor(value: unknown): value is ReaderCursor {
  if (!isRecord(value)) return false;
  if (value.v !== 1) return false;
  if (!isValidId(value.room)) return false;
  if (!isValidId(value.reader)) return false;
  if (!isNonNegativeInteger(value.contiguous_seq)) return false;
  if (!Array.isArray(value.held) || !value.held.every(isHeldLease)) return false;
  if (!Array.isArray(value.acked_above) || !value.acked_above.every(isPositiveInteger))
    return false;
  if (value.last_ack_at !== null && !isString(value.last_ack_at)) return false;
  if (
    value.last_ack_kind !== undefined &&
    value.last_ack_kind !== null &&
    value.last_ack_kind !== "spooled" &&
    value.last_ack_kind !== "explicit"
  )
    return false;
  if (!isString(value.updated_at) || value.updated_at.length === 0) return false;
  if (!isString(value.checksum) || value.checksum.length === 0) return false;
  return true;
}

export function isRepoBinding(value: unknown): value is RepoBinding {
  if (!isRecord(value)) return false;
  if (!isValidId(value.member_id)) return false;
  if (value.room_id !== undefined && !isValidId(value.room_id)) return false;
  if (value.host !== undefined && (!isString(value.host) || value.host.length === 0)) return false;
  return true;
}

export function isInviteRecord(value: unknown): value is InviteRecord {
  if (!isRecord(value)) return false;
  if (!isString(value.code) || value.code.length === 0) return false;
  if (!isValidId(value.room)) return false;
  if (!isString(value.expires_at) || value.expires_at.length === 0) return false;
  if (!isNonNegativeInteger(value.uses_remaining)) return false;
  if (!isString(value.wrapped_key) || value.wrapped_key.length === 0) return false;
  if (value.created_by !== undefined && !isString(value.created_by)) return false;
  return true;
}

export function isLockPayload(value: unknown): value is LockPayload {
  if (!isRecord(value)) return false;
  if (!isInteger(value.pid) || value.pid <= 0) return false;
  if (!isString(value.holder) || value.holder.length === 0) return false;
  if (!isString(value.created_at) || value.created_at.length === 0) return false;
  if (value.start_time !== undefined && !isString(value.start_time)) return false;
  if (value.boot_id !== undefined && !isString(value.boot_id)) return false;
  if (value.host !== undefined && !isString(value.host)) return false;
  return true;
}
