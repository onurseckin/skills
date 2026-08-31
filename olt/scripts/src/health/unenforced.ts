import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMAND_REGISTRY, commandInvocations } from "../cli/registry/index.ts";
import { AGENT_ROLES } from "../core/contracts/index.ts";
import { parseRoleContract } from "../packets/role-contract.ts";
import { parseUnifiedAgentManifest } from "../authority/manifest-schema.ts";
import { listFiles } from "./sources.ts";
import type { ModuleRecord } from "./modules.ts";
import { finding, type HealthCheckResult, type HealthFinding } from "./types.ts";

export interface DeclarationInput {
  readonly production: ReadonlyMap<string, ModuleRecord>;
  readonly skillRoot: string;
  readonly registryApplies: boolean;
}

function moduleDeclaring(
  production: ReadonlyMap<string, ModuleRecord>,
  symbol: string,
): ModuleRecord | undefined {
  for (const record of production.values()) {
    if (record.exports.some((entry) => entry.name === symbol && entry.origin === undefined)) {
      return record;
    }
  }
  return undefined;
}

function unreadFlags(production: ReadonlyMap<string, ModuleRecord>): HealthFinding[] {
  const findings: HealthFinding[] = [];
  for (const spec of COMMAND_REGISTRY) {
    const handlerModule = moduleDeclaring(production, spec.handler.name);
    if (handlerModule === undefined) {
      findings.push(
        finding(
          "unenforced-declarations",
          `handler-unresolved:${spec.name}`,
          "olt/scripts/src/cli/registry",
          `\`${spec.name}\` declares handler \`${spec.handler.name}\`, which no production module exports under that name; the flag check cannot run for it`,
        ),
      );
      continue;
    }
    const scope = [
      handlerModule,
      ...handlerModule.imports
        .map((binding) => production.get(binding.from))
        .filter((record): record is ModuleRecord => record !== undefined),
    ];
    const text = scope.map((record) => record.source.scan.code).join("\n");
    for (const flag of spec.flags) {
      if (text.includes(`"${flag.name}"`)) continue;
      findings.push(
        finding(
          "unenforced-declarations",
          `unread-flag:${spec.name}:${flag.name}`,
          handlerModule.relative,
          `\`${spec.name}\` declares \`--${flag.name}\` and nothing in its handler reads it; the value is accepted and dropped`,
        ),
      );
    }
  }
  return findings;
}

const CONFIG_MODULE = "config/index.ts";

function unreadConfigFields(production: ReadonlyMap<string, ModuleRecord>): HealthFinding[] {
  const config = [...production.values()].find((record) => record.relative.endsWith(CONFIG_MODULE));
  if (config === undefined) return [];
  const body = /export interface HarnessConfig\s*\{([\s\S]*?)\n\}/u.exec(config.source.scan.code);
  const fields = [...(body?.[1] ?? "").matchAll(/^\s*([a-z_][a-z0-9_]*)\s*[?]?:/gmu)].map(
    (match) => match[1] ?? "",
  );
  const readers = [...production.values()].filter(
    (record) => !record.relative.includes("/config/") && !record.relative.includes("/health/"),
  );
  return fields
    .filter((field) => !readers.some((record) => record.source.scan.code.includes(field)))
    .map((field) =>
      finding(
        "unenforced-declarations",
        `unread-config:${field}`,
        config.relative,
        `\`HarnessConfig.${field}\` is declared and defaulted, and no code outside the config module reads it`,
      ),
    );
}

const FRONTMATTER_COMMANDS = /\ncommands:\n((?:\s*-\s*[^\n]+\n)+)/u;

