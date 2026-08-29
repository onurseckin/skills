import { findCommand } from "../cli/registry/index.ts";
import type { CommandSpec } from "../cli/registry/types.ts";
import type { CommandSyntaxInfo, RoleCommandCheatSheet } from "./types.ts";

export function formatCommandSyntax(spec: CommandSpec): CommandSyntaxInfo {
  const requiredFlags: string[] = [];
  const optionalFlags: string[] = [];
  const parts: string[] = [`bun harness.ts ${spec.name}`];

  for (const flag of spec.flags) {
    const isBool = flag.type === "bool";
    const valuePlaceholder = isBool ? "" : ` <${flag.type}>`;
    const flagStr = `--${flag.name}${valuePlaceholder}`;

    if (flag.required) {
      requiredFlags.push(flag.name);
      parts.push(flagStr);
    } else {
      optionalFlags.push(flag.name);
    }
  }

  if (optionalFlags.length > 0) {
    parts.push(`[--flags...]`);
  }

  return {
    syntax: parts.join(" "),
    requiredFlags,
    optionalFlags,
  };
}

export function buildCommandCheatSheet(commandName: string): RoleCommandCheatSheet {
  const spec = findCommand(commandName);
  if (!spec) {
    return {
      name: commandName,
      summary: `Harness command: ${commandName}`,
      syntax: `bun harness.ts ${commandName}`,
      requiredFlags: [],
      optionalFlags: [],
      examples: [`bun harness.ts ${commandName}`],
    };
  }

  const { syntax, requiredFlags, optionalFlags } = formatCommandSyntax(spec);
  return {
    name: spec.name,
    summary: spec.summary,
    syntax,
    requiredFlags,
    optionalFlags,
    examples: spec.examples.length > 0 ? spec.examples : [syntax],
  };
}
