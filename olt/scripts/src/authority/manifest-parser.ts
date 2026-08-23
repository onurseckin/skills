import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { HarnessError } from "../errors/harness-error.ts";

export type RoleTier = 0 | 1 | 2 | 3;

export interface RoleContractFrontmatter {
  readonly role: string;
  readonly tier: number;
  readonly domain?: string | undefined;
  readonly may?: readonly string[] | undefined;
  readonly must_not?: readonly string[] | undefined;
  readonly commands?: readonly string[] | undefined;
  readonly spawns?: readonly string[] | undefined;
  readonly [key: string]: unknown;
}

export interface RoleContract {
  readonly role: string;
  readonly tier: number;
  readonly domain?: string | undefined;
  readonly may: readonly string[];
  readonly mustNot: readonly string[];
  readonly commands: readonly string[];
  readonly spawns: readonly string[];
  readonly frontmatter: RoleContractFrontmatter;
  readonly body: string;
  readonly filePath?: string | undefined;
  readonly raw: string;
}

export interface AgentToolsConfig {
  readonly enable_subagent_tools?: boolean | undefined;
  readonly enable_write_tools?: boolean | undefined;
  readonly [key: string]: unknown;
}

export interface AgentManifestInterface {
  readonly display_name?: string | undefined;
  readonly short_description?: string | undefined;
  readonly role?: string | undefined;
  readonly tier?: number | undefined;
  readonly tools?: AgentToolsConfig | undefined;
  readonly config?: Readonly<Record<string, unknown>> | undefined;
  readonly milestone_notifications?: Readonly<Record<string, boolean>> | undefined;
  readonly mind_invariants?: Readonly<Record<string, boolean>> | undefined;
  readonly coordinator_invariants?: Readonly<Record<string, boolean>> | undefined;
  readonly [key: string]: unknown;
}

export interface AgentManifestProtocol {
  readonly cli?: string | undefined;
  readonly zero_json?: boolean | undefined;
  readonly role_contract?: string | undefined;
  readonly instructions?: string | undefined;
  readonly [key: string]: unknown;
}

export interface AgentManifest {
  readonly name: string;
  readonly role: string;
  readonly tier: number;
  readonly provider?: readonly string[] | undefined;
  readonly tools?: AgentToolsConfig | undefined;
  readonly config?: Readonly<Record<string, unknown>> | undefined;
  readonly interface?: AgentManifestInterface | undefined;
  readonly protocol?: AgentManifestProtocol | undefined;
  readonly filePath?: string | undefined;
  readonly raw?: string | undefined;
  readonly [key: string]: unknown;
}

export interface UnifiedAgentModel {
  readonly role: string;
  readonly name: string;
  readonly tier: number;
  readonly domain?: string | undefined;
  readonly displayName: string;
  readonly shortDescription: string;
  readonly archetype: string;
  readonly coreMandate: string;
  readonly may: readonly string[];
  readonly mustNot: readonly string[];
  readonly commands: readonly string[];
  readonly spawns: readonly string[];
  readonly instructions: string;
  readonly roleContractBody: string;
  readonly tools: {
    readonly enable_subagent_tools: boolean;
    readonly enable_write_tools: boolean;
  };
  readonly manifest: AgentManifest;
  readonly contract: RoleContract;
}

