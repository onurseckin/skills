import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AgentRole } from "../../core/contracts/index.ts";
import { readRegularFileNoFollow } from "../../core/no-follow.ts";
import { HarnessError } from "../../core/errors/index.ts";
import { parseUnifiedAgentManifest } from "../../authority/manifest-schema.ts";
import {
  type RoleContract,
  type Checklist,
  type ValidatorDomain,
  AGENTS_ROOT,
  CHECKLISTS_ROOT,
} from "./role-contract-types.ts";
import { parseRoleContract, parseChecklist } from "./role-contract-rules.ts";

export function resolveRoleContractPath(role: AgentRole): string {
  const yamlPath = join(AGENTS_ROOT, `${role}.yaml`);
  if (existsSync(yamlPath)) return yamlPath;
  const ymlPath = join(AGENTS_ROOT, `${role}.yml`);
  if (existsSync(ymlPath)) return ymlPath;
  return yamlPath;
}

export function normalizeRoleName(role: string): string {
  const lower = role.toLowerCase().trim();
  if (lower === "critic") return "completeness-critic";
  if (lower === "worker") return "implementer";
  if (lower === "orch") return "orchestrator";
  if (lower === "coord") return "coordinator";
  return lower;
}

export function loadRoleContract(
  role: AgentRole,
  read: (path: string) => Uint8Array = readRegularFileNoFollow,
): RoleContract {
  const path = resolveRoleContractPath(role);
  let rawBytes: Uint8Array;
  try {
    rawBytes = read(path);
  } catch (error) {
    throw new HarnessError("INTEGRITY", `role contract is unreadable: ${path}: ${String(error)}`);
  }

  const contract = parseRoleContract(rawBytes, `${role}.yaml`);
  if (contract.role !== role && normalizeRoleName(contract.role) !== normalizeRoleName(role)) {
    throw new HarnessError("INTEGRITY", `role contract ${path} declares role ${contract.role}`);
  }
  return contract;
}

export function resolveChecklistPath(domain: ValidatorDomain): string {
  return join(CHECKLISTS_ROOT, `${domain}.md`);
}

export function loadChecklist(
  domain: ValidatorDomain,
  read: (path: string) => Uint8Array = readRegularFileNoFollow,
): Checklist {
  const path = resolveChecklistPath(domain);
  let bytes: Uint8Array;
  try {
    bytes = read(path);
  } catch (error) {
    throw new HarnessError("INTEGRITY", `checklist is unreadable: ${path}: ${String(error)}`);
  }
  const checklist = parseChecklist(bytes, `checklists/${domain}.md`);
  if (checklist.domain !== domain)
    throw new HarnessError("INTEGRITY", `checklist ${path} declares domain ${checklist.domain}`);
  return checklist;
}

export function resolveValidatorDomainContractPath(domain: ValidatorDomain): string {
  const domainYaml = join(AGENTS_ROOT, `validator-${domain}.yaml`);
  if (existsSync(domainYaml)) return domainYaml;
  return join(AGENTS_ROOT, "validator.yaml");
}

export function extractValidatorDomainSection(
  instructions: string,
  domain: ValidatorDomain,
): string | null {
  const blocks = instructions.split(/\n(?=---\s*\nrole:\s*validator)/);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed.startsWith("---")) continue;
    const lines = trimmed.split("\n");
    const end = lines.indexOf("---", 1);
    if (end === -1) continue;
    const frontmatterText = lines.slice(1, end).join("\n");
    const domainMatch = frontmatterText.match(/^domain:\s*([a-z-]+)$/m);
    if (domainMatch && domainMatch[1] === domain) {
      return trimmed;
    }
  }
  return null;
}

export function loadValidatorDomainContract(
  domain: ValidatorDomain,
  read: (path: string) => Uint8Array = readRegularFileNoFollow,
): RoleContract {
  const path = resolveValidatorDomainContractPath(domain);
  let bytes: Uint8Array;
  try {
    bytes = read(path);
  } catch (error) {
    throw new HarnessError("INTEGRITY", `role contract is unreadable: ${path}: ${String(error)}`);
  }

  const textContent = new TextDecoder("utf-8").decode(bytes);
  let contract: RoleContract;

  if (textContent.trimStart().startsWith("---")) {
    contract = parseRoleContract(bytes, `validator-${domain}.md`);
  } else {
    const manifest = parseUnifiedAgentManifest(textContent, path);
    if (manifest.role !== "validator" && manifest.name !== "validator") {
      throw new HarnessError(
        "INTEGRITY",
        `validator domain contract ${path} declares role ${manifest.role}`,
      );
    }

    const instructions = manifest.instructions || "";
    const matchedSection = extractValidatorDomainSection(instructions, domain);

    if (matchedSection) {
      contract = parseRoleContract(
        new TextEncoder().encode(matchedSection),
        `validator-${domain}.md`,
      );
    } else {
      const domainVal =
        typeof manifest.domain === "string" ? (manifest.domain as ValidatorDomain) : domain;
      contract = {
        role: "validator",
        tier: typeof manifest.tier === "number" ? manifest.tier : 3,
        may: manifest.permissions.may,
        must_not: manifest.permissions.must_not,
        commands: manifest.permissions.commands ?? [],
        spawns: manifest.permissions.spawns as AgentRole[],
        domain: domainVal,
        text: instructions,
        bytes: new TextEncoder().encode(instructions),
        sha256: createHash("sha256").update(new TextEncoder().encode(instructions)).digest("hex"),
      };
    }
  }

  if (contract.domain !== domain)
    throw new HarnessError(
      "INTEGRITY",
      `validator domain contract ${path} declares domain ${contract.domain ?? "none"}`,
    );
  const checklist = loadChecklist(domain, read);
  const text = `${contract.text.trimEnd()}\n\n## Standing checklist: ${checklist.title}\n\n${checklist.text.trim()}\n`;
  const bytes_ = Buffer.concat([
    Buffer.from(contract.bytes),
    Buffer.from("\n\0checklist\0\n"),
    Buffer.from(checklist.bytes),
  ]);
  return {
    role: contract.role,
    tier: contract.tier,
    may: contract.may,
    must_not: contract.must_not,
    commands: contract.commands,
    spawns: contract.spawns,
    domain,
    checklist,
    text,
    bytes: bytes_,
    sha256: createHash("sha256").update(bytes_).digest("hex"),
  };
}