function roleContracts(skillRoot: string): HealthFinding[] {
  const invocations = new Set(commandInvocations());
  const roles = new Set<string>(AGENT_ROLES);
  const findings: HealthFinding[] = [];
  const agentsDir = join(skillRoot, "agents");
  if (!existsSync(agentsDir)) return findings;

  for (const path of listFiles(agentsDir, [".yaml", ".yml"])) {
    const text = readFileSync(path, "utf-8");
    const filename = path.split("/").pop() ?? "";
    const relative = `agents/${filename}`;
    const basenameWithoutExt = filename.replace(/\.(yaml|yml)$/, "");
    // Ignore provider profile configs and auxiliary aliases
    if (
      [
        "antigravity",
        "claude",
        "codex",
        "cursor",
        "generic",
        "openai",
        "worker",
        "critic",
        "independent-planner",
        "independent-planner-audit",
        "ui-mechanic-validator",
        "owner",
        "policy-discovery",
      ].includes(basenameWithoutExt)
    ) {
      continue;
    }

    let manifest;
    try {
      manifest = parseUnifiedAgentManifest(text, relative);
    } catch (error) {
      findings.push(
        finding(
          "unenforced-declarations",
          `role-unparseable:${relative}`,
          relative,
          `the contract cannot be parsed by the loader that binds it: ${error instanceof Error ? error.message : "unknown failure"}`,
        ),
      );
      continue;
    }

    const declared = manifest.role;
    if (declared === undefined || !roles.has(declared)) {
      findings.push(
        finding(
          "unenforced-declarations",
          `role-unknown:${relative}`,
          relative,
          `the contract declares role \`${declared ?? "none"}\`, which is not a member of the role vocabulary the code enforces`,
        ),
      );
    }

    const listed = manifest.permissions?.commands ?? [];
    for (const command of listed.filter((entry) => !invocations.has(entry))) {
      findings.push(
        finding(
          "unenforced-declarations",
          `role-command-missing:${relative}:${command}`,
          relative,
          `the contract grants \`${command}\`, which the command registry does not define`,
        ),
      );
    }
  }
  return findings;
}

const DOC_INVOCATION = /harness\.ts\s+([a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?)/gu;

function documentedCommands(skillRoot: string): HealthFinding[] {
  const invocations = new Set(commandInvocations());
  const findings: HealthFinding[] = [];
  const seen = new Set<string>();
  for (const path of listFiles(skillRoot, [".md"])) {
    const text = readFileSync(path, "utf-8");
    const relative = path.slice(skillRoot.length + 1);
    for (const match of text.matchAll(DOC_INVOCATION)) {
      const command = match[1] ?? "";
      const key = `documented-command-missing:${relative}:${command}`;
      if (invocations.has(command) || command === "help" || seen.has(key)) continue;
      seen.add(key);
      findings.push(
        finding(
          "unenforced-declarations",
          key,
          relative,
          `the document tells the reader to run \`harness.ts ${command}\`, which the registry does not define`,
        ),
      );
    }
  }
  return findings;
}

export function checkDeclarations(input: DeclarationInput): HealthCheckResult {
  return {
    check: "unenforced-declarations",
    title: "Declared but unenforced: knobs, contracts and documented commands",
    findings: [
      ...(input.registryApplies
        ? [
            ...unreadFlags(input.production),
            ...roleContracts(input.skillRoot),
            ...documentedCommands(input.skillRoot),
          ]
        : []),
      ...unreadConfigFields(input.production),
    ],
    scanned: input.registryApplies ? COMMAND_REGISTRY.length : input.production.size,
    limitations: input.registryApplies
      ? [
          "A flag counts as read when its name appears as a string in the handler's module or one it imports; appearing is not the same as being acted on.",
          "A config field counts as read when its name appears anywhere outside the config module, including in an unrelated context.",
          "Only the `commands:` grant of a role contract is checked for coverage. `may` and `must_not` are prose and no mechanical check can confirm the code enforces them.",
        ]
      : [
          "The scanned tree is not the harness running this check, so its command registry, role vocabulary and contract parser are not the ones linked into this process. Unread flags, role grants and documented invocations were NOT checked; only the config knobs, which are read from the scanned tree itself, were.",
          "A config field counts as read when its name appears anywhere outside the config module, including in an unrelated context.",
        ],
  };
}
