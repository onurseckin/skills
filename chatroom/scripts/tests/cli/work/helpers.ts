import { dirname, join } from "node:path";
import {
  roomLogIndexPath,
  roomLogSegmentPath,
  type Envelope,
  type LogIndex,
  type UnsignedEnvelope,
} from "../../../src/core/index.ts";
import { signEnvelope } from "../../../src/crypto/index.ts";
import { ChatVirtualFS } from "../../../src/testing/virtual-fs/index.ts";
import { type ExtendedHealthPorts } from "../../../src/work/index.ts";

export const VFS_PREFIX = "/virtual-mine-test";

export function createHealthPorts(vfs: ChatVirtualFS): ExtendedHealthPorts {
  return {
    existsSync: (t: string) => vfs.existsSync(t),
    readFileSync: (t: string, enc: string) => vfs.readFileSync(t, enc) as string,
    writeFileSync: (t: string, c: string) => {
      vfs.mkdirSync(dirname(t), { recursive: true });
      vfs.writeFileSync(t, c);
    },
    writeAtomic: (t: string, c: string) => {
      vfs.mkdirSync(dirname(t), { recursive: true });
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
  text?: string,
): Envelope {
  const unsigned: UnsignedEnvelope = {
    v: 1,
    id: `msg-${seq}-${room}`,
    room,
    seq,
    ts: `2026-09-07T10:00:0${seq}.000Z`,
    sender: { id: "coordinator", role: "coordinator", host: "local" },
    kind: "message",
    thread: undefined,
    reply_to: null,
    mentions: [],
    text,
    body: { schema, data },
    key_fingerprint: "sha256:12345678",
  };
  return signEnvelope(unsigned, "test-secret-key");
}

export function appendToLog(
  vfs: ChatVirtualFS,
  room: string,
  seq: number,
  schema: string,
  data: Readonly<Record<string, unknown>>,
  text?: string,
): void {
  const envelope = makeEnvelope(room, seq, schema, data, text);
  const segPath = roomLogSegmentPath(room, "000001.jsonl");
  vfs.mkdirSync(dirname(segPath), { recursive: true });
  const existing = vfs.existsSync(segPath) ? (vfs.readFileSync(segPath, "utf8") as string) : "";
  vfs.writeFileSync(segPath, `${existing}${JSON.stringify(envelope)}\n`);

  const indexPath = roomLogIndexPath(room);
  const index: LogIndex = {
    next_seq: envelope.seq + 1,
    segments: ["000001.jsonl"],
    head_seq: envelope.seq,
    updated_at: envelope.ts,
  };
  vfs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

export function seedRoom(vfs: ChatVirtualFS, room: string): void {
  const roomPath = join(VFS_PREFIX, "rooms", room);
  vfs.mkdirSync(join(roomPath, "log"), { recursive: true });
  vfs.writeFileSync(
    join(roomPath, "room.json"),
    JSON.stringify({ id: room, title: `Test Room ${room}`, visibility: "private" }),
  );
}