export interface ManifestLoaderOptions {
  readonly skillRoot?: string | undefined;
  readonly agentsDir?: string | undefined;
  readonly rolesDir?: string | undefined;
  readonly bypassCache?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Role Normalization Map & Helper
// ---------------------------------------------------------------------------

const ROLE_ALIASES: Readonly<Record<string, string>> = {
  // Mind / Tier 0
  mind: "mind",
  "tier-0": "mind",
  tier_0: "mind",
  "tier 0": "mind",
  human: "mind",
  "mind-auditor": "mind-auditor",
  mind_auditor: "mind-auditor",

  // Orchestrator / Tier 1
  orchestrator: "orchestrator",
  orch: "orchestrator",
  "tier-1": "orchestrator",
  tier_1: "orchestrator",
  "tier 1": "orchestrator",

  // Coordinator / Tier 2
  coordinator: "coordinator",
  coord: "coordinator",
  "tier-2": "coordinator",
  tier_2: "coordinator",
  "tier 2": "coordinator",

  // Tier 3
  implementer: "implementer",
  worker: "worker",
  repairer: "repairer",
  validator: "validator",
  "completeness-critic": "completeness-critic",
  critic: "critic",
  "plan-validator": "plan-validator",
  planner: "planner",
  "sub-implementer": "sub-implementer",
  "sub-investigator": "sub-investigator",
  "sub-validator": "sub-validator",
  "validator-code-quality": "validator-code-quality",
  "validator-product": "validator-product",
  "validator-security": "validator-security",
  "validator-system-design": "validator-system-design",
  "validator-ui-design": "validator-ui-design",
  antigravity: "antigravity",
  claude: "claude",
  codex: "codex",
  cursor: "cursor",
  generic: "generic",
  openai: "openai",
};

export function normalizeRoleName(roleInput: string): string {
  const trimmed = roleInput.trim().toLowerCase();
  if (ROLE_ALIASES[trimmed]) {
    return ROLE_ALIASES[trimmed];
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Skill Root Discovery
// ---------------------------------------------------------------------------

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
      // Check if cur itself has agents/ and roles/
      if (existsSync(join(cur, "agents")) && existsSync(join(cur, "roles"))) {
        return cur;
      }
      // Check if cur/olt has agents/ and roles/
      const sub = join(cur, "olt");
      if (existsSync(join(sub, "agents")) && existsSync(join(sub, "roles"))) {
        return sub;
      }
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }

  // Default fallback to current working directory or relative to module
  if (moduleDir) {
    return resolve(moduleDir, "../../..");
  }
  return process.cwd();
}

// ---------------------------------------------------------------------------
// Full-Featured Native YAML Parser
// ---------------------------------------------------------------------------

function stripYamlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "'" && !inDouble) {
      if (inSingle && line[i + 1] === "'") {
        i++;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (inDouble && char === "\\" && i + 1 < line.length) {
      i++;
      continue;
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (char === "#" && !inSingle && !inDouble) {
      if (i === 0 || line[i - 1] === " " || line[i - 1] === "\t") {
        return line.slice(0, i);
      }
    }
  }
  return line;
}

function parseYamlScalar(rawInput: string): unknown {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) return null;

  // Booleans
  if (/^(true|True|TRUE|yes|Yes|YES|on|On|ON)$/.test(trimmed)) return true;
  if (/^(false|False|FALSE|no|No|NO|off|Off|OFF)$/.test(trimmed)) return false;

  // Nulls
  if (/^(null|Null|NULL|~)$/.test(trimmed)) return null;

  // Flow Array / Sequence: [ ... ]
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return parseFlowSequence(inner);
  }

  // Flow Mapping / Object: { ... }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) return {};
    return parseFlowMapping(inner);
  }

  // Double quoted string
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed
        .slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t");
    }
  }

  // Single quoted string
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  // Numeric: Integer or Float
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
  }

  return trimmed;
}

