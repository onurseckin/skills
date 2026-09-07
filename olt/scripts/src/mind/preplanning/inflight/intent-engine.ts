import { join } from "node:path";
import type { RawBacklogItem } from "../index.ts";
import type { InFlightSnapshot } from "./inflight-types.ts";
import {
  type BacklogOptions,
  type IntentExtractionOptions,
  type PriorityOneDeliverable,
  type RoadmapAction,
  type UserIntentRecord,
  type UserIntentRoadmapIntegration,
  toCanonicalDomainCategory,
} from "./intent-types.ts";
import {
  classifyCategoryFromSnapshot,
  classifyDomainFromFiles,
  computeSha256,
  extractSymbolsFromText,
} from "./intent-classifier.ts";
import {
  deriveTestScopeFromWriteScope,
  generateAcceptanceCriteria,
  synthesizeIntentRationale,
  synthesizeIntentStatement,
  synthesizeIntentTitle,
} from "./intent-synthesizer.ts";

export class UserIntentExtractionEngine {
  public extractIntent(
    snapshot: InFlightSnapshot,
    options?: IntentExtractionOptions,
  ): UserIntentRecord {
    const extractedAt = new Date().toISOString();

    const symbolsFromDiff = extractSymbolsFromText(snapshot.rawDiff);
    const symbolsFromUntracked: string[] = [];
    for (const content of Object.values(snapshot.untrackedFileContents)) {
      symbolsFromUntracked.push(...extractSymbolsFromText(content));
    }
    const primarySymbolsAffected = [...new Set([...symbolsFromDiff, ...symbolsFromUntracked])];

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
