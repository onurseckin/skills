import { dirname } from "node:path";
import {
  ChatError,
  roomLogDir,
  roomLogIndexPath,
  roomLogSegmentPath,
  roomManifestPath,
  roomMemberPath,
  roomMembersDir,
  type Envelope,
  type UnsignedEnvelope,
} from "../../src/core/index.ts";
import { signEnvelope } from "../../src/crypto/index.ts";
import { ChatVirtualFS } from "../../src/testing/virtual-fs/index.ts";
import {
  BRIEF_SET_SCHEMA,
  type ExtendedHealthPorts,
  type MemberBriefRecord,
} from "../../src/work/index.ts";

export interface JoinContractInput {
  readonly room: string;
  readonly as: string;
  readonly brief?: string;
  readonly role?: string;
  readonly host?: string;
}

export interface JoinContractResult {
  readonly joined: boolean;
  readonly grandfathered: boolean;
  readonly briefRecord: MemberBriefRecord | null;
}

export function createHealthPorts(vfs: ChatVirtualFS): ExtendedHealthPorts {
  const ensure = (p: string) => vfs.mkdirSync(dirname(p), { recursive: true });
  return {
    existsSync: (t: string) => vfs.existsSync(t),
    readFileSync: (t: string, enc: string) => vfs.readFileSync(t, enc) as string,
    writeFileSync: (t: string, c: string) => {
      ensure(t);
      vfs.writeFileSync(t, c);
    },
    writeAtomic: (t: string, c: string) => {
      ensure(t);
      vfs.writeFileSync(t, c);
    },
    readdirSync: (t: string) => vfs.readdirSync(t) as string[],
    statSync: (t: string) => ({ isDirectory: () => vfs.statSync(t).isDirectory() }),
  };
}

export function makeEnvelope(
  room: string,
  seq: number,
  schema: string,
  data: Readonly<Record<string, unknown>>,
  senderId = "coordinator",
): Envelope {
  const unsigned: UnsignedEnvelope = {
    v: 1,
    id: `msg-${seq}-${room}`,
    room,
    seq,
    ts: `2026-09-07T10:00:0${seq}.000Z`,
    sender: { id: senderId, role: "agent", host: "antigravity" },
    kind: "message",
    reply_to: null,
    mentions: [],
    body: { schema, data },
    key_fingerprint: "sha256:12345678",
  };
  return signEnvelope(unsigned, "test-secret-key");
}

export function appendToVirtualLog(vfs: ChatVirtualFS, room: string, envelope: Envelope): void {
  const segPath = roomLogSegmentPath(room, "000001.jsonl");
  vfs.mkdirSync(dirname(segPath), { recursive: true });
  const existing = vfs.existsSync(segPath) ? (vfs.readFileSync(segPath, "utf8") as string) : "";
  vfs.writeFileSync(segPath, `${existing}${JSON.stringify(envelope)}\n`);
  const indexPath = roomLogIndexPath(room);
  vfs.writeFileSync(
    indexPath,
    JSON.stringify({
      next_seq: envelope.seq + 1,
      segments: ["000001.jsonl"],
      head_seq: envelope.seq,
      updated_at: envelope.ts,
    }),
  );
}

export function readVirtualLogEnvelopes(vfs: ChatVirtualFS, room: string): readonly Envelope[] {
  const segPath = roomLogSegmentPath(room, "000001.jsonl");
  if (!vfs.existsSync(segPath)) return [];
  return (vfs.readFileSync(segPath, "utf8") as string)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Envelope);
}

export function seedRoom(vfs: ChatVirtualFS, room: string): void {
  vfs.mkdirSync(roomLogDir(room), { recursive: true });
  vfs.mkdirSync(roomMembersDir(room), { recursive: true });
  vfs.writeFileSync(
    roomManifestPath(room),
    JSON.stringify({
      v: 1,
      id: room,
      title: `Room ${room}`,
      visibility: "public",
      key_fingerprint: "sha256:12345678",
      created_at: "2026-09-07T10:00:00.000Z",
      created_by: "system",
    }),
  );
}

export function seedExistingMember(vfs: ChatVirtualFS, room: string, memberId: string): void {
  const p = roomMemberPath(room, memberId);
  vfs.mkdirSync(dirname(p), { recursive: true });
  vfs.writeFileSync(
    p,
    JSON.stringify({
      v: 1,
      id: memberId,
      role: "agent",
      host: "antigravity",
      joined_at: "2026-09-07T10:00:00.000Z",
    }),
  );
}

export function joinRoomWithBriefContract(
  vfs: ChatVirtualFS,
  input: JoinContractInput,
): JoinContractResult {
  const memberPath = roomMemberPath(input.room, input.as);
  const isExisting = vfs.existsSync(memberPath);
  if (!isExisting && (!input.brief || input.brief.trim().length === 0)) {
    throw new ChatError("INVALID_ARGUMENT", `Brief required for new member '${input.as}'`);
  }
  const now = new Date().toISOString();
  vfs.mkdirSync(dirname(memberPath), { recursive: true });
  vfs.writeFileSync(
    memberPath,
    JSON.stringify({
      v: 1,
      id: input.as,
      role: input.role ?? "agent",
      host: input.host ?? "antigravity",
      joined_at: now,
    }),
  );
  let briefRecord: MemberBriefRecord | null = null;
  if (input.brief && input.brief.trim().length > 0) {
    const nextSeq = readVirtualLogEnvelopes(vfs, input.room).length + 1;
    const envelope = makeEnvelope(
      input.room,
      nextSeq,
      BRIEF_SET_SCHEMA,
      { member_id: input.as, text: input.brief, updated_at: now },
      input.as,
    );
    appendToVirtualLog(vfs, input.room, envelope);
    briefRecord = { member_id: input.as, text: input.brief, updated_at: now, seq: nextSeq };
  }
  return { joined: true, grandfathered: isExisting, briefRecord };
}

export function assertCanPerformWork(vfs: ChatVirtualFS, room: string, memberId: string): boolean {
  if (!vfs.existsSync(roomMemberPath(room, memberId))) {
    throw new ChatError("NOT_MEMBER", `Identity '${memberId}' is not a member of room '${room}'`);
  }
  return true;
}