function parseFlowSequence(inner: string): unknown[] {
  const items: unknown[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (inDouble && ch === "\\" && i + 1 < inner.length) {
      current += ch + inner[i + 1];
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth--;
      else if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
      else if (ch === "," && bracketDepth === 0 && braceDepth === 0) {
        if (current.trim().length > 0) {
          items.push(parseYamlScalar(current.trim()));
        }
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim().length > 0) {
    items.push(parseYamlScalar(current.trim()));
  }
  return items;
}

function parseFlowMapping(inner: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const entries: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (inDouble && ch === "\\" && i + 1 < inner.length) {
      current += ch + inner[i + 1];
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth--;
      else if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
      else if (ch === "," && bracketDepth === 0 && braceDepth === 0) {
        if (current.trim().length > 0) {
          entries.push(current.trim());
        }
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim().length > 0) {
    entries.push(current.trim());
  }

  for (const entry of entries) {
    const colonIdx = findColonKeyBoundary(entry);
    if (colonIdx !== -1) {
      const key = cleanYamlKey(entry.slice(0, colonIdx));
      const val = parseYamlScalar(entry.slice(colonIdx + 1));
      result[key] = val;
    }
  }

  return result;
}

function findColonKeyBoundary(line: string): number {
  let inSingle = false;
  let inDouble = false;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (inDouble && ch === "\\" && i + 1 < line.length) {
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth--;
      else if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
      else if (ch === ":" && bracketDepth === 0 && braceDepth === 0) {
        const next = line[i + 1];
        if (next === undefined || next === " " || next === "\t" || next === "\n" || next === "\r") {
          return i;
        }
      }
    }
  }
  return -1;
}

function cleanYamlKey(keyPart: string): string {
  let trimmed = keyPart.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1);
  }
  return trimmed;
}

interface ParsedLine {
  readonly originalLine: string;
  readonly indent: number;
  readonly text: string;
  readonly lineNum: number;
}

