import { lineOf } from "./scanner.ts";
import type { ModuleRecord } from "./modules.ts";
import type { SourceFile } from "./sources.ts";
import { finding, type HealthCheckResult, type HealthFinding } from "./types.ts";

/** A comment line that is not prose but a statement someone stopped running. */
const CODE_SHAPED =
  /^(?:const|let|var|if|for|while|switch|return|await|import|export|function|class|throw|try)\b.*[;{]$|^[A-Za-z0-9_$.]+\([^)]*\);$|^\}\s*(?:else\b.*)?[;{]?$/u;

/** B4: a branch kept for a shape that no longer exists. The words are how such branches announce themselves. */
const SUPERSEDED_WORDS =
  /\b(?:legacy|deprecated|back[- ]?compat(?:ibility)?|older format|old format)\b/iu;

/** The same words inside an identifier: `legacyShape` announces the branch just as loudly. */
const SUPERSEDED_IDENTIFIER = /[A-Za-z0-9_$]*(?:legacy|deprecated|backcompat)[A-Za-z0-9_$]*/iu;

function commentedOutCode(file: SourceFile): HealthFinding[] {
  const findings: HealthFinding[] = [];
  for (const comment of file.scan.comments) {
    const lines = comment.text
      .split("\n")
      .map((line) => line.replace(/^\s*(?:\/\/|\/\*+|\*+\/?)\s?/u, "").trim())
      .filter(Boolean);
    const codeLines = lines.filter((line) => CODE_SHAPED.test(line));
    if (codeLines.length === 0) continue;
    findings.push(
      finding(
        "dead-code",
        `commented-out:${file.relative}:${comment.line}`,
        file.relative,
        `a comment holds ${codeLines.length} line(s) of code that no longer runs: \`${codeLines[0]}\``,
        comment.line,
      ),
    );
  }
  return findings;
}

function supersededBranches(file: SourceFile): HealthFinding[] {
  const findings: HealthFinding[] = [];
  const identifierHit = SUPERSEDED_IDENTIFIER.exec(file.scan.identifiers);
  if (identifierHit !== null) {
    findings.push(
      finding(
        "dead-code",
        `superseded-identifier:${file.relative}:${identifierHit[0].toLowerCase()}`,
        file.relative,
        `\`${identifierHit[0]}\` names a path kept for a shape the current writer no longer emits`,
        lineOf(file.scan.identifiers, identifierHit.index),
      ),
    );
  }
  for (const comment of file.scan.comments) {
    const match = SUPERSEDED_WORDS.exec(comment.text);
    if (match === null) continue;
    findings.push(
      finding(
        "dead-code",
        `superseded-comment:${file.relative}:${comment.line}`,
        file.relative,
        `a comment describes a superseded shape ("${match[0]}"); either the branch is dead or the comment is`,
        comment.line,
      ),
    );
  }
  return findings;
}

/** B8.3: the same helper implemented in two places is where the next silent divergence starts. */
function duplicateHelpers(modules: ReadonlyMap<string, ModuleRecord>): HealthFinding[] {
  const byName = new Map<string, ModuleRecord[]>();
  for (const record of modules.values()) {
    for (const entry of record.exports) {
      if (entry.kind !== "function" || entry.origin !== undefined) continue;
      const existing = byName.get(entry.name);
      if (existing === undefined) byName.set(entry.name, [record]);
      else existing.push(record);
    }
  }
  const findings: HealthFinding[] = [];
  for (const [name, records] of [...byName.entries()].sort()) {
    if (records.length < 2) continue;
    const files = records.map((record) => record.relative).sort();
    findings.push(
      finding(
        "dead-code",
        `duplicate-helper:${name}`,
        files[0] ?? "",
        `\`${name}\` is exported from ${files.length} modules: ${files.join(", ")}`,
      ),
    );
  }
  return findings;
}

export function checkDeadCode(
  files: readonly SourceFile[],
  modules: ReadonlyMap<string, ModuleRecord>,
): HealthCheckResult {
  return {
    check: "dead-code",
    title: "Dead or superseded code",
    findings: [
      ...files.flatMap(commentedOutCode),
      ...files.flatMap(supersededBranches),
      ...duplicateHelpers(modules),
    ],
    scanned: files.length,
    limitations: [
      "A commented-out statement is recognised by its shape; prose that reads like code is reported, and a commented-out expression that reads like prose is not.",
      "Duplicate helpers are matched by exported name only. Two divergent implementations under different names are not detected.",
      "A compatibility branch that never uses any of the known words reads as ordinary code.",
    ],
  };
}
