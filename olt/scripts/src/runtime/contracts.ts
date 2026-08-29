import { type Dirent } from "node:fs";
import type { ReviewProtocolPolicy } from "../policy/repo-policy.ts";

export interface AgentMetadata {
  readonly agent_id: string;
  readonly role: string;
  readonly tier: number;
  readonly write_scope: readonly string[];
  readonly allowed_read_scope: readonly string[];
  readonly can_execute_shell: boolean;
  readonly spawned_at: string;
  readonly run_id?: string | undefined;
  readonly task_id?: string | undefined;
  readonly review_config?: ReviewProtocolPolicy | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface AgentMetadataDependencies {
  readonly findRepoRoot: () => string;
  readonly resolveCapsulesDir: (repoRoot?: string) => string;
  readonly resolveScratchDir: (repoRoot?: string) => string;
  readonly readDirectory: (
    path: string,
    options: { readonly withFileTypes: true },
  ) => readonly Dirent[];
  readonly readFile: (path: string, encoding: "utf-8") => string;
}
