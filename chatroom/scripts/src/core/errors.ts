export const ERROR_CODES = [
  "CAPACITY_EXCEEDED",
  "CORRUPT_LAYOUT",
  "CURSOR_CONFLICT",
  "CURSOR_CORRUPT",
  "DAEMON_SPAWN_FAILED",
  "FILTER_REQUIRES_PEEK",
  "HANDSHAKE_CONSUMED",
  "IDENTITY_UNRESOLVED",
  "INTEGRITY",
  "INVALID_ARGUMENT",
  "INVALID_IDENTITY",
  "INVALID_PAYLOAD",
  "INVALID_ROOM_ID",
  "INVALID_STATE",
  "JOIN_FAILED",
  "LOCK_TIMEOUT",
  "NOT_FOUND",
  "NOT_IMPLEMENTED",
  "NOT_MEMBER",
  "PERMISSION_DENIED",
  "PROVISION_DRIFT",
  "ROOM_ALREADY_EXISTS",
  "RUNTIME_UNRESOLVED",
  "SEGMENT_CORRUPT",
  "SIGNATURE_INVALID",
  "UNKNOWN_HOST",
  "UNKNOWN_MENTION",
  "UNKNOWN_ROOM",
  "WRONG_ROOM",
] as const;

export const CHAT_ERROR_CODES = ERROR_CODES;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class ChatError extends Error {
  public readonly code: ErrorCode;
  public readonly exitCode: number;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(
    code: ErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    exitCode?: number,
  ) {
    super(message);
    this.name = "ChatError";
    this.code = code;
    this.details = details;
    this.exitCode =
      exitCode !== undefined
        ? exitCode
        : code === "LOCK_TIMEOUT"
          ? 4
          : code === "NOT_IMPLEMENTED"
            ? 70
            : 1;
    Object.setPrototypeOf(this, ChatError.prototype);
  }
}

export function isChatError(value: unknown): value is ChatError {
  return value instanceof ChatError;
}
