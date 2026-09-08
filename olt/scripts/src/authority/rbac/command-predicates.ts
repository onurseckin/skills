import { isCoordinatorRole } from "../thread/index.ts";

export const KNOWN_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "csh", "tcsh"]);
export const KNOWN_INTERPRETERS = new Set([
  "node",
  "bun",
  "python",
  "python3",
  "deno",
  "ruby",
  "perl",
]);
const GIT_FLAGS_WITH_PARAM = new Set([
  "-c",
  "-C",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--super-prefix",
  "--exec-path",
  "--config-env",
]);

export function isTestFileArgument(arg: string): boolean {
  if (arg.startsWith("-")) return false;
  const clean = (arg.split(":")[0] ?? arg).trim();
  if (clean.length === 0) return false;
  if (
    clean === "tests" ||
    clean === "tests/" ||
    clean === "." ||
    clean === "./" ||
    clean === "src" ||
    clean === "src/"
  ) {
    return false;
  }
  return (
    clean.includes(".test.") ||
    clean.includes(".spec.") ||
    /(\.(test|spec)\.[cm]?[jt]sx?|([/_]test|^test)[^/]*\.py|_test\.py|_spec\.rb)$/iu.test(clean)
  );
}

export function extractGitSubcommand(
  cmd: readonly string[],
): { sub: string; args: readonly string[] } | null {
  if (cmd.length === 0) return null;
  const first = (cmd[0] ?? "").toLowerCase();
  const base = first.split(/[\\/]/).pop() ?? "";
  if (base !== "git") return null;

  let i = 1;
  while (i < cmd.length) {
    const arg = cmd[i] ?? "";
    if (!arg.startsWith("-")) {
      return { sub: arg.toLowerCase(), args: cmd.slice(i + 1) };
    }
    if (GIT_FLAGS_WITH_PARAM.has(arg)) {
      i += 2;
    } else {
      i += 1;
    }
  }
  return null;
}

export function isWholeSuiteTestRun(cmd: readonly string[]): boolean {
  if (cmd.length === 0) return false;
  const first = (cmd[0] ?? "").toLowerCase().split(/[\\/]/).pop() ?? "";
  const second = (cmd[1] ?? "").toLowerCase();
  const third = (cmd[2] ?? "").toLowerCase();

  if (first === "vitest" || first === "jest" || first === "pytest") {
    return !cmd.slice(1).some((arg) => isTestFileArgument(arg));
  }
  if (first === "npx" && (second === "vitest" || second === "jest" || second === "pytest")) {
    return !cmd.slice(2).some((arg) => isTestFileArgument(arg));
  }
  if ((first === "python" || first === "python3") && second === "-m" && third === "pytest") {
    return !cmd.slice(3).some((arg) => isTestFileArgument(arg));
  }
  if (["npm", "pnpm", "yarn"].includes(first)) {
    if (
      second === "test" ||
      second === "t" ||
      second === "test:all" ||
      second.startsWith("test:")
    ) {
      return !cmd.slice(2).some((arg) => isTestFileArgument(arg));
    }
    if (
      second === "run" &&
      (third === "test" || third === "t" || third === "test:all" || third.startsWith("test:"))
    ) {
      return !cmd.slice(3).some((arg) => isTestFileArgument(arg));
    }
  }
  if (first === "bun") {
    if (second === "test" || second === "test:all" || second.startsWith("test:")) {
      return !cmd.slice(2).some((arg) => isTestFileArgument(arg));
    }
    if (
      second === "run" &&
      (third === "test" || third === "t" || third === "test:all" || third.startsWith("test:"))
    ) {
      return !cmd.slice(3).some((arg) => isTestFileArgument(arg));
    }
  }
  if (first === "bun-test") {
    return !cmd.slice(1).some((arg) => isTestFileArgument(arg));
  }
  if (first === "cargo") {
    if (second === "test" || second === "t" || second.startsWith("test:")) {
      return !cmd.slice(2).some((arg) => isTestFileArgument(arg));
    }
    if (second === "run" && (third === "test" || third === "t" || third.startsWith("test:"))) {
      return !cmd.slice(3).some((arg) => isTestFileArgument(arg));
    }
  }
  return false;
}