export function parseYaml(yamlText: string): unknown {
  const trimmed = yamlText.trim();
  if (trimmed.length === 0) return {};

  // If top-level is JSON or flow object/array
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Proceed to line-based parser
    }
  }

  const rawLines = yamlText.split(/\r?\n/);
  const parsedLines: ParsedLine[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i]!;
    const uncommented = stripYamlComment(rawLine);
    if (uncommented.trim().length === 0) {
      continue; // Skip blank / pure comment lines
    }

    // Match leading spaces
    const leadingSpacesMatch = /^[ \t]*/.exec(rawLine);
    const indent = leadingSpacesMatch ? leadingSpacesMatch[0].replace(/\t/g, "  ").length : 0;
    const text = uncommented.trim();

    parsedLines.push({
      originalLine: rawLine,
      indent,
      text,
      lineNum: i,
    });
  }

  if (parsedLines.length === 0) return {};
  if (
    parsedLines.length === 1 &&
    findColonKeyBoundary(parsedLines[0]!.text) === -1 &&
    !parsedLines[0]!.text.startsWith("-")
  ) {
    return parseYamlScalar(parsedLines[0]!.text);
  }

  let currentIdx = 0;

  function parseBlock(currentIndent: number): unknown {
    if (currentIdx >= parsedLines.length) return null;

    const firstLine = parsedLines[currentIdx]!;

    // Check if this block is a sequence (starts with "- ")
    const isSequence = firstLine.text === "-" || firstLine.text.startsWith("- ");

    if (isSequence) {
      const list: unknown[] = [];
      while (currentIdx < parsedLines.length) {
        const line = parsedLines[currentIdx]!;
        if (line.indent < currentIndent) break;

        if (line.text === "-" || line.text.startsWith("- ")) {
          const itemText = line.text === "-" ? "" : line.text.slice(2).trim();
          currentIdx++;

          // Check if itemText is a key-value or scalar
          if (itemText.length === 0) {
            // Indented block following empty list item
            if (currentIdx < parsedLines.length && parsedLines[currentIdx]!.indent > line.indent) {
              const childVal = parseBlock(parsedLines[currentIdx]!.indent);
              list.push(childVal);
            } else {
              list.push(null);
            }
          } else {
            // Check if item has block scalar |
            const colonBoundary = findColonKeyBoundary(itemText);
            if (colonBoundary !== -1) {
              const k = cleanYamlKey(itemText.slice(0, colonBoundary));
              const afterColon = itemText.slice(colonBoundary + 1).trim();

              if (
                afterColon === "|" ||
                afterColon === "|-" ||
                afterColon === "|+" ||
                afterColon === ">" ||
                afterColon === ">-"
              ) {
                const scalarVal = parseBlockScalar(rawLines, line.lineNum, afterColon);
                const obj: Record<string, unknown> = { [k]: scalarVal };
                // Check if there are other keys at the same sub-indent
                parseAdditionalObjectKeys(obj, line.indent + 2);
                list.push(obj);
              } else if (afterColon.length === 0) {
                // Nested object under this list item
                let childObj: Record<string, unknown> = {};
                if (
                  currentIdx < parsedLines.length &&
                  parsedLines[currentIdx]!.indent > line.indent
                ) {
                  const nested = parseBlock(parsedLines[currentIdx]!.indent);
                  if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
                    childObj = { [k]: nested, ...(nested as Record<string, unknown>) };
                  } else {
                    childObj = { [k]: nested };
                  }
                } else {
                  childObj = { [k]: null };
                }
                list.push(childObj);
              } else {
                const parsedVal = parseYamlScalar(afterColon);
                const obj: Record<string, unknown> = { [k]: parsedVal };
                parseAdditionalObjectKeys(obj, line.indent + 2);
                list.push(obj);
              }
            } else {
              list.push(parseYamlScalar(itemText));
            }
          }
        } else if (line.indent >= currentIndent) {
          // Additional lines for multiline array elements or continuation
          currentIdx++;
        } else {
          break;
        }
      }
      return list;
    }

    // Otherwise, this block is a mapping / object
    const obj: Record<string, unknown> = {};
    while (currentIdx < parsedLines.length) {
      const line = parsedLines[currentIdx]!;
      if (line.indent < currentIndent) break;

      const colonIdx = findColonKeyBoundary(line.text);
      if (colonIdx === -1) {
        currentIdx++;
        continue;
      }

      const key = cleanYamlKey(line.text.slice(0, colonIdx));
      const valuePart = line.text.slice(colonIdx + 1).trim();
      currentIdx++;

      if (
        valuePart === "|" ||
        valuePart === "|-" ||
        valuePart === "|+" ||
        valuePart === ">" ||
        valuePart === ">-" ||
        valuePart === ">+"
      ) {
        obj[key] = parseBlockScalar(rawLines, line.lineNum, valuePart);
      } else if (valuePart.length === 0) {
        // Child block
        if (currentIdx < parsedLines.length && parsedLines[currentIdx]!.indent > line.indent) {
          obj[key] = parseBlock(parsedLines[currentIdx]!.indent);
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseYamlScalar(valuePart);
      }
    }
    return obj;
  }

  function parseAdditionalObjectKeys(target: Record<string, unknown>, minIndent: number): void {
    while (currentIdx < parsedLines.length) {
      const nextLine = parsedLines[currentIdx]!;
      if (nextLine.indent < minIndent) break;
      if (nextLine.text.startsWith("- ")) break;

      const colIdx = findColonKeyBoundary(nextLine.text);
      if (colIdx !== -1) {
        const nextKey = cleanYamlKey(nextLine.text.slice(0, colIdx));
        const nextValPart = nextLine.text.slice(colIdx + 1).trim();
        currentIdx++;

        if (
          nextValPart === "|" ||
          nextValPart === "|-" ||
          nextValPart === "|+" ||
          nextValPart === ">" ||
          nextValPart === ">-"
        ) {
          target[nextKey] = parseBlockScalar(rawLines, nextLine.lineNum, nextValPart);
        } else if (nextValPart.length === 0) {
          if (
            currentIdx < parsedLines.length &&
            parsedLines[currentIdx]!.indent > nextLine.indent
          ) {
            target[nextKey] = parseBlock(parsedLines[currentIdx]!.indent);
          } else {
            target[nextKey] = null;
          }
        } else {
          target[nextKey] = parseYamlScalar(nextValPart);
        }
      } else {
        currentIdx++;
      }
    }
  }

  function parseBlockScalar(allLines: string[], headerLineNum: number, indicator: string): string {
    const collected: string[] = [];
    let baseIndent: number | null = null;
    let linePtr = headerLineNum + 1;

    while (linePtr < allLines.length) {
      const raw = allLines[linePtr]!;
      if (raw.trim().length === 0) {
        // Empty line inside multiline string
        collected.push("");
        linePtr++;
        continue;
      }

      const leadingMatch = /^[ \t]*/.exec(raw);
      const indent = leadingMatch ? leadingMatch[0].replace(/\t/g, "  ").length : 0;

      if (baseIndent === null) {
        // First non-empty line determines base indentation
        const headerLeading = /^[ \t]*/.exec(allLines[headerLineNum]!);
        const headerIndent = headerLeading ? headerLeading[0].replace(/\t/g, "  ").length : 0;
        if (indent <= headerIndent) {
          break; // Multiline block ended immediately
        }
        baseIndent = indent;
      }

      if (indent < baseIndent) {
        break; // Dedented line marks end of scalar
      }

      // Strip baseIndent spaces
      const stripped = raw.length >= baseIndent ? raw.slice(baseIndent) : raw.trimStart();
      collected.push(stripped);
      linePtr++;
    }

    // Fast-forward parsedLines index past the block scalar lines
    while (currentIdx < parsedLines.length && parsedLines[currentIdx]!.lineNum < linePtr) {
      currentIdx++;
    }

    let resultText = "";
    const isFolded = indicator.startsWith(">");
    if (isFolded) {
      // Fold consecutive non-empty lines with a space
      let buffer = "";
      for (let i = 0; i < collected.length; i++) {
        const l = collected[i]!;
        if (l.trim().length === 0) {
          if (buffer.length > 0) {
            resultText += (resultText.length > 0 ? "\n" : "") + buffer;
            buffer = "";
          }
          resultText += "\n";
        } else {
          if (buffer.length > 0) buffer += " " + l.trim();
          else buffer = l.trim();
        }
      }
      if (buffer.length > 0) {
        resultText += (resultText.length > 0 ? "\n" : "") + buffer;
      }
    } else {
      resultText = collected.join("\n");
    }

    if (indicator.includes("-")) {
      resultText = resultText.replace(/\n+$/, "");
    } else if (!indicator.includes("+")) {
      resultText = resultText.replace(/\n*$/, "\n");
    }

    return resultText;
  }

  const result = parseBlock(0);
  return result ?? {};
}

