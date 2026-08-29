import { basename, extname } from "node:path";
import type { RoleContract, RoleContractFrontmatter } from "./types.ts";
import { normalizeRoleName } from "./discovery.ts";
import { parseYaml } from "./yaml-parser.ts";
import { parseAgentManifest } from "./agent-manifest-parser.ts";

export function parseMarkdownFrontmatter<T = Record<string, unknown>>(
  markdownText: string,
): { frontmatter: T; body: string } {
  const normalized = markdownText.replace(/\r\n/g, "\n");
  const trimmed = normalized.trimStart();

  if (!trimmed.startsWith("---")) {
    return {
      frontmatter: {} as T,
      body: normalized,
    };
  }

  const lines = normalized.split("\n");
  let firstDelimiter = -1;
  let secondDelimiter = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "---") {
      if (firstDelimiter === -1) {
        firstDelimiter = i;
      } else {
        secondDelimiter = i;
        break;
      }
    }
  }

  if (firstDelimiter === -1 || secondDelimiter === -1 || secondDelimiter <= firstDelimiter) {
    return {
      frontmatter: {} as T,
      body: normalized,
    };
  }

  const frontmatterYaml = lines.slice(firstDelimiter + 1, secondDelimiter).join("\n");
  const body = lines.slice(secondDelimiter + 1).join("\n");

  const parsed = parseYaml(frontmatterYaml);
  const frontmatter = (typeof parsed === "object" && parsed !== null ? parsed : {}) as T;

  return {
    frontmatter,
    body: body.trim(),
  };
}

export function parseRoleContract(content: string, filePath?: string): RoleContract {
  if (!content.trimStart().startsWith("---")) {
    const manifest = parseAgentManifest(content, filePath);
    const may = manifest.permissions?.may ?? [];
    const mustNot = manifest.permissions?.must_not ?? [];
    const commands = manifest.permissions?.commands ?? [];
    const spawns = (manifest.permissions?.spawns ?? []) as string[];
    return {
      role: manifest.role || (filePath ? basename(filePath, extname(filePath)) : "unknown"),
      tier: manifest.tier ?? 3,
      domain: typeof manifest.domain === "string" ? manifest.domain : undefined,
      may,
      mustNot,
      commands,
      spawns,
      frontmatter: {
        role: manifest.role,
        tier: manifest.tier,
        may,
        must_not: mustNot,
        commands,
        spawns,
      },
      body: manifest.instructions || "",
      filePath,
      raw: content,
    };
  }

  const { frontmatter, body } = parseMarkdownFrontmatter<RoleContractFrontmatter>(content);

  const role =
    typeof frontmatter.role === "string"
      ? normalizeRoleName(frontmatter.role)
      : filePath
        ? basename(filePath, extname(filePath))
        : "unknown";
  const tier = typeof frontmatter.tier === "number" ? frontmatter.tier : 3;
  const domain = typeof frontmatter.domain === "string" ? frontmatter.domain : undefined;

  const rawMay = Array.isArray(frontmatter.may)
    ? frontmatter.may
    : Array.isArray(frontmatter.permissions?.may)
      ? frontmatter.permissions.may
      : [];
  const may: readonly string[] = (rawMay as readonly unknown[])
    .map((item) => String(item).trim())
    .filter(Boolean);

  const rawMustNot = Array.isArray(frontmatter.must_not)
    ? frontmatter.must_not
    : Array.isArray(frontmatter.permissions?.must_not)
      ? frontmatter.permissions.must_not
      : [];
  const mustNot: readonly string[] = (rawMustNot as readonly unknown[])
    .map((item) => String(item).trim())
    .filter(Boolean);

  const rawCommands = Array.isArray(frontmatter.commands)
    ? frontmatter.commands
    : Array.isArray(frontmatter.permissions?.commands)
      ? frontmatter.permissions.commands
      : [];
  const commands: readonly string[] = (rawCommands as readonly unknown[])
    .map((item) => String(item).trim())
    .filter(Boolean);

  const rawSpawns = Array.isArray(frontmatter.spawns)
    ? frontmatter.spawns
    : Array.isArray(frontmatter.permissions?.spawns)
      ? frontmatter.permissions.spawns
      : [];
  const spawns: readonly string[] = (rawSpawns as readonly unknown[])
    .map((item) => String(item).trim())
    .filter(Boolean);

  return {
    role,
    tier,
    domain,
    may,
    mustNot,
    commands,
    spawns,
    frontmatter,
    body,
    filePath,
    raw: content,
  };
}
