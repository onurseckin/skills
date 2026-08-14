import type { TransactionPort } from "../types.ts";
import { completionIssues } from "./completion-state.ts";

export function checkCompletion(port: Pick<TransactionPort, "read">): string[] {
  return completionIssues(port.read());
}
