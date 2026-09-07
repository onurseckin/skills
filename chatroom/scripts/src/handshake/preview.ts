import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { HandshakeError, type ConfirmationPreview, type HandshakeOptions } from "./types.ts";

function resolveChatroomDir(options?: HandshakeOptions): string {
  return (
    options?.chatroomDir ??
    process.env.CHATROOM_HOME ??
    path.join(os.homedir(), ".agents", "chatroom")
  );
}

function extractLastLine(logDir: string, seg?: string): string | null {
  if (!seg) return null;
  const lines = fs.readFileSync(path.join(logDir, seg), "utf8").trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]?.trim();
    if (l) {
      try {
        const p: unknown = JSON.parse(l);
        if (typeof p === "object" && p !== null && "text" in p) {
          const textVal = (p as { text?: unknown }).text;
          if (typeof textVal === "string") {
            return textVal.split("\n")[0] ?? textVal;
          }
        }
        return l;
      } catch {
        return l;
      }
    }
  }
  return null;
}

export function getConfirmationPreview(
  roomId: string,
  options?: HandshakeOptions,
): ConfirmationPreview {
  const chatroomDir = resolveChatroomDir(options);
  const roomDir = path.join(chatroomDir, "rooms", roomId);
  const roomJsonPath = path.join(roomDir, "room.json");

  if (!fs.existsSync(roomDir) || !fs.existsSync(roomJsonPath)) {
    throw new HandshakeError("UNKNOWN_ROOM", `Room '${roomId}' does not exist locally`);
  }

  const manifest: unknown = JSON.parse(fs.readFileSync(roomJsonPath, "utf8"));
  const titleCandidate =
    typeof manifest === "object" && manifest !== null && "title" in manifest
      ? (manifest as { title?: unknown }).title
      : undefined;
  const roomTitle = typeof titleCandidate === "string" ? titleCandidate : roomId;
  const membersDir = path.join(roomDir, "members");
  const memberList = !fs.existsSync(membersDir)
    ? []
    : fs
        .readdirSync(membersDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5))
        .sort();

  let messageCount = 0;
  const indexPath = path.join(roomDir, "log.index.json");
  if (fs.existsSync(indexPath)) {
    try {
      const idx: unknown = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      if (typeof idx === "object" && idx !== null) {
        const headSeq = (idx as { head_seq?: unknown }).head_seq;
        const nextSeq = (idx as { next_seq?: unknown }).next_seq;
        if (typeof headSeq === "number") {
          messageCount = headSeq;
        } else if (typeof nextSeq === "number") {
          messageCount = Math.max(0, nextSeq - 1);
        }
      }
    } catch {}
  }

  const logDir = path.join(roomDir, "log");
  let lastMessagePreview: string | null = null;
  if (fs.existsSync(logDir)) {
    try {
      const segments = fs
        .readdirSync(logDir)
        .filter((f) => f.endsWith(".jsonl"))
        .sort();
      if (messageCount === 0) {
        for (const seg of segments) {
          messageCount += fs
            .readFileSync(path.join(logDir, seg), "utf8")
            .trim()
            .split("\n")
            .filter((l) => l.trim().length > 0).length;
        }
      }
      lastMessagePreview = extractLastLine(logDir, segments[segments.length - 1]);
    } catch {}
  }

  return { roomId, roomTitle, memberList, messageCount, lastMessagePreview };
}

export function formatConfirmationPreview(preview: ConfirmationPreview): string {
  const members = preview.memberList.length > 0 ? preview.memberList.join(", ") : "(none)";
  const previewLine = preview.lastMessagePreview ?? "(no messages yet)";
  return `Room: ${preview.roomTitle} (${preview.roomId})\nMembers (${preview.memberList.length}): ${members}\nMessages: ${preview.messageCount}\nLast message: ${previewLine}`;
}
