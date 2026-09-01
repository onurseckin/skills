/**
 * Comprehensive Test Suite for 3-Tier Hierarchical Semantic Memory Engine.
 *
 * Covers:
 * 1. Tier 1 Core Bedrock Invariants (Permanent System Axioms, Settled Pareto, immutability, zero decay, zero compaction, rejection of mutations).
 * 2. Tier 2 Active Strategic Working Memory (Operational Horizon, rolling milestone completions, prioritization, pruning & compaction).
 * 3. Tier 3 Archived Episodic Epics (Compaction abstracts, epistemic status, temporal lineage pointers).
 * 4. Settled Pareto Resolution Promotion (Tier 2 -> Tier 1 Bedrock Invariant with bidirectional lineage links).
 * 5. Pruning & Compaction Engine (age-based, status-based, expiration-based, dry run mode, zero decay guarantee on Tier 1).
 * 6. Snapshot Persistence & Restoration Roundtrips (JSON serialization, state restoration, independent instance isolation).
 */

import { describe, expect, it } from "bun:test";
import {
  type AddArchivedEpicOptions,
  type AddBedrockInvariantOptions,
  type AddWorkingMemoryEntryOptions,
  type BedrockInvariant,
  type BedrockInvariantCategory,
  type CompactAndArchiveEpicOptions,
  type PromoteParetoOptions,
  type PruneWorkingMemoryOptions,
  type ThreeTierMemorySnapshot,
  type WorkingMemoryCategory,
  type WorkingMemoryEntry,
  type WorkingMemoryStatus,
  SupersessionIndex,
  ThreeTierMemoryEngine,
} from "../../../../../olt/scripts/src/mind/memory/index.ts";
