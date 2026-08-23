import { readFileSync } from "node:fs";
import { commandInvocations } from "../cli/registry/index.ts";
import { EXTERNAL_IDENTIFIERS } from "./external-identifiers.ts";
import type { SourceFile } from "./sources.ts";
import { finding, type HealthCheckResult, type HealthFinding } from "./types.ts";

export interface IntentDocument {
  readonly relative: string;
  readonly absolute: string;
  readonly headingLevel: number;
}

export interface IntentInput {
  readonly documents: readonly IntentDocument[];
  readonly production: readonly SourceFile[];
  readonly tests: readonly SourceFile[];
  readonly paths: readonly string[];
  readonly registryApplies: boolean;
}

interface Requirement {
  readonly id: string;
  readonly heading: string;
  readonly tokens: readonly string[];
  readonly ownerDeferred: boolean;
}

const COMMAND_TOKEN = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/u;
const IDENTIFIER_TOKEN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const PATH_TOKEN = /^[A-Za-z0-9_@./-]+\.(?:ts|tsx|md)$/u;
const TEST_PATH_TOKEN = /\.(?:test|spec)\.tsx?$/u;
const PLACEHOLDER_TOKEN = /[<>*]/u;
const EXTERNAL_IDENTIFIER_SET = new Set(EXTERNAL_IDENTIFIERS);
const OWNER_DEFERRED = /`deferred by owner`\s*$/iu;

function sections(text: string, level: number): Requirement[] {
  const marker = `${"#".repeat(level)} `;
  const lines = text.split("\n");
  const found: Requirement[] = [];
  let heading: string | null = null;
  let body: string[] = [];
  const flush = (): void => {
    if (heading === null) return;
    const tokens = [...body.join("\n").matchAll(/`([^`\n]+)`/gu)].map((match) => match[1] ?? "");
    const id = /\b(R[0-9]+|B[0-9]+(?:\.[0-9]+)?)\b/u.exec(heading)?.[1];
    found.push({
      id: id ?? heading.slice(0, 24),
      heading,
      tokens: [...new Set(tokens)],
      ownerDeferred: OWNER_DEFERRED.test(heading),
    });
  };
  for (const line of lines) {
    if (line.startsWith(marker)) {
      flush();
      heading = line.slice(marker.length).trim();
      body = [];
      continue;
    }
    body.push(line);
  }
  flush();
  return found;
}

function present(files: readonly SourceFile[], token: string): boolean {
  const pattern = new RegExp(`\\b${token.replace(/[$]/gu, "\\$")}\\b`, "u");
  return files.some((file) => pattern.test(file.text));
}

function classify(
  token: string,
  input: IntentInput,
  invocations: ReadonlySet<string>,
): { kind: string; found: boolean } | null {
  if (PLACEHOLDER_TOKEN.test(token)) return null;
  if (EXTERNAL_IDENTIFIER_SET.has(token)) return null;
  if (COMMAND_TOKEN.test(token)) {
    return input.registryApplies ? { kind: "command", found: invocations.has(token) } : null;
  }
  if (PATH_TOKEN.test(token)) {
    const onDisk = input.paths.some((path) => path.endsWith(`/${token}`));
    const written = input.production.some(
      (file) => !file.relative.endsWith("health/allowlist.ts") && file.text.includes(token),
    );
    const isTest = TEST_PATH_TOKEN.test(token);
    return { kind: isTest ? "test" : "file", found: isTest ? onDisk : onDisk || written };
  }
  if (IDENTIFIER_TOKEN.test(token) && /[A-Z]/u.test(token)) {
    return { kind: "symbol", found: present(input.production, token) };
  }
  return null;
}

export function checkIntentDrift(input: IntentInput): HealthCheckResult {
  const invocations = new Set(commandInvocations());
  const findings: HealthFinding[] = [];
  let checkable = 0;
  let unclassified = 0;
  let external = 0;
  let externalOnly = 0;
  let requirements = 0;
  let ownerDeferred = 0;
  let selfProvingTests = 0;

  for (const document of input.documents) {
    const text = readFileSync(document.absolute, "utf-8");
    for (const requirement of sections(text, document.headingLevel)) {
      requirements += 1;
      if (requirement.ownerDeferred) {
        ownerDeferred += 1;
        continue;
      }
      const requirementExternal = requirement.tokens.filter((token) =>
        EXTERNAL_IDENTIFIER_SET.has(token),
      ).length;
      external += requirementExternal;
      const classified = requirement.tokens
        .map((token) => ({ token, verdict: classify(token, input, invocations) }))
        .filter(
          (entry): entry is { token: string; verdict: { kind: string; found: boolean } } =>
            entry.verdict !== null,
        );
      unclassified += requirement.tokens.length - classified.length - requirementExternal;
      checkable += classified.length;
      if (classified.length === 0 && requirementExternal > 0) externalOnly += 1;
      const missing = classified.filter((entry) => !entry.verdict.found);
      for (const entry of missing) {
        findings.push(
          finding(
            "intent-drift",
            `intent-missing:${document.relative}:${requirement.id}:${entry.token}`,
            document.relative,
            `${requirement.id} names the ${entry.verdict.kind} \`${entry.token}\`, which is not present in the scanned source`,
          ),
        );
      }
      const proven = classified.filter((entry) => {
        if (!entry.verdict.found) return false;
        if (entry.verdict.kind === "test") {
          selfProvingTests += 1;
          return true;
        }
        return present(input.tests, entry.token);
      });
      if (classified.length > 0 && proven.length === 0) {
        findings.push(
          finding(
            "intent-drift",
            `intent-untested:${document.relative}:${requirement.id}`,
            document.relative,
            `${requirement.id} names ${classified.length} symbol(s) and no test in the suite mentions any of them`,
          ),
        );
      }
    }
  }

  return {
    check: "intent-drift",
    title: "Intent drift: requirements mapped to code and to a test",
    findings,
    scanned: requirements,
    limitations: [
      `${unclassified} backticked token(s) across the documents name no command, file or symbol and cannot be checked mechanically; prose requirements are outside this check entirely.`,
      `${checkable} token(s) were checkable.`,
      `${external} token(s) name another application's own identifier (see external-identifiers.ts) and were exempted rather than judged missing.`,
      `${externalOnly} requirement(s) named nothing checkable once those exemptions were applied, so this check says nothing about them either way.`,
      `${ownerDeferred} requirement(s) are marked \`deferred by owner\` in their own heading and are excluded entirely: the owner has explicitly declined to implement them, so no code or test will ever satisfy them.`,
      `${selfProvingTests} token(s) name a \`.test.ts\`/\`.spec.ts\` file directly; existing on disk was counted as its own proof rather than being searched for inside another test.`,
      ...(input.registryApplies
        ? []
        : [
            "The scanned tree is not the harness running this check, so command tokens were counted as unclassifiable rather than looked up in a registry that does not describe it.",
          ]),
      "A test that mentions a symbol is not proof that it asserts the requirement. This check finds requirements with NO test, never requirements with a weak one.",
      "A symbol is looked up by name across the scanned trees, so a requirement met under a different name reads as missing.",
    ],
  };
}
