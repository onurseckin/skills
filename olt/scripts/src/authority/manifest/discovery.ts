import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ROLE_ALIASES } from "./constants.ts";

export function normalizeRoleName(roleInput: string): string {
  const trimmed = roleInput.trim().toLowerCase();
  if (ROLE_ALIASES[trimmed]) {
    return ROLE_ALIASES[trimmed];
  }
  return trimmed;
}

export function findSkillRoot(startDir?: string): string {
  const candidates: string[] = [];

  if (startDir) {
    candidates.push(resolve(startDir));
  }

  // Current working directory
  candidates.push(process.cwd());

  // import.meta.dir relative
  const moduleDir = import.meta.dir;
  if (moduleDir) {
    candidates.push(resolve(moduleDir, "../../../.."));
    candidates.push(resolve(moduleDir, "../../../../../olt"));
    candidates.push(resolve(moduleDir, "../../.."));
    candidates.push(resolve(moduleDir, "../../../olt"));
  }

  // User home directory fallback
  const home = process.env.HOME;
  if (home) {
    candidates.push(resolve(home, ".agents/skills/olt"));
    candidates.push(resolve(home, "repos/skills/olt"));
    candidates.push(resolve(home, "repos/skills"));
  }

  for (const candidate of candidates) {
    let cur = candidate;
    for (let depth = 0; depth < 5; depth++) {
      if (existsSync(join(cur, "agents"))) {
        return cur;
      }
      const sub = join(cur, "olt");
      if (existsSync(join(sub, "agents"))) {
        return sub;
      }
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }

  if (moduleDir) {
    return resolve(moduleDir, "../../../..");
  }
  return process.cwd();
}