// ---------------------------------------------------------------------------
// Markdown Frontmatter Parser
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Role Contract & Agent Manifest Parsers
// ---------------------------------------------------------------------------

export function parseRoleContract(content: string, filePath?: string): RoleContract {
  const { frontmatter, body } = parseMarkdownFrontmatter<RoleContractFrontmatter>(content);

  const role =
    typeof frontmatter.role === "string"
      ? normalizeRoleName(frontmatter.role)
      : filePath
        ? basename(filePath, extname(filePath))
        : "unknown";
  const tier = typeof frontmatter.tier === "number" ? frontmatter.tier : 3;
  const domain = typeof frontmatter.domain === "string" ? frontmatter.domain : undefined;

  const may: readonly string[] = Array.isArray(frontmatter.may)
    ? frontmatter.may.map((item) => String(item).trim()).filter(Boolean)
    : [];

  const mustNot: readonly string[] = Array.isArray(frontmatter.must_not)
    ? frontmatter.must_not.map((item) => String(item).trim()).filter(Boolean)
    : [];

  const commands: readonly string[] = Array.isArray(frontmatter.commands)
    ? frontmatter.commands.map((item) => String(item).trim()).filter(Boolean)
    : [];

  const spawns: readonly string[] = Array.isArray(frontmatter.spawns)
    ? frontmatter.spawns.map((item) => String(item).trim()).filter(Boolean)
    : [];

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

export function parseAgentManifest(content: string, filePath?: string): AgentManifest {
  const parsed = parseYaml(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Failed to parse agent manifest YAML: output is not an object (file: ${filePath ?? "in-memory"})`,
    );
  }

  const record = parsed as Record<string, unknown>;

  const name =
    typeof record.name === "string"
      ? record.name
      : filePath
        ? basename(filePath, extname(filePath))
        : "agent";
  const role =
    typeof record.role === "string" ? normalizeRoleName(record.role) : normalizeRoleName(name);
  const tier = typeof record.tier === "number" ? record.tier : 3;

  const provider: readonly string[] = Array.isArray(record.provider)
    ? record.provider.map((p) => String(p).trim()).filter(Boolean)
    : [];

  const tools: AgentToolsConfig | undefined =
    typeof record.tools === "object" && record.tools !== null
      ? (record.tools as AgentToolsConfig)
      : undefined;

  const config =
    typeof record.config === "object" && record.config !== null
      ? (record.config as Record<string, unknown>)
      : undefined;

  const iface =
    typeof record.interface === "object" && record.interface !== null
      ? (record.interface as AgentManifestInterface)
      : undefined;

  const protocol =
    typeof record.protocol === "object" && record.protocol !== null
      ? (record.protocol as AgentManifestProtocol)
      : undefined;

  return {
    name,
    role,
    tier,
    provider: provider.length > 0 ? provider : undefined,
    tools,
    config,
    interface: iface,
    protocol,
    filePath,
    raw: content,
  };
}

// ---------------------------------------------------------------------------
// Manifest Loader & Cache Management
// ---------------------------------------------------------------------------

const CONTRACT_CACHE = new Map<string, RoleContract>();
const MANIFEST_CACHE = new Map<string, AgentManifest>();
const UNIFIED_CACHE = new Map<string, UnifiedAgentModel>();

export function clearManifestCache(): void {
  CONTRACT_CACHE.clear();
  MANIFEST_CACHE.clear();
  UNIFIED_CACHE.clear();
}

export function loadRoleContract(roleInput: string, options?: ManifestLoaderOptions): RoleContract {
  const role = normalizeRoleName(roleInput);
  const bypassCache = options?.bypassCache ?? false;

  if (!bypassCache && CONTRACT_CACHE.has(role)) {
    return CONTRACT_CACHE.get(role)!;
  }

  const skillRoot = options?.skillRoot ?? findSkillRoot();
  const rolesDir = options?.rolesDir ?? join(skillRoot, "roles");

  // Attempt resolving direct file names
  const candidateFiles = [
    join(rolesDir, `${role}.md`),
    join(rolesDir, `${roleInput}.md`),
    join(rolesDir, `roles/${role}.md`),
  ];

  // Specific domain validations
  if (role.startsWith("validator-")) {
    candidateFiles.unshift(join(rolesDir, `${role}.md`));
  }

  let foundPath: string | null = null;
  for (const cand of candidateFiles) {
    if (existsSync(cand)) {
      foundPath = cand;
      break;
    }
  }

  if (!foundPath) {
    // If not found directly, scan directory for matching role in frontmatter
    if (existsSync(rolesDir)) {
      try {
        const files = readdirSync(rolesDir);
        for (const file of files) {
          if (file.endsWith(".md")) {
            const fullPath = join(rolesDir, file);
            const content = readFileSync(fullPath, "utf-8");
            const parsed = parseRoleContract(content, fullPath);
            if (normalizeRoleName(parsed.role) === role) {
              foundPath = fullPath;
              CONTRACT_CACHE.set(role, parsed);
              return parsed;
            }
          }
        }
      } catch {
        // Continue to error
      }
    }
  }

  if (!foundPath || !existsSync(foundPath)) {
    // Create fallback synthetic contract rather than crashing if not present
    const fallbackContract: RoleContract = {
      role,
      tier: 3,
      may: [`Operate as ${role} inside assigned task boundaries`],
      mustNot: [`Violate ${role} role boundaries or edit files outside assigned scope`],
      commands: ["task:claim", "task:heartbeat", "task:submit", "whoami"],
      spawns: [],
      frontmatter: { role, tier: 3 },
      body: `# Role: ${role}\n\nSynthetic contract loaded for role \`${role}\`.`,
      raw: `---\nrole: ${role}\ntier: 3\n---\n# Role: ${role}`,
    };
    if (!bypassCache) CONTRACT_CACHE.set(role, fallbackContract);
    return fallbackContract;
  }

  const content = readFileSync(foundPath, "utf-8");
  const contract = parseRoleContract(content, foundPath);
  if (!bypassCache) {
    CONTRACT_CACHE.set(role, contract);
  }
  return contract;
}

