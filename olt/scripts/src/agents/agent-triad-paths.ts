import { join, resolve } from "node:path";
import { findSkillRoot } from "../authority/manifest-parser.ts";
import type { AgentTriadOptions } from "./agent-triad-types.ts";

export function resolveWorkspacePaths(options?: AgentTriadOptions): {
  readonly skillRoot: string;
  readonly agentsDir: string;
  readonly rolesDir: string;
  readonly referencesDir: string;
} {
  const root = options?.skillRoot ? resolve(options.skillRoot) : findSkillRoot();
  const agents = options?.agentsDir ? resolve(options.agentsDir) : join(root, "agents");
  const roles = options?.rolesDir ? resolve(options.rolesDir) : join(root, "roles");
  const references = options?.referencesDir
    ? resolve(options.referencesDir)
    : join(root, "references");

  return {
    skillRoot: root,
    agentsDir: agents,
    rolesDir: roles,
    referencesDir: references,
  };
}
