// @ts-nocheck
import { createHash } from "node:crypto";
import { HarnessError } from "../../core/errors/index.ts";
import type {
  CompositeArtifactKey,
  EvidenceTier,
  ArtifactMetadata,
  EvidenceStorageStats,
} from "./types.ts";
import { CompositeKeyParser } from "./composite-key-parser.ts";
export class LifecycleManager {
  private readonly artifacts = new Map<string, ArtifactMetadata>();
  private currentRound: number = 1;
  private tier3PrunedCount: number = 0;
  private tier3PrunedSizeBytes: number = 0;

  public constructor(initialRound: number = 1) {
    this.currentRound = initialRound;
  }

  public getCurrentRound(): number {
    return this.currentRound;
  }

  /**
   * Registers a new artifact into the lifecycle manager
   */
  public registerArtifact(artifact: ArtifactMetadata): void {
    if (!artifact || !artifact.keyString) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        "Artifact must have a valid keyString",
      );
    }
    this.artifacts.set(artifact.keyString, { ...artifact });
  }

  /**
   * Retrieves an artifact by its keyString
   */
  public getArtifact(keyString: string): ArtifactMetadata | undefined {
    return this.artifacts.get(keyString);
  }

  /**
   * Lists all artifacts, optionally filtered by tier
   */
  public listArtifacts(tier?: EvidenceTier): readonly ArtifactMetadata[] {
    const list = Array.from(this.artifacts.values());
    if (tier !== undefined) {
      return list.filter((a) => a.tier === tier);
    }
    return list;
  }

  /**
   * Promotes an artifact to Tier 2 Milestone Anchor
   */
  public promoteToMilestoneAnchor(keyString: string): ArtifactMetadata {
    const artifact = this.artifacts.get(keyString);
    if (!artifact) {
      throw new HarnessError(
        "NOT_FOUND",
        `Artifact '${keyString}' not found for milestone promotion`,
      );
    }

    const updated: ArtifactMetadata = {
      ...artifact,
      tier: 2,
      isMilestoneAnchor: true,
    };
    this.artifacts.set(keyString, updated);
    return updated;
  }

  /**
   * Advances the current round and automatically prunes superseded intermediate artifacts (Tier 3)
   */
  public advanceRound(newRound: number): {
    prunedKeys: readonly string[];
    retainedKeys: readonly string[];
    stats: EvidenceStorageStats;
  } {
    if (newRound <= this.currentRound) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `New round (${newRound}) must be strictly greater than current round (${this.currentRound})`,
      );
    }

    this.currentRound = newRound;
    const prunedKeys: string[] = [];
    const retainedKeys: string[] = [];

    // Active rounds: newRound (current) and newRound - 1 (immediate previous)
    // Older rounds: <= newRound - 2
    for (const [keyString, artifact] of Array.from(this.artifacts.entries())) {
      if (artifact.isMilestoneAnchor || artifact.tier === 2) {
        retainedKeys.push(keyString);
        continue;
      }

      if (artifact.key.round <= newRound - 2) {
        // Prune intermediate superseded artifact
        this.tier3PrunedCount++;
        this.tier3PrunedSizeBytes += artifact.sizeBytes;
        prunedKeys.push(keyString);
        this.artifacts.delete(keyString);
      } else {
        // Retain in Tier 1
        retainedKeys.push(keyString);
      }
    }

    return {
      prunedKeys,
      retainedKeys,
      stats: this.getStorageStats(),
    };
  }

  /**
   * Returns complete storage statistics across all tiers
   */
  public getStorageStats(): EvidenceStorageStats {
    let tier1Count = 0;
    let tier1SizeBytes = 0;
    let tier2Count = 0;
    let tier2SizeBytes = 0;

    for (const artifact of this.artifacts.values()) {
      if (artifact.tier === 2 || artifact.isMilestoneAnchor) {
        tier2Count++;
        tier2SizeBytes += artifact.sizeBytes;
      } else {
        tier1Count++;
        tier1SizeBytes += artifact.sizeBytes;
      }
    }

    return {
      tier1Count,
      tier1SizeBytes,
      tier2Count,
      tier2SizeBytes,
      tier3PrunedCount: this.tier3PrunedCount,
      tier3PrunedSizeBytes: this.tier3PrunedSizeBytes,
      totalActiveCount: tier1Count + tier2Count,
      totalActiveSizeBytes: tier1SizeBytes + tier2SizeBytes,
    };
  }
}

// ============================================================================
// 4. Perceptual Difference Heatmaps & Lightweight Visual Delta Reporting
// ============================================================================

