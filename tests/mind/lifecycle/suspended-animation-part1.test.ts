/**
 * Dedicated Test Suite for Autonomous Resource Governor & Suspended Animation Protocol.
 *
 * Covers:
 * 1. ResourceGovernor Pure Functions & Bounds (calculateUtilizationRatio, calculateRemainingHeadroom, isStateStricter).
 * 2. ResourceGovernor Quota & State Transitions (NOMINAL -> WARNING -> EXHAUSTED -> HIBERNATING -> RECOVERING).
 * 3. HTTP 429 Rate Limit Throttle Handling (recordExternalThrottle, retryAfterMs, recovery estimation).
 * 4. Concurrency Management & canDispatch checks (RPM, TPM, Concurrency headroom & wait times).
 * 5. Deterministic Serialization & SHA-256 Checksum Integrity (canonicalJsonStringify, computeSnapshotChecksum, verifySnapshotIntegrity).
 * 6. Task DAG Acyclicity & Circular Dependency Detection (validateTaskDagAcyclicity).
 * 7. Auto-Wake Exponential Backoff with Jitter (computeExponentialBackoffDelay, AutoWakeProber).
 * 8. Suspended Animation Engine & Non-Destructive Freezing (Pausable tasks, sub-second timer freezing, Socratic memory).
 * 9. Lossless State Restoration (Zero context loss, zero amnesia, checkpoint resumption, snapshot archiving/cleanup).
 */

import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AutoWakeProbeConfig,
  type ExternalThrottleEvent,
  type FrozenTimer,
  type GovernorStatus,
  type PausableTask,
  type ResourceGovernorOptions,
  type ResourceGovernorState,
  type ResourceHeadroom,
  type ResourceType,
  type RestorationResult,
  type SuspendedAnimationSnapshot,
  type SuspendedTaskNode,
  AutoWakeProber,
  ResourceGovernor,
  SuspendedAnimationEngine,
  archiveSnapshotFile,
  calculateRemainingHeadroom,
  calculateUtilizationRatio,
  canonicalJsonStringify,
  cleanupSnapshotFile,
  computeExponentialBackoffDelay,
  computeSnapshotChecksum,
  createResourceGovernor,
  createSuspendedAnimationEngine,
  isStateStricter,
  readSnapshotFromDisk,
  validateTaskDagAcyclicity,
  verifySnapshotIntegrity,
  writeSnapshotToDisk,
} from "../../../olt/scripts/src/mind/lifecycle/index.ts";