export function loadAgentManifest(
  roleInput: string,
  options?: ManifestLoaderOptions,
): AgentManifest {
  const role = normalizeRoleName(roleInput);
  const bypassCache = options?.bypassCache ?? false;

  if (!bypassCache && MANIFEST_CACHE.has(role)) {
    return MANIFEST_CACHE.get(role)!;
  }

  const skillRoot = options?.skillRoot ?? findSkillRoot();
  const agentsDir = options?.agentsDir ?? join(skillRoot, "agents");

  const candidateFiles = [
    join(agentsDir, `${role}.yaml`),
    join(agentsDir, `${role}.yml`),
    join(agentsDir, `${roleInput}.yaml`),
    join(agentsDir, `${roleInput}.yml`),
  ];

  let foundPath: string | null = null;
  for (const cand of candidateFiles) {
    if (existsSync(cand)) {
      foundPath = cand;
      break;
    }
  }

  if (!foundPath) {
    if (existsSync(agentsDir)) {
      try {
        const files = readdirSync(agentsDir);
        for (const file of files) {
          if (file.endsWith(".yaml") || file.endsWith(".yml")) {
            const fullPath = join(agentsDir, file);
            const content = readFileSync(fullPath, "utf-8");
            const parsed = parseAgentManifest(content, fullPath);
            if (
              normalizeRoleName(parsed.role) === role ||
              normalizeRoleName(parsed.name) === role
            ) {
              foundPath = fullPath;
              MANIFEST_CACHE.set(role, parsed);
              return parsed;
            }
          }
        }
      } catch {
        // Continue to fallback
      }
    }
  }

  if (!foundPath || !existsSync(foundPath)) {
    // Synthetic fallback manifest
    const fallbackManifest: AgentManifest = {
      name: role,
      role,
      tier: 3,
      provider: ["generic"],
      tools: {
        enable_subagent_tools: true,
        enable_write_tools: role === "implementer" || role === "repairer" || role === "worker",
      },
      interface: {
        display_name: `${role.toUpperCase()} Agent`,
        short_description: `Agent executing tasks under role ${role}`,
        role,
        tier: 3,
      },
      protocol: {
        cli: "bun ~/.agents/skills/olt/scripts/harness.ts",
        zero_json: true,
      },
      raw: `name: "${role}"\nrole: "${role}"\ntier: 3`,
    };
    if (!bypassCache) MANIFEST_CACHE.set(role, fallbackManifest);
    return fallbackManifest;
  }

  const content = readFileSync(foundPath, "utf-8");
  const manifest = parseAgentManifest(content, foundPath);
  if (!bypassCache) {
    MANIFEST_CACHE.set(role, manifest);
  }
  return manifest;
}

