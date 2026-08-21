import type { ErrorCode } from "../../errors/codes.ts";

export interface ExplainExample {
  readonly file: string;
  readonly message: string;
}

export interface ExplainCause {
  readonly id: string;
  readonly label: string;
  readonly trigger: string;
  readonly remedy: string;
  readonly examples: readonly ExplainExample[];
}

export interface ExplainEntry {
  readonly code: ErrorCode;
  readonly summary: string;
  readonly rule: string;
  readonly causes: readonly ExplainCause[];
}

export function example(file: string, message: string): ExplainExample {
  return { file, message };
}

export function cause(
  id: string,
  label: string,
  trigger: string,
  remedy: string,
  examples: readonly ExplainExample[],
): ExplainCause {
  return { id, label, trigger, remedy, examples };
}
