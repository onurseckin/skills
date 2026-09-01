import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeductiveParameters, RepoPolicy } from "./types.ts";

export function extractFromWorkspace(
  this: any,
  repoRoot = process.cwd(),
  customPolicyPath?: string,
): DeductiveParameters {
  const candidatePaths = [
    customPolicyPath,
    join(repoRoot, "olt", "policy.json"),
    join(repoRoot, ".olt", "policy.json"),
    join(repoRoot, "policy.json"),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);

  for (const path of candidatePaths) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, "utf-8");
        const parsed = JSON.parse(raw) as RepoPolicy;
        return this.extractFromPolicy({
          ...parsed,
          provenance: "explicit_policy",
        });
      } catch {
        // Fallback
      }
    }
  }

  return this.getDefaultParameters();
}