export function isUnauthorizedGitMutation(cmd: readonly string[]): boolean {
  const gitInfo = extractGitSubcommand(cmd);
  if (!gitInfo) return false;
  const { sub, args } = gitInfo;

  if (["checkout", "reset", "restore", "rebase", "merge", "cherry-pick", "revert"].includes(sub)) {
    return true;
  }
  if (sub === "push") {
    return args.some(
      (a) =>
        a === "--force" ||
        a === "-f" ||
        a === "--force-with-lease" ||
        (a.startsWith("+") && a.length > 1),
    );
  }
  if (sub === "clean") {
    const forbidden = new Set(["-f", "-fd", "-fx", "-fxd", "-df", "-xdf", "--force"]);
    return args.some((a) => forbidden.has(a) || (a.startsWith("-") && a.includes("f")));
  }
  if (sub === "branch") {
    return args.some((a) => a === "-D" || a === "-d" || a === "--delete");
  }
  return false;
}

export const FILE_MUTATION_COMMANDS = new Set([
  "rm",
  "touch",
  "mv",
  "cp",
  "mkdir",
  "tee",
  "truncate",
  "patch",
  "chmod",
  "chown",
  "write_to_file",
  "replace_file_content",
  "edit_file",
  "apply_diff",
  "create_file",
  "delete_file",
  "file_writer",
  "code_editor",
  "write",
  "edit",
  "notebookedit",
  "notebook_edit",
  "apply_patch",
]);

export function isFileMutationCommand(cmd: readonly string[]): boolean {
  if (cmd.length === 0) return false;
  const first = (cmd[0] ?? "").toLowerCase();
  const base = first.split(/[\\/]/).pop() ?? "";
  if (FILE_MUTATION_COMMANDS.has(base)) return true;
  if (
    base === "sed" &&
    cmd.slice(1).some((arg) => arg === "-i" || arg.startsWith("-i") || arg.startsWith("--in-place"))
  ) {
    return true;
  }
  return false;
}

export function canBypassBroadTestLock(cmd: readonly string[]): boolean {
  if (cmd.length === 0 || isWholeSuiteTestRun(cmd)) return false;

  const first = (cmd[0] ?? "").toLowerCase().split(/[\\/]/).pop() ?? "";
  const second = (cmd[1] ?? "").toLowerCase();
  const third = (cmd[2] ?? "").toLowerCase();

  if (first === "vitest" || first === "jest" || first === "pytest") return true;
  if (first === "npx" && (second === "vitest" || second === "jest" || second === "pytest")) {
    return true;
  }
  if ((first === "python" || first === "python3") && second === "-m" && third === "pytest") {
    return true;
  }
  if (["npm", "pnpm", "yarn", "cargo"].includes(first)) {
    if (
      second === "test" ||
      second === "t" ||
      second === "test:all" ||
      second.startsWith("test:") ||
      (second === "run" && (third === "test" || third === "t" || third.startsWith("test:")))
    ) {
      return true;
    }
  }
  if (
    first === "bun" &&
    (second === "test" ||
      second === "test:all" ||
      second.startsWith("test:") ||
      (second === "run" && (third === "test" || third === "t" || third.startsWith("test:"))))
  ) {
    return true;
  }
  if (first === "bun-test") return true;
  return cmd.some((arg) => isTestFileArgument(arg));
}

export function isAnyTestRun(cmd: readonly string[]): boolean {
  return isWholeSuiteTestRun(cmd) || canBypassBroadTestLock(cmd);
}

export const SUPERVISOR_OR_VALIDATOR_ROLES = new Set([
  "mind",
  "mind-supervisor",
  "mind-auditor",
  "skill-auditor",
  "meta-auditor",
  "orchestrator",
  "coordinator",
  "autonomic-watchdog",
  "watchdog",
  "planner",
  "independent-planner",
  "validator",
  "critic",
  "cognitive-validator",
  "completeness-critic",
  "socratic-validator",
  "plan-validator",
  "sub-validator",
  "sub-investigator",
]);

