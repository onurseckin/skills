export const CHATROOM_PUBLIC_KEY = "chatroom:public:v1";

export type HandshakeErrorCode =
  | "WRONG_ROOM"
  | "HANDSHAKE_CONSUMED"
  | "UNKNOWN_ROOM"
  | "INVITE_EXPIRED"
  | "INVALID_URI"
  | "ROOM_NOT_INITIALIZED"
  | "LOCK_FAILED";

export class HandshakeError extends Error {
  readonly code: HandshakeErrorCode;
  readonly details?: Record<string, unknown> | undefined;

  constructor(code: HandshakeErrorCode, message: string, details?: Record<string, unknown>) {
    super(`${code}: ${message}`);
    this.name = "HandshakeError";
    this.code = code;
    this.details = details;
  }
}

export interface InviteRecord {
  readonly code: string;
  readonly created_at: string;
  readonly created_by: string;
  readonly expires_at: string;
  readonly uses_remaining: number;
  readonly wrapped_key: string;
}

export interface ConsumedInviteRecord extends InviteRecord {
  readonly consumed_at: string;
  readonly consumed_by: string;
}

export interface ConsumeInviteResult {
  readonly roomId: string;
  readonly key: Uint8Array;
  readonly keyHex: string;
  readonly keyFingerprint: string;
  readonly joiner: string;
  readonly invite: ConsumedInviteRecord;
}

export interface ConfirmationPreview {
  readonly roomId: string;
  readonly roomTitle: string;
  readonly memberList: readonly string[];
  readonly messageCount: number;
  readonly lastMessagePreview: string | null;
}

export interface HandshakeOptions {
  readonly chatroomDir?: string;
  readonly roomKey?: Uint8Array | string;
}
