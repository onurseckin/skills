/**
 * @file conversational-engagement-protocols.test.ts
 * Conversational Engagement Protocols & Active Swarm Audit Integration Test Suite.
 *
 * Validates:
 * 1. Mandatory 3-Round (6-Turn) Socratic Conversational Laddering:
 *    - Round 1 (Turn 1 & 2): Strategic Intent & Horizon Audit.
 *    - Round 2 (Turn 3 & 4): Adversarial Reality & Quality Challenge.
 *    - Round 3 (Turn 5 & 6): Evolutionary Frontier & Concrete Milestone Lock.
 *    - Enforces minimum 6 turns before audit conclusion; rejects canned templates & single-turn notifications.
 * 2. Active Swarm Tailored 1-on-1 Conversational Audits (Skill Auditor):
 *    - Dynamic agent discovery across Orchestrators, Coordinators, Implementers, Validators.
 *    - Four core interrogation inquiries:
 *      1. Atomic task clarity & verification standards.
 *      2. Capability boundaries (Zero supervisor code edits, zero validator test runs).
 *      3. Forward momentum evidence (File-scoped tests, UI layout renders, artifact writes).
 *      4. Self-reflection & blocker disclosure.
 *    - Evaluation: momentum confirmation & invariant re-anchoring.
 * 3. Three-Strike Mechanical Containment & Capability Revocation:
 *    - Strike 1: HALT_AND_DELEGATE (intercepts supervisor attempting direct code edits or tool invocation, issues violation, forces delegation to implementer).
 *    - Strike 2: CAPABILITY_REVOCATION (hard tool stripping of write_to_file, replace_file_content, run_command).
 *    - Strike 3: PERSONA_RESPAWN (terminates rogue agent, sanitizes state, spawns fresh compliant persona).
 *    - Validator Zero Test Execution Invariant: intercepts validator trying to run test runner commands directly.
 * 4. Zero Main Thread Pollution Guarantee for Conversational Audits:
 *    - Mailbox IPC only (.olt/mailboxes/<agentId>).
 *    - Zero console / stdout spam.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  advanceMailboxCursorBatch,
  dispatchPeerMessage,
  ensureMailboxDir,
  loadMailboxCursor,
  readUnreadMessages,
  type MailboxEnvelope,
} from "../../../../olt/scripts/src/communication/mailbox/index.ts";
import {
  DIALECTICAL_LEVELS,
  HistoricalDebateMemory,
  PARETO_PRIORITY_LEVELS,
  SocraticLadderingEngine,
  type StrategicCommitment,
} from "../../../../olt/scripts/src/mind/auditing/socratic/index.ts";
import {
  DEFAULT_REVOKED_TOOLS,
  MechanicalContainmentEngine,
  type ContainmentResult,
  type SupervisoryViolation,
} from "../../../../olt/scripts/src/mind/containment/index.ts";
