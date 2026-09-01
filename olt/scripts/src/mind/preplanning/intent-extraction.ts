import { createHash } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";
import type { DomainCategory, RawBacklogItem } from "./types.ts";
import type { InFlightSnapshot, UncommittedFileEntry } from "./inflight-ingestion.ts";

export type IntentDomain =
  | "UI/UX"
  | "Backend/API"
  | "Core Engine"
  | "Testing"
  | "Tooling"
  | "Docs"
  | "Architecture";

export type IntentCategory =
  | "FEATURE"
  | "BUG_FIX"
  | "REFACTOR"
  | "UX_POLISH"
  | "TESTING"
  | "INFRASTRUCTURE";

export interface UserIntentRecord {
  readonly intentId: string;
  readonly snapshotId: string;
  readonly title: string;
  readonly statement: string;
  readonly rationale: string;
  readonly category: IntentCategory;
  readonly domain: IntentDomain;
  readonly canonicalDomain: DomainCategory;
  readonly priority: "P1";
  readonly primarySymbolsAffected: readonly string[];
  readonly suggestedAcceptanceCriteria: readonly string[];
  readonly writeScope: readonly string[];
  readonly suggestedTestScope: readonly string[];
  readonly sourceFiles: readonly string[];
  readonly extractedAt: string;
  readonly confidence: number;
  readonly rawSummary: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface PriorityOneDeliverable {
  readonly deliverableId: string;
  readonly intentId: string;
  readonly title: string;
  readonly priority: "P1";
  readonly category: IntentCategory;
  readonly domain: IntentDomain;
  readonly canonicalDomain: DomainCategory;
  readonly description: string;
  readonly rationale: string;
  readonly assignedScope: readonly string[];
  readonly testScope: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly backlogItem: RawBacklogItem;
  readonly createdAt: string;
}

export type RoadmapAction = "CREATE_EXPEDITED_PLAN" | "APPEND_DELIVERABLE" | "UPDATE_CLUSTER";

export interface UserIntentRoadmapIntegration {
  readonly intent: UserIntentRecord;
  readonly deliverable: PriorityOneDeliverable;
  readonly roadmapAction: RoadmapAction;
  readonly targetPlanPath?: string | undefined;
  readonly clusterId?: string | undefined;
  readonly integratedAt: string;
  readonly notes: readonly string[];
}

export interface IntentExtractionOptions {
  readonly explicitDomain?: IntentDomain | undefined;
  readonly explicitCategory?: IntentCategory | undefined;
  readonly titleHint?: string | undefined;
  readonly contextDescription?: string | undefined;
  readonly customMetadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface BacklogOptions {
  readonly planPathPrefix?: string | undefined;
  readonly createdTimestamp?: string | undefined;
  readonly tags?: readonly string[] | undefined;
}

export function toCanonicalDomainCategory(domain: IntentDomain): DomainCategory {
  switch (domain) {
    case "UI/UX":
      return "reporting";
    case "Backend/API":
      return "engine";
    case "Core Engine":
      return "engine";
    case "Testing":
      return "validation";
    case "Tooling":
      return "tooling";
    case "Docs":
      return "reporting";
    case "Architecture":
      return "core";
  }
}

function computeSha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function extractSymbolsFromText(text: string): string[] {
  const symbols = new Set<string>();

  // Function / async function definitions
  const fnRegex = /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g;
  let match: RegExpExecArray | null;
  while ((match = fnRegex.exec(text)) !== null) {
    if (match[1] && match[1].length > 1) symbols.add(match[1]);
  }

  // Class definitions
  const classRegex = /\b(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/g;
  while ((match = classRegex.exec(text)) !== null) {
    if (match[1] && match[1].length > 1) symbols.add(match[1]);
  }

  // Interface definitions
  const interfaceRegex = /\b(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/g;
  while ((match = interfaceRegex.exec(text)) !== null) {
    if (match[1] && match[1].length > 1) symbols.add(match[1]);
  }

  // Type definitions
  const typeRegex = /\b(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/g;
  while ((match = typeRegex.exec(text)) !== null) {
    if (match[1] && match[1].length > 1) symbols.add(match[1]);
  }

  // Enum definitions
  const enumRegex = /\b(?:export\s+)?enum\s+([A-Za-z0-9_$]+)/g;
  while ((match = enumRegex.exec(text)) !== null) {
    if (match[1] && match[1].length > 1) symbols.add(match[1]);
  }

  // Exported constants / const declarations
  const constRegex = /\bexport\s+const\s+([A-Za-z0-9_$]+)/g;
  while ((match = constRegex.exec(text)) !== null) {
    if (match[1] && match[1].length > 1) symbols.add(match[1]);
  }

  // Test suites / descriptions
  const testRegex = /\b(?:describe|test|it)\s*\(\s*["'`Batch]([^"'`\n]+)["'`]/g;
  while ((match = testRegex.exec(text)) !== null) {
    if (match[1] && match[1].trim().length > 2) symbols.add(match[1].trim());
  }

  return Array.from(symbols);
}

function classifyDomainFromFiles(
  files: readonly UncommittedFileEntry[],
  diffText: string,
): { domain: IntentDomain; score: number } {
  const scores: Record<IntentDomain, number> = {
    "UI/UX": 0,
    "Backend/API": 0,
    "Core Engine": 0,
    Testing: 0,
    Tooling: 0,
    Docs: 0,
    Architecture: 0,
  };

  for (const file of files) {
    const pathLower = file.path.toLowerCase();
    const ext = extname(pathLower);
    const weight = file.status === "added" || file.status === "untracked" ? 3 : 2;

    // Testing
    if (
      pathLower.includes("test") ||
      pathLower.includes("spec") ||
      pathLower.includes("__tests__") ||
      ext === ".test.ts" ||
      ext === ".spec.ts"
    ) {
      scores["Testing"] += 5 * weight;
    }

    // Docs
    if (
      pathLower.startsWith("docs/") ||
      pathLower.includes("/docs/") ||
      ext === ".md" ||
      ext === ".mdx" ||
      pathLower.includes("readme") ||
      pathLower.includes("changelog")
    ) {
      scores["Docs"] += 4 * weight;
    }

    // UI/UX
    if (
      pathLower.includes("ui/") ||
      pathLower.includes("view") ||
      pathLower.includes("component") ||
      pathLower.includes("frontend") ||
      pathLower.includes("theme") ||
      pathLower.includes("style") ||
      ext === ".tsx" ||
      ext === ".jsx" ||
      ext === ".css" ||
      ext === ".scss" ||
      ext === ".html"
    ) {
      scores["UI/UX"] += 4 * weight;
    }

    // Backend/API
    if (
      pathLower.includes("server") ||
      pathLower.includes("api") ||
      pathLower.includes("routes") ||
      pathLower.includes("endpoint") ||
      pathLower.includes("http") ||
      pathLower.includes("rpc") ||
      pathLower.includes("controller") ||
      pathLower.includes("handler")
    ) {
      scores["Backend/API"] += 3 * weight;
    }

    // Tooling
    if (
      pathLower.includes("scripts/") ||
      pathLower.includes("tool") ||
      pathLower.includes("cli") ||
      pathLower.includes("bin/") ||
      pathLower.includes("package.json") ||
      pathLower.includes("tsconfig") ||
      pathLower.includes("docker")
    ) {
      scores["Tooling"] += 3 * weight;
    }

    // Architecture
    if (
      pathLower.includes("contracts") ||
      pathLower.includes("types.ts") ||
      pathLower.includes("schema") ||
      pathLower.includes("manifest") ||
      pathLower.includes("authority") ||
      pathLower.includes("governance") ||
      pathLower.includes("pillars")
    ) {
      scores["Architecture"] += 4 * weight;
    }

    // Core Engine
    if (
      pathLower.includes("engine") ||
      pathLower.includes("core") ||
      pathLower.includes("kernel") ||
      pathLower.includes("workflow") ||
      pathLower.includes("task") ||
      pathLower.includes("orchestrator") ||
      pathLower.includes("mind") ||
      pathLower.includes("memory") ||
      pathLower.includes("state")
    ) {
      scores["Core Engine"] += 3 * weight;
    }
  }

  // Inspect diff content for domain indicators
  const diffLower = diffText.toLowerCase();
  if (
    /\b(?:react|usestate|useeffect|render|html|css|component|modal|dialog|button)\b/.test(diffLower)
  ) {
    scores["UI/UX"] += 4;
  }
  if (
    /\b(?:request|response|router|endpoint|statuscode|headers|bearer|json\(|fetch\()\b/.test(
      diffLower,
    )
  ) {
    scores["Backend/API"] += 4;
  }
  if (/\b(?:describe|expect\(|it\(|assert|testsuite|mock|fixture)\b/.test(diffLower)) {
    scores["Testing"] += 5;
  }
  if (/\b(?:spawn|child_process|argv|cli|flag|parser|compiler|bundle|esbuild)\b/.test(diffLower)) {
    scores["Tooling"] += 3;
  }
  if (/\b(?:interface\s+[A-Z]|type\s+[A-Z]|invariant|governance|authority)\b/.test(diffLower)) {
    scores["Architecture"] += 4;
  }

  let bestDomain: IntentDomain = "Core Engine";
  let maxScore = -1;

  for (const [dom, score] of Object.entries(scores) as Array<[IntentDomain, number]>) {
    if (score > maxScore) {
      maxScore = score;
      bestDomain = dom;
    }
  }

  return { domain: bestDomain, score: Math.max(1, maxScore) };
}

function classifyCategoryFromSnapshot(
  snapshot: InFlightSnapshot,
  primaryDomain: IntentDomain,
): { category: IntentCategory; confidence: number } {
  const scores: Record<IntentCategory, number> = {
    FEATURE: 0,
    BUG_FIX: 0,
    REFACTOR: 0,
    UX_POLISH: 0,
    TESTING: 0,
    INFRASTRUCTURE: 0,
  };

  const diffLower = snapshot.rawDiff.toLowerCase();
  const stashMessages = snapshot.stashes.map((s) => s.message.toLowerCase()).join(" ");

  // Stash message analysis
  if (/\b(?:fix|bug|defect|issue|patch|remedy|resolve|crash|error)\b/.test(stashMessages)) {
    scores.BUG_FIX += 8;
  }
  if (/\b(?:feat|feature|add|implement|introduce|support|new)\b/.test(stashMessages)) {
    scores.FEATURE += 8;
  }
  if (/\b(?:refactor|clean|simplify|decompose|reorganize|rename|move)\b/.test(stashMessages)) {
    scores.REFACTOR += 8;
  }
  if (/\b(?:polish|style|ux|ui|theme|cosmetic|align)\b/.test(stashMessages)) {
    scores.UX_POLISH += 8;
  }
  if (/\b(?:test|spec|coverage|assert)\b/.test(stashMessages)) {
    scores.TESTING += 8;
  }
  if (/\b(?:ci|cd|docker|infra|build|workflow|deps|config)\b/.test(stashMessages)) {
    scores.INFRASTRUCTURE += 8;
  }

  // Diff content analysis
  if (
    /\b(?:fix(?:es|ed)?|bug|error|throw new HarnessError|catch\s*\(|fallback|null check|undefined check)\b/.test(
      diffLower,
    )
  ) {
    scores.BUG_FIX += 4;
  }
  if (
    /\b(?:export\s+function|export\s+class|export\s+interface|export\s+type|new\s+[A-Z])\b/.test(
      snapshot.rawDiff,
    )
  ) {
    scores.FEATURE += 5;
  }
  if (/\b(?:expect\(|test\(|it\(|describe\()\b/.test(diffLower)) {
    scores.TESTING += 5;
  }
  if (primaryDomain === "Testing") {
    scores.TESTING += 8;
  }
  if (
    primaryDomain === "UI/UX" &&
    snapshot.diffSummary.insertions < 40 &&
    snapshot.diffSummary.deletions < 20
  ) {
    scores.UX_POLISH += 4;
  }

  // File structure heuristics
  const hasAddedOrUntracked = snapshot.uncommittedFiles.some(
    (f) => f.status === "added" || f.status === "untracked",
  );
  if (hasAddedOrUntracked) {
    scores.FEATURE += 6;
  }

  const infraFileCount = snapshot.uncommittedFiles.filter(
    (f) =>
      f.path.includes("package.json") ||
      f.path.includes("tsconfig") ||
      f.path.includes("docker") ||
      f.path.includes(".github/") ||
      f.path.includes("biome.json"),
  ).length;

  if (infraFileCount > 0 && infraFileCount === snapshot.uncommittedFiles.length) {
    scores.INFRASTRUCTURE += 10;
  }

  if (
    snapshot.diffSummary.insertions > 0 &&
    snapshot.diffSummary.deletions > 0 &&
    !hasAddedOrUntracked
  ) {
    scores.REFACTOR += 3;
  }

  let bestCategory: IntentCategory = "FEATURE";
  let maxScore = -1;
  let totalScore = 0;

  for (const [cat, score] of Object.entries(scores) as Array<[IntentCategory, number]>) {
    totalScore += score;
    if (score > maxScore) {
      maxScore = score;
      bestCategory = cat;
    }
  }

  const confidence =
    totalScore > 0 ? Math.min(1, Math.max(0.6, Number((maxScore / totalScore).toFixed(2)))) : 0.75;
  return { category: bestCategory, confidence };
}

function deriveTestScopeFromWriteScope(writeScope: readonly string[]): string[] {
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

function synthesizeIntentTitle(
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

  // Check if there is an informative stash message
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

function synthesizeIntentStatement(
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

function synthesizeIntentRationale(
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

function generateAcceptanceCriteria(
  domain: IntentDomain,
  category: IntentCategory,
  primarySymbols: readonly string[],
  testScope: readonly string[],
  writeScope: readonly string[],
): string[] {
  const criteria: string[] = [
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

export class UserIntentExtractionEngine {
  public extractIntent(
    snapshot: InFlightSnapshot,
    options?: IntentExtractionOptions,
  ): UserIntentRecord {
    const extractedAt = new Date().toISOString();

    // Extract symbols from diff and untracked file contents
    const symbolsFromDiff = extractSymbolsFromText(snapshot.rawDiff);
    const symbolsFromUntracked: string[] = [];
    for (const content of Object.values(snapshot.untrackedFileContents)) {
      symbolsFromUntracked.push(...extractSymbolsFromText(content));
    }
    const primarySymbolsAffected = [...new Set([...symbolsFromDiff, ...symbolsFromUntracked])];

    // Classify domain and category
    const domainClassification = classifyDomainFromFiles(
      snapshot.uncommittedFiles,
      snapshot.rawDiff,
    );
    const domain =
      options?.explicitDomain !== undefined ? options.explicitDomain : domainClassification.domain;
    const canonicalDomain = toCanonicalDomainCategory(domain);

    const categoryClassification = classifyCategoryFromSnapshot(snapshot, domain);
    const category =
      options?.explicitCategory !== undefined
        ? options.explicitCategory
        : categoryClassification.category;

    const sourceFiles = snapshot.uncommittedFiles.map((f) => f.path);
    const writeScope = sourceFiles.filter((p) => !p.includes(".test.") && !p.includes(".spec."));
    const effectiveWriteScope = writeScope.length > 0 ? writeScope : sourceFiles;
    const suggestedTestScope = deriveTestScopeFromWriteScope(effectiveWriteScope);

    const title = synthesizeIntentTitle(
      category,
      domain,
      primarySymbolsAffected,
      snapshot.uncommittedFiles,
      snapshot.stashes,
      options?.titleHint,
    );

    const statement = synthesizeIntentStatement(
      title,
      category,
      domain,
      primarySymbolsAffected,
      snapshot.diffSummary.filesChanged || snapshot.uncommittedFiles.length,
    );

    const rationale =
      options?.contextDescription !== undefined
        ? `${options.contextDescription} — ${synthesizeIntentRationale(snapshot, category, domain, primarySymbolsAffected)}`
        : synthesizeIntentRationale(snapshot, category, domain, primarySymbolsAffected);

    const suggestedAcceptanceCriteria = generateAcceptanceCriteria(
      domain,
      category,
      primarySymbolsAffected,
      suggestedTestScope,
      effectiveWriteScope,
    );

    const hashInput = `${snapshot.snapshotId}|${domain}|${category}|${title}|${sourceFiles.join(",")}`;
    const intentHash = computeSha256(hashInput).slice(0, 8);
    const intentId = `intent_${extractedAt.replace(/[-:TZ.]/g, "").slice(0, 15)}_${intentHash}`;

    const rawSummary = [
      `[INTENT] ${title} (${category} in ${domain}) [PRIORITY 1]`,
      `Statement: ${statement}`,
      `Files: ${sourceFiles.join(", ") || "none"}`,
      `Symbols: ${primarySymbolsAffected.join(", ") || "none"}`,
    ].join("\n");

    return {
      intentId,
      snapshotId: snapshot.snapshotId,
      title,
      statement,
      rationale,
      category,
      domain,
      canonicalDomain,
      priority: "P1",
      primarySymbolsAffected,
      suggestedAcceptanceCriteria,
      writeScope: effectiveWriteScope,
      suggestedTestScope,
      sourceFiles,
      extractedAt,
      confidence: categoryClassification.confidence,
      rawSummary,
      ...(options?.customMetadata !== undefined ? { metadata: options.customMetadata } : {}),
    };
  }

  public structureAsBacklogDeliverable(
    intent: UserIntentRecord,
    options?: BacklogOptions,
  ): PriorityOneDeliverable {
    const createdAt = options?.createdTimestamp ?? new Date().toISOString();
    const cleanId = intent.intentId.replace(/[^a-zA-Z0-9_-]/g, "");
    const deliverableId = `deliv_p1_${cleanId.slice(0, 20)}`;

    const content = [
      `## User Intent: ${intent.title}`,
      "",
      `**Statement:** ${intent.statement}`,
      "",
      `**Rationale:** ${intent.rationale}`,
      "",
      "### Acceptance Criteria",
      ...intent.suggestedAcceptanceCriteria.map((c) => `- ${c}`),
      "",
      "### Target Scope",
      `- **Write Scope:** \`${intent.writeScope.join("`, `") || "workspace"}\``,
      `- **Test Scope:** \`${intent.suggestedTestScope.join("`, `") || "none"}\``,
      `- **Primary Symbols:** \`${intent.primarySymbolsAffected.join("`, `") || "none"}\``,
    ].join("\n");

    const backlogItem: RawBacklogItem = {
      id: deliverableId,
      title: intent.title,
      content,
      priority: "P1",
      status: "PENDING",
      category: intent.category,
      domain: intent.canonicalDomain,
      created_at: createdAt,
      timestamp: createdAt,
      plan_path: null,
      intent_id: intent.intentId,
      snapshot_id: intent.snapshotId,
      write_scope: intent.writeScope,
      test_scope: intent.suggestedTestScope,
      ...(options?.tags !== undefined ? { tags: options.tags } : {}),
    };

    return {
      deliverableId,
      intentId: intent.intentId,
      title: intent.title,
      priority: "P1",
      category: intent.category,
      domain: intent.domain,
      canonicalDomain: intent.canonicalDomain,
      description: intent.statement,
      rationale: intent.rationale,
      assignedScope: intent.writeScope,
      testScope: intent.suggestedTestScope,
      acceptanceCriteria: intent.suggestedAcceptanceCriteria,
      backlogItem,
      createdAt,
    };
  }

  public integrateIntoRoadmap(
    intent: UserIntentRecord,
    roadmap?: unknown,
  ): UserIntentRoadmapIntegration {
    const deliverable = this.structureAsBacklogDeliverable(intent);
    const integratedAt = new Date().toISOString();
    const notes: string[] = [];

    const domainSlug = intent.domain
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const shortId = intent.intentId.slice(-8);
    const planFilename = `plan-p1-${domainSlug}-${shortId}.md`;
    const targetPlanPath = join("plans", planFilename);

    let roadmapAction: RoadmapAction = "CREATE_EXPEDITED_PLAN";
    let clusterId: string | undefined;

    if (roadmap && typeof roadmap === "object") {
      const roadmapObj = roadmap as Record<string, unknown>;
      if (Array.isArray(roadmapObj.clusters) && roadmapObj.clusters.length > 0) {
        const matchingCluster = roadmapObj.clusters.find(
          (c) =>
            typeof c === "object" &&
            c !== null &&
            "domain" in c &&
            c.domain === intent.canonicalDomain,
        ) as { cluster_id?: string; plan_path?: string } | undefined;

        if (matchingCluster?.cluster_id) {
          clusterId = matchingCluster.cluster_id;
          roadmapAction = "UPDATE_CLUSTER";
          notes.push(
            `Matched existing domain cluster '${clusterId}' for domain '${intent.domain}'.`,
          );
        } else {
          roadmapAction = "APPEND_DELIVERABLE";
          notes.push(
            `Appended Priority 1 deliverable to backlog under canonical domain '${intent.canonicalDomain}'.`,
          );
        }
      }
    }

    if (roadmapAction === "CREATE_EXPEDITED_PLAN") {
      notes.push(
        `Designated for expedited P1 planning blueprint at '${targetPlanPath}'. Highest priority scheduling.`,
      );
    }

    return {
      intent,
      deliverable,
      roadmapAction,
      targetPlanPath,
      ...(clusterId !== undefined ? { clusterId } : {}),
      integratedAt,
      notes,
    };
  }
}

export function extractUserIntent(
  snapshot: InFlightSnapshot,
  options?: IntentExtractionOptions,
): UserIntentRecord {
  const engine = new UserIntentExtractionEngine();
  return engine.extractIntent(snapshot, options);
}

export function structureUserIntentAsBacklogDeliverable(
  intent: UserIntentRecord,
  options?: BacklogOptions,
): PriorityOneDeliverable {
  const engine = new UserIntentExtractionEngine();
  return engine.structureAsBacklogDeliverable(intent, options);
}

export function integrateUserIntentIntoRoadmap(
  intent: UserIntentRecord,
  roadmap?: unknown,
): UserIntentRoadmapIntegration {
  const engine = new UserIntentExtractionEngine();
  return engine.integrateIntoRoadmap(intent, roadmap);
}
