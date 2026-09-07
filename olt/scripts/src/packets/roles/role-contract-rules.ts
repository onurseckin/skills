import { createHash } from "node:crypto";
import {
  isAgentRole,
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
  type AgentRole,
} from "../../core/contracts/index.ts";
import { parseUnifiedAgentManifest } from "../../authority/manifest-schema.ts";
import {
  isValidatorDomain,
  type ValidatorDomain,
  type RoleContract,
  LIST_FIELDS,
  invalid,
} from "./role-contract-types.ts";
import { readFrontmatter, requireList } from "./role-contract-frontmatter.ts";
export { readFrontmatter, requireList } from "./role-contract-frontmatter.ts";

export function parseRoleContract(bytes: Uint8Array, source: string): RoleContract {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid("role contract", source, "document is not valid UTF-8");
  }

  if (!text.trimStart().startsWith("---")) {
    if (source.endsWith(".md"))
      invalid("role contract", source, "missing opening frontmatter fence");
    let manifest: ReturnType<typeof parseUnifiedAgentManifest>;
    try {
      manifest = parseUnifiedAgentManifest(text, source);
    } catch (err) {
      invalid("role contract", source, err instanceof Error ? err.message : String(err));
    }
    const role = (manifest.role ?? manifest.name) as AgentRole;
    if (!isAgentRole(role))
      invalid("role contract", source, `role is not a canonical agent role: ${role}`);
    const commands = (manifest.permissions?.commands ?? []).map((cmd) => {
      if (cmd === "mind:queue:drain" || cmd === "todo:drain") return "queue:drain";
      if (cmd === "mind:queue:seal" || cmd === "todo:seal") return "queue:seal";
      if (cmd === "mind:queue:clean" || cmd === "todo:clean") return "queue:clean";
      if (cmd === "mind:queue:add" || cmd === "todo:add") return "queue:add";
      if (cmd === "mind:queue:list" || cmd === "todo:list") return "queue:status";
      return cmd;
    });
    if (
      isCognitiveValidatorRole(role) &&
      !isMechanicValidatorRole(role) &&
      commands.includes("run:exec")
    ) {
      invalid(
        "role contract",
        source,
        `cognitive validator role ${role} must not declare run:exec in commands (command-running ban)`,
      );
    }
    return {
      role,
      tier: typeof manifest.tier === "number" ? manifest.tier : 3,
      may: manifest.permissions?.may ?? [],
      must_not: manifest.permissions?.must_not ?? [],
      commands,
      spawns: (manifest.permissions?.spawns ?? []) as AgentRole[],
      domain:
        typeof manifest.domain === "string" ? (manifest.domain as ValidatorDomain) : undefined,
      text,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  if (end === -1) invalid("role contract", source, "frontmatter fence is unterminated");
  const frontmatter = readFrontmatter(
    lines.slice(1, end),
    source,
    new Set(LIST_FIELDS),
    "role contract",
  );
  const body = lines
    .slice(end + 1)
    .join("\n")
    .trim();
  if (body === "") invalid("role contract", source, "document has no prose after the frontmatter");
  const unknown = [...frontmatter.scalars.keys()].filter(
    (k) => k !== "role" && k !== "tier" && k !== "domain",
  );
  if (unknown.length > 0) invalid("role contract", source, `unknown key: ${unknown.join(", ")}`);
  const role = frontmatter.scalars.get("role");
  if (role === undefined) invalid("role contract", source, "missing key: role");
  if (!isAgentRole(role))
    invalid("role contract", source, `role is not a canonical agent role: ${role}`);
  const rawTier = frontmatter.scalars.get("tier");
  if (rawTier === undefined) invalid("role contract", source, "missing key: tier");
  let tier = /^\d+$/u.test(rawTier) ? Number(rawTier) : Number.NaN;
  if (rawTier === "independent") {
    tier = 3;
  } else if (!Number.isSafeInteger(tier) || tier < 0 || tier > 3) {
    invalid("role contract", source, `tier must be an integer from 0 to 3: ${rawTier}`);
  }
  const rawDomain = frontmatter.scalars.get("domain");
  let domain: ValidatorDomain | undefined;
  if (rawDomain !== undefined) {
    if (role !== "validator")
      invalid("role contract", source, `domain is only valid for validator roles: ${rawDomain}`);
    if (role === "validator") {
      if (!isValidatorDomain(rawDomain))
        invalid(
          "role contract",
          source,
          `domain is not a recognized validator domain: ${rawDomain}`,
        );
      domain = rawDomain;
    }
  }
  const spawns: AgentRole[] = [];
  for (const spawned of requireList(frontmatter, "spawns", source)) {
    if (!isAgentRole(spawned))
      invalid("role contract", source, `spawns names an unknown role: ${spawned}`);
    if (spawned === role) invalid("role contract", source, "a role may not spawn itself");
    spawns.push(spawned);
  }
  const rawCommands = requireList(frontmatter, "commands", source);
  const commands = rawCommands.map((cmd) => {
    if (cmd === "mind:queue:drain" || cmd === "todo:drain") return "queue:drain";
    if (cmd === "mind:queue:seal" || cmd === "todo:seal") return "queue:seal";
    if (cmd === "mind:queue:clean" || cmd === "todo:clean") return "queue:clean";
    if (cmd === "mind:queue:add" || cmd === "todo:add") return "queue:add";
    if (cmd === "mind:queue:list" || cmd === "todo:list") return "queue:status";
    return cmd;
  });
  if (
    isCognitiveValidatorRole(role) &&
    !isMechanicValidatorRole(role) &&
    commands.includes("run:exec")
  ) {
    invalid(
      "role contract",
      source,
      `cognitive validator role ${role} must not declare run:exec in commands (command-running ban)`,
    );
  }
  return {
    role,
    tier,
    may: requireList(frontmatter, "may", source),
    must_not: requireList(frontmatter, "must_not", source),
    commands,
    spawns,
    ...(domain !== undefined ? { domain } : {}),
    text,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
