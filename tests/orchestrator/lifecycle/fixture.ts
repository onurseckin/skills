import type {
  GitRunner,
  GitRunnerResult,
  SyncRunner,
} from "../../../olt/scripts/src/orchestrator/supervision-loop.ts";

export function createMockGitRunner(
  responses: {
    readonly statusOutput?: string;
    readonly commitSha?: string;
    readonly addStatus?: number;
    readonly commitStatus?: number;
    readonly pushStatus?: number;
    readonly addError?: string;
    readonly commitError?: string;
    readonly pushError?: string;
  } = {},
): {
  readonly runner: GitRunner;
  readonly commands: string[][];
} {
  const commands: string[][] = [];
  const runner: GitRunner = (args: readonly string[], _cwd: string): GitRunnerResult => {
    commands.push([...args]);
    const cmd = args[0];
    if (cmd === "add") {
      return {
        status: responses.addStatus ?? 0,
        stdout: "",
        stderr: responses.addError ?? "",
      };
    }
    if (cmd === "status") {
      return {
        status: 0,
        stdout: responses.statusOutput ?? " M src/index.ts\n",
        stderr: "",
      };
    }
    if (cmd === "commit") {
      return {
        status: responses.commitStatus ?? 0,
        stdout: "[main 1234567] feat: commit",
        stderr: responses.commitError ?? "",
      };
    }
    if (cmd === "rev-parse") {
      return {
        status: 0,
        stdout: responses.commitSha ?? "9876543210abcdef",
        stderr: "",
      };
    }
    if (cmd === "push") {
      return {
        status: responses.pushStatus ?? 0,
        stdout: "To github.com:org/repo.git",
        stderr: responses.pushError ?? "",
      };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return { runner, commands };
}

export function createMockSyncRunner(
  responses: {
    readonly status?: number;
    readonly error?: string;
  } = {},
): {
  readonly runner: SyncRunner;
  readonly commands: string[];
} {
  const commands: string[] = [];
  const runner: SyncRunner = (command: string, _cwd: string): GitRunnerResult => {
    commands.push(command);
    return {
      status: responses.status ?? 0,
      stdout: "✓ Global skill sync complete",
      stderr: responses.error ?? "",
    };
  };
  return { runner, commands };
}
