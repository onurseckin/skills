import * as yaml from "js-yaml";
import { HarnessError } from "../../../core/errors/index.ts";
import { existsSync, readFileSync, lstatSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { ParsedCharter } from "./types.ts";
import { parseCharterFromYaml } from "./parser.ts";
export function parseCharter(content: string): ParsedCharter {
  if (typeof content !== "string" || !content.trim()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "charter content is empty; provide a valid YAML agent manifest for mind",
    );
  }

  const sha256 = createHash("sha256").update(content).digest("hex");

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new HarnessError("INVALID_ARGUMENT", `failed to parse mind YAML manifest: ${message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "mind manifest must be a YAML object defining agent properties or structured charter",
    );
  }

  return parseCharterFromYaml(parsed as Record<string, unknown>, content, sha256);
}

export const parseCharterYaml = parseCharter;

export const DEFAULT_CHARTER_RELATIVE_PATH = "olt/agents/mind.yaml";

export function resolveCharterPath(
  repoRoot: string,
  charterSourceRel?: string,
  charterRepoRoots?: readonly string[],
): string {
  const isDefault = !charterSourceRel || charterSourceRel === DEFAULT_CHARTER_RELATIVE_PATH;
  const candidates: string[] = [];

  if (charterSourceRel && !isDefault) {
    const filename = charterSourceRel.split("/").pop() || charterSourceRel;
    candidates.push(resolve(repoRoot, charterSourceRel));
    candidates.push(resolve(repoRoot, "olt", "agents", filename));
    candidates.push(resolve(repoRoot, "agents", filename));
    if (charterRepoRoots && charterRepoRoots.length > 0) {
      for (const r of charterRepoRoots) {
        candidates.push(resolve(repoRoot, r, charterSourceRel));
        candidates.push(resolve(repoRoot, r, filename));
      }
    }
    candidates.push(resolve(repoRoot, filename));
    candidates.push(resolve(repoRoot, charterSourceRel.replace(/^(\.\.\/)+/, "")));
  } else {
    // Canonical YAML manifest SSoT lookup hierarchy: olt/agents/mind.yaml -> agents/mind.yaml
    candidates.push(resolve(repoRoot, "olt", "agents", "mind.yaml"));
    candidates.push(resolve(repoRoot, "agents", "mind.yaml"));
    if (charterRepoRoots && charterRepoRoots.length > 0) {
      for (const r of charterRepoRoots) {
        candidates.push(resolve(repoRoot, r, "olt", "agents", "mind.yaml"));
        candidates.push(resolve(repoRoot, r, "agents", "mind.yaml"));
      }
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate) && lstatSync(candidate).isFile()) {
      return candidate;
    }
  }
  return resolve(repoRoot, charterSourceRel || DEFAULT_CHARTER_RELATIVE_PATH);
}

export function loadCharter(
  repoRoot: string,
  charterSourceRel?: string,
  charterRepoRoots?: readonly string[],
): ParsedCharter {
  const fullPath = resolveCharterPath(repoRoot, charterSourceRel, charterRepoRoots);
  if (!existsSync(fullPath) || !lstatSync(fullPath).isFile()) {
    throw new HarnessError("INVALID_ARGUMENT", `mind manifest at '${fullPath}' does not exist`);
  }
  const text = readFileSync(fullPath, "utf-8");
  return parseCharter(text);
}