export function loadUnifiedAgentModel(
  roleInput: string,
  options?: ManifestLoaderOptions,
): UnifiedAgentModel {
  const role = normalizeRoleName(roleInput);
  const bypassCache = options?.bypassCache ?? false;

  if (!bypassCache && UNIFIED_CACHE.has(role)) {
    return UNIFIED_CACHE.get(role)!;
  }

  const contract = loadRoleContract(role, options);
  const manifest = loadAgentManifest(role, options);

  const displayName =
    manifest.interface?.display_name ?? `${role.charAt(0).toUpperCase() + role.slice(1)} Agent`;
  const shortDescription =
    manifest.interface?.short_description ?? `Agent operating under the ${role} contract.`;
  const tier = manifest.tier ?? contract.tier;

  let archetype = "Autonomous Worker";
  let coreMandate = shortDescription;

  if (tier === 0) {
    archetype = "Autonomous Consciousness & Observe-Only Lead";
    coreMandate =
      "Operate indefinitely as an infinite autonomous consciousness loop, supervising pulse health, generational rotation, and global execution topology without touching repository code.";
  } else if (tier === 1) {
    archetype = "Plan Supervisor & Multi-Round Release Manager";
    coreMandate =
      "Drive multi-round autonomous execution loops, dispatch Tier 2 Domain Coordinators, synthesize findings into next-round prompts, and execute final git releases on dedicated background threads.";
  } else if (tier === 2) {
    archetype = "Wave Execution & Lease Manager";
    coreMandate =
      "Own the run capsule, compile task graphs, dispatch parallel wave lanes to Tier 3 workers, prove gates on disposable scratch copies, enforce quantitative validation, and declare run completion.";
  } else if (role === "validator" || role.startsWith("validator-")) {
    archetype = "Adversarial Verifier & Quantitative Gate Inspector";
    coreMandate =
      "Independently verify task submissions with quantitative metrics, adversarial probes, dual-channel visual validation, and counterfactual falsifiability proofs.";
  } else if (role === "implementer" || role === "repairer" || role === "worker") {
    archetype = "Scoped Modular Implementer";
    coreMandate =
      "Implement modular code strictly within the leased write scope, execute pre-submission verification, maintain 100% strict TypeScript types, and answer findings with proof.";
  } else if (role === "completeness-critic") {
    archetype = "Run Completeness & Verification Critic";
    coreMandate =
      "Independently inspect run convergence, unresolved findings, orphan evidence, and multi-viewport proofs before authorizing run completion.";
  }

  const enableSubagentTools =
    manifest.tools?.enable_subagent_tools ??
    manifest.interface?.tools?.enable_subagent_tools ??
    true;
  const enableWriteTools =
    manifest.tools?.enable_write_tools ??
    manifest.interface?.tools?.enable_write_tools ??
    (tier === 3 && (role === "implementer" || role === "repairer" || role === "worker"));

  const instructions = manifest.protocol?.instructions ?? "";
  const roleContractBody = contract.body;

  const unified: UnifiedAgentModel = {
    role,
    name: manifest.name,
    tier,
    domain: contract.domain,
    displayName,
    shortDescription,
    archetype,
    coreMandate,
    may: contract.may,
    mustNot: contract.mustNot,
    commands: contract.commands,
    spawns: contract.spawns,
    instructions,
    roleContractBody,
    tools: {
      enable_subagent_tools: enableSubagentTools,
      enable_write_tools: enableWriteTools,
    },
    manifest,
    contract,
  };

  if (!bypassCache) {
    UNIFIED_CACHE.set(role, unified);
  }

  return unified;
}

