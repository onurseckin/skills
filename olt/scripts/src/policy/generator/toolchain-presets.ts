import type { ToolchainAnalysis } from "./toolchain-types.ts";

export function getCargoPresets(): ToolchainAnalysis {
  return {
    ecosystem: "cargo",
    packageManager: "cargo",
    testRunner: {
      default_command: "cargo test",
      targeted_pattern: "cargo test <path>",
      full_suite_command: "cargo test",
      timeout_ms: 60000,
    },
    typecheckCommand: "cargo check",
    lintCommand: "cargo clippy",
    buildCommand: "cargo build",
    allowedCommands: [
      "cargo test",
      "cargo check",
      "cargo clippy",
      "cargo build",
      "git status",
      "git diff",
      "ls",
      "grep",
      "cat",
    ],
    forbiddenCommands: ["git commit", "git push", "rm -rf /"],
    isMonorepo: false,
  };
}

export function getPythonPresets(): ToolchainAnalysis {
  return {
    ecosystem: "python",
    packageManager: "pip",
    testRunner: {
      default_command: "pytest",
      targeted_pattern: "pytest <path>",
      full_suite_command: "pytest",
      timeout_ms: 30000,
    },
    typecheckCommand: "mypy .",
    lintCommand: "ruff check .",
    allowedCommands: [
      "pytest",
      "mypy",
      "ruff",
      "python",
      "python3",
      "git status",
      "git diff",
      "ls",
      "grep",
      "cat",
    ],
    forbiddenCommands: ["git commit", "git push", "rm -rf /"],
    isMonorepo: false,
  };
}

export function getUnknownPresets(): ToolchainAnalysis {
  return {
    ecosystem: "unknown",
    packageManager: undefined,
    testRunner: {
      default_command: "npm test",
      targeted_pattern: "npm test -- <path>",
      full_suite_command: "npm test",
      timeout_ms: 30000,
    },
    typecheckCommand: undefined,
    lintCommand: undefined,
    allowedCommands: ["git status", "git diff", "ls", "grep", "cat"],
    forbiddenCommands: ["git commit", "git push", "rm -rf /"],
    isMonorepo: false,
  };
}
