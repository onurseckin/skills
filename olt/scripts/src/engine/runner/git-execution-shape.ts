import type { CommandRecord } from "../../core/contracts/index.ts";
import { executionArgv } from "./gate-path-bindings.ts";
import {
  isGitGateCommand,
  isRestrictedGitGate,
  restrictedGateGitArgv,
} from "./restricted-git-gate.ts";

export function gitExecutionArgvIssues(record: CommandRecord): string[] {
  const gitGate = record.gate_id !== null && isGitGateCommand(record.argv);
  const restricted = record.gate_id !== null && isRestrictedGitGate(record.argv);
  if (gitGate && !restricted) return ["Git gate command is not an accepted restricted diff check"];
  if (!restricted)
    return record.execution_argv === undefined
      ? []
      : ["non-Git gate contains a restricted execution argv"];
  try {
    const expected = restrictedGateGitArgv(executionArgv(record.argv, record.path_bindings ?? []));
    return JSON.stringify(record.execution_argv) === JSON.stringify(expected)
      ? []
      : ["Git gate execution argv does not match its restricted policy"];
  } catch {
    return ["Git gate execution argv does not match its restricted policy"];
  }
}