export function listAvailableRoles(options?: ManifestLoaderOptions): readonly string[] {
  const skillRoot = options?.skillRoot ?? findSkillRoot();
  const rolesDir = options?.rolesDir ?? join(skillRoot, "roles");
  const rolesSet = new Set<string>();

  if (existsSync(rolesDir)) {
    try {
      const files = readdirSync(rolesDir);
      for (const file of files) {
        if (file.endsWith(".md")) {
          const roleName = basename(file, ".md");
          rolesSet.add(normalizeRoleName(roleName));
        }
      }
    } catch {
      // Ignore
    }
  }

  return Array.from(rolesSet).sort();
}

export function listAvailableManifests(options?: ManifestLoaderOptions): readonly string[] {
  const skillRoot = options?.skillRoot ?? findSkillRoot();
  const agentsDir = options?.agentsDir ?? join(skillRoot, "agents");
  const agentsSet = new Set<string>();

  if (existsSync(agentsDir)) {
    try {
      const files = readdirSync(agentsDir);
      for (const file of files) {
        if (file.endsWith(".yaml") || file.endsWith(".yml")) {
          const agentName = basename(file, extname(file));
          agentsSet.add(normalizeRoleName(agentName));
        }
      }
    } catch {
      // Ignore
    }
  }

  return Array.from(agentsSet).sort();
}
