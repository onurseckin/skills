import { HarnessError } from "../../../core/errors/index.ts";
import { createHash } from "node:crypto";
import type {
  DynamicRoleSpec,
  DynamicRoleContract,
  RoleArchetype,
  WriteScopePolicy,
} from "./types.ts";

export function parseDynamicRoleContract(
  content: string | Uint8Array,
  source = "dynamic-role.md",
): DynamicRoleContract {
  const text = typeof content === "string" ? content : new TextDecoder("utf-8").decode(content);
  const lines = text.split("\n");

  if (lines[0]?.trim() !== "---") {
    throw new HarnessError(
      "INTEGRITY",
      `Role contract in ${source} does not start with frontmatter fence (---).`,
    );
  }

  const endFenceIndex = lines.indexOf("---", 1);
  if (endFenceIndex === -1) {
    throw new HarnessError(
      "INTEGRITY",
      `Role contract in ${source} contains unterminated frontmatter fence.`,
    );
  }

  const frontmatterLines = lines.slice(1, endFenceIndex);
  const rawBody = lines
    .slice(endFenceIndex + 1)
    .join("\n")
    .trim();

  let roleName: string | undefined;
  let tier: number | undefined;
  let domain: string | undefined;
  const may: string[] = [];
  const must_not: string[] = [];
  const commands: string[] = [];
  const spawns: string[] = [];

  let currentList: "may" | "must_not" | "commands" | "spawns" | null = null;

  for (const line of frontmatterLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("- ")) {
      const item = trimmed.slice(2).trim();
      if (item === "[]") continue;
      if (currentList === "may") may.push(item);
      else if (currentList === "must_not") must_not.push(item);
      else if (currentList === "commands") commands.push(item);
      else if (currentList === "spawns") spawns.push(item);
      continue;
    }

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();

    if (key === "role") {
      roleName = value;
      currentList = null;
    } else if (key === "tier") {
      const parsedTier = Number(value);
      if (!Number.isSafeInteger(parsedTier) || parsedTier < 0 || parsedTier > 3) {
        throw new HarnessError(
          "INVALID_ARGUMENT",
          `Invalid tier '${value}' in ${source}. Must be integer 0..3.`,
        );
      }
      tier = parsedTier;
      currentList = null;
    } else if (key === "domain") {
      domain = value;
      currentList = null;
    } else if (key === "may") {
      currentList = "may";
    } else if (key === "must_not") {
      currentList = "must_not";
    } else if (key === "commands") {
      currentList = "commands";
    } else if (key === "spawns") {
      currentList = "spawns";
    } else {
      currentList = null;
    }
  }

  if (!roleName) {
    throw new HarnessError("INTEGRITY", `Missing 'role' property in frontmatter of ${source}.`);
  }
  if (tier === undefined) {
    throw new HarnessError("INTEGRITY", `Missing 'tier' property in frontmatter of ${source}.`);
  }

  // Extract cognitive pillars and prose details from body
  const bodyLines = rawBody.split("\n");
  let title = roleName;
  const cognitivePillars: string[] = [];
  const leadParagraphs: string[] = [];
  let inPillars = false;

  for (const bLine of bodyLines) {
    const trimmed = bLine.trim();
    if (trimmed.startsWith("# ") && title === roleName) {
      title = trimmed.slice(2).trim();
      continue;
    }
    if (trimmed.startsWith("## Cognitive Pillars")) {
      inPillars = true;
      continue;
    }
    if (inPillars && trimmed.startsWith("## ")) {
      inPillars = false;
    }
    if (inPillars && trimmed.startsWith("- ")) {
      cognitivePillars.push(trimmed.slice(2).trim());
      continue;
    }
    if (
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("-") &&
      trimmed.length > 0 &&
      leadParagraphs.length < 2
    ) {
      leadParagraphs.push(trimmed);
    }
  }

  const summary = leadParagraphs.join(" ") || `Role contract for ${roleName}`;
  const archetype: RoleArchetype =
    tier === 0
      ? "tier_0_mind"
      : tier === 1
        ? "tier_1_orchestrator"
        : tier === 2
          ? "tier_2_coordinator"
          : roleName.includes("validator") || roleName.includes("critic")
            ? "tier_3_validator"
            : roleName.includes("repair")
              ? "tier_3_repairer"
              : "tier_3_implementer";

  const writeScopePolicy: WriteScopePolicy =
    tier === 3 && (roleName.includes("validator") || roleName.includes("critic"))
      ? "forbidden"
      : tier === 3
        ? "lease_bounded"
        : "forbidden";

  const spec: DynamicRoleSpec = {
    name: roleName,
    archetype,
    tier,
    title,
    summary,
    domain,
    grantedCommands: commands,
    permittedActivities: may,
    prohibitedActions: must_not,
    invariants: [],
    spawns,
    cognitivePillars,
    writeScopePolicy,
  };

  const rawFrontmatter = lines.slice(0, endFenceIndex + 1).join("\n");
  const bytes = new TextEncoder().encode(text);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  return {
    role: roleName,
    tier,
    title,
    summary,
    domain,
    may,
    must_not,
    commands,
    spawns,
    cognitivePillars,
    writeScopePolicy,
    spec,
    markdown: text,
    rawFrontmatter,
    rawBody,
    sha256,
  };
}
