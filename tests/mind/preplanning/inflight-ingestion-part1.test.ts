import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  InFlightIngestionEngine,
  UserIntentExtractionEngine,
  createInFlightSnapshot,
  extractUserIntent,
  inspectInFlightWork,
  integrateUserIntentIntoRoadmap,
  listInFlightSnapshots,
  loadInFlightSnapshot,
  parseDiffSummary,
  parseGitStashes,
  parseGitStatusOutput,
  saveInFlightSnapshot,
  structureUserIntentAsBacklogDeliverable,
  toCanonicalDomainCategory,
  type GitRunner,
  type InFlightSnapshot,
  type InFlightSnapshotOptions,
  type IntentCategory,
  type IntentDomain,
  type SaveSnapshotOptions,
} from "../../../olt/scripts/src/mind/preplanning/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
