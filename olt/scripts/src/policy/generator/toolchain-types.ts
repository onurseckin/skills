import type { PackageManager, RepoEcosystem, TestRunnerPolicy } from "../types/index.ts";

export interface ToolchainAnalysis {
  readonly ecosystem: RepoEcosystem;
  readonly packageManager?: PackageManager | undefined;
  readonly testRunner: TestRunnerPolicy;
  readonly typecheckCommand?: string | undefined;
  readonly lintCommand?: string | undefined;
  readonly buildCommand?: string | undefined;
  readonly allowedCommands: readonly string[];
  readonly forbiddenCommands: readonly string[];
  readonly isMonorepo: boolean;
  readonly monorepoTool?: "turbo" | "nx" | "pnpm-workspaces" | "npm-workspaces" | undefined;
}
