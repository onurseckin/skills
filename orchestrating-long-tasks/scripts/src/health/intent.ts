import { readFileSync } from "node:fs";
import { commandInvocations } from "../cli/registry/index.ts";
import { EXTERNAL_IDENTIFIERS } from "./external-identifiers.ts";
import type { SourceFile } from "./sources.ts";
import { finding, type HealthCheckResult, type HealthFinding } from "./types.ts";

export interface IntentDocument {
  /** Repo-relative path, used in finding keys. */
  readonly relative: string;
  readonly absolute: string;
  /** Heading level that starts a requirement, e.g. 2 for `## R5 - ...`. */
  readonly headingLevel: number;
}

export interface IntentInput {
  readonly documents: readonly IntentDocument[];
  /** Every production file of every repo in scope, so a requirement may be met on either side. */
  readonly production: readonly SourceFile[];
  readonly tests: readonly SourceFile[];
  /** Every file path in the scanned repos, used to resolve a file token by suffix. */
  readonly paths: readonly string[];
  /**
   * Whether the command registry linked into this process is the one the documents describe. When
   * it is not, a command token names a registry this check cannot see, so it is counted as
   * unclassifiable rather than declared missing.
   */
  readonly registryApplies: boolean;
}

interface Requirement {
  readonly id: string;
  readonly heading: string;
  readonly tokens: readonly string[];
  /** The heading itself carries `deferred by owner` — see OWNER_DEFERRED below. */
  readonly ownerDeferred: boolean;
}

const COMMAND_TOKEN = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/u;
const IDENTIFIER_TOKEN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const PATH_TOKEN = /^[A-Za-z0-9_@./-]+\.(?:ts|tsx|md)$/u;
const PLACEHOLDER_TOKEN = /[<>*]/u;
const EXTERNAL_IDENTIFIER_SET = new Set(EXTERNAL_IDENTIFIERS);
// A requirement the owner has explicitly declined to implement (BACKLOG.md's `deferred by owner`
// status, e.g. B31) can never gain a satisfying symbol or a test that mentions one - not because
// the code is missing, but because writing that code was the thing the owner said not to do. Same
// shape as an external identifier: a token this check will forever call drift unless it recognises
// the reason. Recognised by exact phrase rather than a general status parser, because BACKLOG.md's
// own status vocabulary is not fully standardised (`research-in-flight` exists too, and is NOT
// exempted here - that item is still headed toward implementation, just not yet applied).
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
  // A requirement doc may cite another application's own tool, env var or parameter name to reason
  // about host behaviour (B27, B30, B32 research). That name will never appear in this repo's
  // source or tests - it belongs to the host, not to us - so it is excluded rather than judged
  // missing. See external-identifiers.ts for what qualifies and why.
  if (EXTERNAL_IDENTIFIER_SET.has(token)) return null;
  if (COMMAND_TOKEN.test(token)) {
    return input.registryApplies ? { kind: "command", found: invocations.has(token) } : null;
  }
  // Documents name a file by the tail of its path, so the token is matched as a path suffix rather
  // than resolved from a root. A name that matches no file may still name an artifact the run
  // produces, in which case the writer spells it out as a literal - that counts as present.
  if (PATH_TOKEN.test(token)) {
    const onDisk = input.paths.some((path) => path.endsWith(`/${token}`));
    const written = input.production.some((file) => file.text.includes(token));
    return { kind: "file", found: onDisk || written };
  }
  // A backticked lowercase word is a value the prose quotes ("pass", "derived"), not a symbol.
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

  for (const document of input.documents) {
    const text = readFileSync(document.absolute, "utf-8");
    for (const requirement of sections(text, document.headingLevel)) {
      requirements += 1;
      if (requirement.ownerDeferred) {
        // Not silence-by-omission: counted and disclosed below, same as an external-identifier
        // exemption, so the gap in coverage is visible rather than discovered.
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
      // An exemption that removes a requirement's LAST checkable token silences it entirely: with
      // nothing classified there is no missing-symbol finding and no untested finding either. That
      // is the one way this list can hide a real gap, so the count is reported rather than left to
      // be discovered.
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
      const proven = classified.filter(
        (entry) => entry.verdict.found && present(input.tests, entry.token),
      );
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
