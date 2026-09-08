import { join } from "node:path";
import { ensureGlobalChatBinary, ensureGlobalChatroomBinary } from "./chatroom-bin.ts";
import { ensureGlobalOltBinary } from "./olt-bin.ts";
import type { EnsureBinaryOptions, EnsureBinaryResult } from "./olt-bin.ts";

export type SkillKind = "tooling" | "documentation";

export type BinaryEnsurer = (options?: EnsureBinaryOptions) => EnsureBinaryResult;

export interface SkillDefinition {
  readonly name: string;
  readonly kind: SkillKind;
  readonly sourceSubdir: string;
  readonly hasGlobalBinary: boolean;
  readonly ensureBinaries: Readonly<Record<string, BinaryEnsurer>>;
}

export const SKILL_REGISTRY = [
  {
    name: "olt",
    kind: "tooling",
    sourceSubdir: "olt",
    hasGlobalBinary: true,
    ensureBinaries: { olt: ensureGlobalOltBinary },
  },
  {
    name: "chatroom",
    kind: "tooling",
    sourceSubdir: "chatroom",
    hasGlobalBinary: true,
    ensureBinaries: { chatroom: ensureGlobalChatroomBinary, chat: ensureGlobalChatBinary },
  },
  {
    name: "agy-switch-helper",
    kind: "documentation",
    sourceSubdir: "agy-switch-helper",
    hasGlobalBinary: false,
    ensureBinaries: {},
  },
] as const satisfies readonly SkillDefinition[];

export type SkillName = (typeof SKILL_REGISTRY)[number]["name"];

export const SKILL_NAMES: readonly SkillName[] = SKILL_REGISTRY.map((entry) => entry.name);

export function getSkillDefinition(name: string): SkillDefinition | undefined {
  return SKILL_REGISTRY.find((entry) => entry.name === name);
}

export function resolveSourceDir(
  sourceRepoRoot: string,
  definition: Pick<SkillDefinition, "sourceSubdir">,
): string {
  return join(sourceRepoRoot, definition.sourceSubdir);
}

export function resolveDefaultMirrorDir(home: string, name: string): string {
  return join(home, ".agents", "skills", name);
}
