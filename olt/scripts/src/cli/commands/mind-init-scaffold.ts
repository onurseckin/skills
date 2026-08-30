import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initRepoPolicy } from "../../policy/index.ts";

export function bootstrapRootGovernanceScaffolding(repoRoot: string): void {
  const rootOltDir = join(repoRoot, ".olt");
  if (!existsSync(rootOltDir)) {
    mkdirSync(rootOltDir, { recursive: true });
  }

  const rootPolicyPath = join(rootOltDir, "policy.json");
  const fallbackPolicyPath = join(repoRoot, "olt", "policy.json");
  if (!existsSync(rootPolicyPath) && !existsSync(fallbackPolicyPath)) {
    try {
      initRepoPolicy(repoRoot);
    } catch {}
  }

  const rootBacklogPath = join(rootOltDir, "backlog.jsonl");
  if (!existsSync(rootBacklogPath)) {
    try {
      writeFileSync(rootBacklogPath, "", "utf-8");
    } catch {}
  }

  const rootDefectsPath = join(rootOltDir, "defects.jsonl");
  if (!existsSync(rootDefectsPath)) {
    try {
      writeFileSync(rootDefectsPath, "", "utf-8");
    } catch {}
  }

  const rootSessionsDir = join(rootOltDir, "sessions");
  if (!existsSync(rootSessionsDir)) {
    try {
      mkdirSync(rootSessionsDir, { recursive: true });
    } catch {}
  }

  const rootMailboxesDir = join(rootOltDir, "mailboxes");
  if (!existsSync(rootMailboxesDir)) {
    try {
      mkdirSync(rootMailboxesDir, { recursive: true });
    } catch {}
  }
}