export function isSupervisorOrValidatorRole(role: string): boolean {
  const norm = role.trim().toLowerCase().replace(/_/gu, "-");
  return (
    SUPERVISOR_OR_VALIDATOR_ROLES.has(norm) || norm.includes("validator") || norm.includes("critic")
  );
}

export function inferActorRole(actorId: string): string {
  const norm = actorId.toLowerCase();
  for (const prefix of [
    "validator",
    "critic",
    "implementer",
    "worker",
    "coordinator",
    "orchestrator",
    "mind",
  ]) {
    if (
      norm.startsWith(prefix) ||
      norm.includes(`-${prefix}-`) ||
      norm.includes(`_${prefix}_`) ||
      norm.endsWith(prefix)
    ) {
      return prefix;
    }
  }
  return "implementer";
}

export { isCoordinatorRole };

export function inspectShellEval(
  actorRole: string,
  cmd: readonly string[],
  verifyFn: (
    role: string,
    c: readonly string[],
  ) => { authorized: boolean; reason?: string | undefined },
): { authorized: boolean; reason?: string | undefined } | null {
  const first = (cmd[0] ?? "").toLowerCase().split(/[\\/]/).pop() ?? "";
  const isShell = KNOWN_SHELLS.has(first);
  const isInterp = KNOWN_INTERPRETERS.has(first);
  if (!isShell && !isInterp) return null;

  for (let i = 1; i < cmd.length; i++) {
    const arg = cmd[i] ?? "";
    const isEvalFlag = isShell
      ? arg === "-c" || arg.startsWith("-c=")
      : arg === "-e" || arg === "--eval" || arg === "-c" || arg.startsWith("-e=");
    if (!isEvalFlag) continue;

    const evalStr = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : (cmd[i + 1] ?? "");
    if (!evalStr.trim()) continue;

    if (isShell) {
      const statements = evalStr
        .split(/[;&|\n]+/u)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const st of statements) {
        const tokens = st.split(/\s+/u).filter(Boolean);
        if (tokens.length > 0) {
          const subAuth = verifyFn(actorRole, tokens);
          if (!subAuth.authorized) return subAuth;
        }
      }
    } else if (isInterp) {
      const isSuper = isSupervisorOrValidatorRole(actorRole);
      if (isWholeSuiteTestRun(evalStr.split(/\s+/u))) {
        return { authorized: false, reason: "WHOLE_SUITE_TEST_RUN_DENIED" };
      }
      if (isSuper) {
        if (
          /(?:write_to_file|replace_file|writeFileSync|writeFile|unlinkSync|rmdir|mkdirSync|os\.remove|shutil\.rmtree)/u.test(
            evalStr,
          )
        ) {
          const reason = isCoordinatorRole(actorRole)
            ? "ROLE_BOUNDARY_DEVIATION"
            : "SUPERVISOR_ZERO_CODE_EDITS";
          return { authorized: false, reason };
        }
        if (/(?:vitest|jest|bun\s+test|pytest)/u.test(evalStr)) {
          return { authorized: false, reason: "SUPERVISOR_ZERO_TEST_RUNS" };
        }
      }
    }
  }
  return null;
}

export const isBroadTestRun = isWholeSuiteTestRun;
export const requiresBroadTestLock = isWholeSuiteTestRun;
export const isTargetedTestRun = canBypassBroadTestLock;

export function isPermittedCliTool(cmd: readonly string[] | string): boolean {
  const tokens = typeof cmd === "string" ? cmd.trim().split(/\s+/u).filter(Boolean) : cmd;
  if (tokens.length === 0) return false;
  return (
    !isFileMutationCommand(tokens) && !isUnauthorizedGitMutation(tokens) && !isAnyTestRun(tokens)
  );
}

export const isWholeSuiteTestCommand = isWholeSuiteTestRun;
export const isShieldedMutationCommand = isFileMutationCommand;
export const inferRoleFromActorId = inferActorRole;
