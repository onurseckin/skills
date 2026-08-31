import { isJsonObject, type JsonObject } from "../../core/contracts/index.ts";
import { HarnessError } from "../../core/errors/index.ts";

export function readOwnDataString(error: unknown, key: "code" | "message"): string | null {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

export function formatSafeErrorCause(error: unknown): string {
  const message = readOwnDataString(error, "message");
  if (message !== null) return message;
  if (error === null || (typeof error !== "object" && typeof error !== "function")) {
    try {
      return String(error);
    } catch {
      return "unknown error";
    }
  }
  return "unknown error";
}

export function readPersistedSession(
  path: string,
  mechanism: string,
  readSessionFile: (path: string, encoding: "utf8") => string,
): JsonObject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readSessionFile(path, "utf8"));
  } catch (error: unknown) {
    if (readOwnDataString(error, "code") === "ENOENT") return null;
    throw new HarnessError(
      "INTEGRITY",
      `failed to read persisted ${mechanism} session evidence at ${path}: ${formatSafeErrorCause(error)}`,
    );
  }
  const invalid = (cause: string): never => {
    throw new HarnessError(
      "INTEGRITY",
      `invalid persisted ${mechanism} session evidence at ${path}: ${cause}`,
    );
  };
  const session: JsonObject = isJsonObject(parsed) ? parsed : invalid("expected a JSON object");
  if (typeof session.agent_id !== "string" || !session.agent_id.trim())
    invalid("agent_id must be a nonempty string");
  for (const f of ["role", "token"] as const) {
    if (f in session && (typeof session[f] !== "string" || !session[f].trim())) {
      invalid(`${f} must be a nonempty string when present`);
    }
  }
  for (const f of ["can_execute_shell", "can_edit_files"] as const) {
    if (f in session && typeof session[f] !== "boolean")
      invalid(`${f} must be a boolean when present`);
  }
  if (
    "write_scope" in session &&
    (!Array.isArray(session.write_scope) || session.write_scope.some((e) => typeof e !== "string"))
  ) {
    invalid("write_scope must be an array of strings when present");
  }
  for (const f of ["task_id", "granted_at"] as const) {
    if (f in session && typeof session[f] !== "string")
      invalid(`${f} must be a string when present`);
  }
  return session;
}

export function inferCanExecute(role: string): {
  can_execute_shell: boolean;
  can_edit_files: boolean;
} {
  const norm = role.trim().toLowerCase();
  const editable = [
    "implementer",
    "worker",
    "repairer",
    "owner",
    "sub-implementer",
    "sub_implementer",
    "sub-task-worker",
    "sub_task_worker",
  ];
  const isEditable =
    editable.includes(norm) || norm.startsWith("implementer-") || norm.startsWith("implementer_");
  return { can_execute_shell: true, can_edit_files: isEditable };
}
