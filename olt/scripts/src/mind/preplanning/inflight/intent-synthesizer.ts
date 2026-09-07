import { basename, dirname, extname, join } from "node:path";
import type { InFlightSnapshot, UncommittedFileEntry } from "./inflight-types.ts";
import type { IntentCategory, IntentDomain } from "./intent-types.ts";

export function deriveTestScopeFromWriteScope(writeScope: readonly string[]): string[] {
  const testPaths: string[] = [];
  for (const path of writeScope) {
    if (path.includes(".test.") || path.includes(".spec.")) {
      testPaths.push(path);
      continue;
    }

    let testPath: string;
    if (path.startsWith("olt/scripts/src/")) {
      const rel = path.slice("olt/scripts/src/".length);
      testPath = `tests/${rel.replace(/\.tsx?$/, ".test.ts")}`;
    } else if (path.startsWith("src/")) {
      const rel = path.slice("src/".length);
      testPath = `tests/${rel.replace(/\.tsx?$/, ".test.ts")}`;
    } else {
      const base = basename(path, extname(path));
      const dir = dirname(path);
      testPath = join("tests", dir, `${base}.test.ts`);
    }
    testPaths.push(testPath);
  }
  return [...new Set(testPaths)];
}

export function synthesizeIntentTitle(
  category: IntentCategory,
  domain: IntentDomain,
  primarySymbols: readonly string[],
  files: readonly UncommittedFileEntry[],
  stashes: readonly { message: string }[],
  titleHint?: string,
): string {
  if (titleHint && titleHint.trim().length > 0) {
    return titleHint.trim();
  }

  for (const stash of stashes) {
    const msg = stash.message.trim();
    if (msg && !msg.startsWith("WIP on") && msg.length > 5) {
      return msg.charAt(0).toUpperCase() + msg.slice(1);
    }
  }

  const mainSymbol = primarySymbols[0];
  const fileStem = files[0] ? basename(files[0].path, extname(files[0].path)) : undefined;
  const focus = mainSymbol ?? fileStem ?? domain;

  switch (category) {
    case "FEATURE":
      return `Implement ${focus} in ${domain}`;
    case "BUG_FIX":
      return `Fix ${focus} in ${domain}`;
    case "REFACTOR":
      return `Refactor ${focus} architecture in ${domain}`;
    case "UX_POLISH":
      return `Polish UI/UX for ${focus}`;
    case "TESTING":
      return `Add automated test suites for ${focus} in ${domain}`;
    case "INFRASTRUCTURE":
      return `Update tooling and infrastructure for ${focus}`;
  }
}

export function synthesizeIntentStatement(
  title: string,
  category: IntentCategory,
  domain: IntentDomain,
  primarySymbols: readonly string[],
  filesChanged: number,
): string {
  const symbolsText =
    primarySymbols.length > 0 ? ` focused around '${primarySymbols.slice(0, 3).join("', '")}'` : "";

  switch (category) {
    case "FEATURE":
      return `As an engineer, I want to implement ${title}${symbolsText} across ${filesChanged} file(s) in the ${domain} domain so that new system capabilities are delivered without regressions.`;
    case "BUG_FIX":
      return `As an operator, I want to resolve defects in ${title}${symbolsText} in the ${domain} domain to ensure system stability and contract compliance.`;
    case "REFACTOR":
      return `As a maintainer, I want to refactor ${title}${symbolsText} in the ${domain} domain to improve modularity, type safety, and maintainability.`;
    case "UX_POLISH":
      return `As a user, I want visual and ergonomic polish in ${title}${symbolsText} to deliver a seamless user experience.`;
    case "TESTING":
      return `As a quality engineer, I want comprehensive test coverage for ${title}${symbolsText} to guarantee deterministic runtime behavior.`;
    case "INFRASTRUCTURE":
      return `As a DevOps engineer, I want to enhance build and execution infrastructure for ${title} to ensure reliable builds and workflows.`;
  }
}

export function synthesizeIntentRationale(
  snapshot: InFlightSnapshot,
  category: IntentCategory,
  domain: IntentDomain,
  primarySymbols: readonly string[],
): string {
  const lines: string[] = [
    `Ingested in-flight working state from snapshot '${snapshot.snapshotId}' on branch '${snapshot.branch}'.`,
    `Diff analysis shows ${snapshot.diffSummary.insertions} insertions, ${snapshot.diffSummary.deletions} deletions across ${snapshot.diffSummary.filesChanged} changed file(s).`,
  ];

  if (snapshot.uncommittedFiles.length > 0) {
    const untracked = snapshot.uncommittedFiles.filter((f) => f.status === "untracked").length;
    const modified = snapshot.uncommittedFiles.filter((f) => f.status === "modified").length;
    const added = snapshot.uncommittedFiles.filter((f) => f.status === "added").length;
    lines.push(
      `File breakdown: ${modified} modified, ${added} added, ${untracked} untracked file(s).`,
    );
  }

  if (primarySymbols.length > 0) {
    lines.push(`Key symbols and definitions detected: ${primarySymbols.slice(0, 6).join(", ")}.`);
  }

  if (snapshot.stashes.length > 0) {
    lines.push(`Active git stash context: "${snapshot.stashes[0]?.message ?? "stash"}".`);
  }

  lines.push(
    `Classified under domain '${domain}' with category '${category}' to ensure strict non-destructive pre-planning.`,
  );

  return lines.join(" ");
}

export function generateAcceptanceCriteria(
  domain: IntentDomain,
  category: IntentCategory,
  primarySymbols: readonly string[],
  testScope: readonly string[],
  writeScope: readonly string[],
): string[] {
  const criteria: string[] = [
    `Domain '${domain}' conformance and verified '${category}' implementation contracts.`,
    "100% clean TypeScript build with 0 `any` and 0 linter/compiler suppressions.",
  ];

  if (primarySymbols.length > 0) {
    criteria.push(
      `Deterministic symbol definitions and verified runtime contracts for: ${primarySymbols.slice(0, 4).join(", ")}.`,
    );
  }

  if (writeScope.length > 0) {
    criteria.push(
      `Strict confinement of modifications to assigned write scope (${writeScope.length} target files/patterns) preserving adjacent user edits.`,
    );
  }

  if (testScope.length > 0) {
    criteria.push(
      `Comprehensive automated test coverage in [${testScope.slice(0, 2).join(", ")}] validating all primary paths and error states.`,
    );
  } else {
    criteria.push("Automated unit and regression test suite verifying expected behavior.");
  }

  criteria.push(
    "Zero-destructive git invariant compliance (no untracked work discarded, no manual edits overwritten).",
  );

  return criteria;
}
