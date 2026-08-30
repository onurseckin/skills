import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { verifyEventsHashChain } from "./hash-chain.ts";
import { inspectCommandReceipts, inspectMilestoneEvents } from "./receipt-inspector.ts";
import type { MilestoneEvidenceVerification } from "./types.ts";

export function verifyMilestoneEvidence(
  capsulePath: string,
  milestone: string,
): MilestoneEvidenceVerification {
  let eventsFilePath = join(capsulePath, "events.jsonl");
  let stateFilePath = join(capsulePath, "state.json");

  if (existsSync(capsulePath) && lstatSync(capsulePath).isFile()) {
    eventsFilePath = capsulePath;
    stateFilePath = join(dirname(capsulePath), "state.json");
  }

  let stateObj: Record<string, unknown> | undefined;
  if (existsSync(stateFilePath)) {
    try {
      const rawState = readFileSync(stateFilePath, "utf-8");
      const parsed = JSON.parse(rawState);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        stateObj = parsed as Record<string, unknown>;
      }
    } catch {}
  }

  const { verification: hashChain, events } = verifyEventsHashChain(eventsFilePath);
  const observedEvents = inspectMilestoneEvents(events);
  const commandReceipts = inspectCommandReceipts(events, stateObj);

  const errors: string[] = [];
  const missingEvents: string[] = [];
  const requiredEvents: string[] = [];

  if (!hashChain.valid) {
    errors.push(hashChain.error ?? "Event hash chain is invalid or broken.");
  }

  const normalizedMilestone = milestone.toLowerCase().trim();

  if (normalizedMilestone === "ignition" || normalizedMilestone === "mind-init") {
    const hasInit = observedEvents.has("mind-initialized") || observedEvents.has("run-initialized");
    if (!hasInit) {
      missingEvents.push("mind-initialized");
      errors.push(`Milestone '${milestone}' failed: missing required event 'mind-initialized'.`);
    } else {
      requiredEvents.push(
        observedEvents.has("mind-initialized") ? "mind-initialized" : "run-initialized",
      );
    }

    const hasWakeOrPulse =
      observedEvents.has("mind-woken") ||
      observedEvents.has("mind-pulse-opened") ||
      observedEvents.has("mind-pulse") ||
      observedEvents.has("plan-brainstormed") ||
      observedEvents.has("task-dispatched") ||
      observedEvents.has("task-claimed");

    if (hashChain.totalEvents <= 1 && commandReceipts.length === 0 && !hasWakeOrPulse) {
      errors.push(
        `Milestone '${milestone}' failed: sequence is stuck at 1 with 0 command receipts.`,
      );
    }
  } else if (normalizedMilestone === "pulse") {
    const hasPulseEvent =
      observedEvents.has("mind-pulse-opened") ||
      observedEvents.has("mind-pulse") ||
      observedEvents.has("mind-initialized");

    if (!hasPulseEvent && hashChain.totalEvents > 0) {
      missingEvents.push("mind-pulse-opened");
      errors.push(`Milestone '${milestone}' failed: missing pulse event.`);
    }

    if (hashChain.totalEvents === 0) {
      errors.push(`Milestone '${milestone}' failed: event sequence is empty.`);
    }
  } else if (normalizedMilestone === "execution" || normalizedMilestone === "task") {
    if (commandReceipts.length === 0) {
      errors.push(`Milestone '${milestone}' failed: sequence has 0 command receipts.`);
    }
  } else if (normalizedMilestone.length > 0 && !observedEvents.has(milestone)) {
    if (hashChain.totalEvents <= 1 && commandReceipts.length === 0) {
      errors.push(
        `Milestone '${milestone}' failed: sequence is stuck at 1 with 0 command receipts.`,
      );
    }
  }

  const failedReceipts = commandReceipts.filter((receipt) => receipt.exitCode !== 0);
  if (failedReceipts.length > 0) {
    const details = failedReceipts.map((r) => `${r.command} (exit code: ${r.exitCode})`).join(", ");
    errors.push(
      `Milestone '${milestone}' failed: ${failedReceipts.length} command receipt(s) executed with non-zero exit code: ${details}`,
    );
  }

  const certified =
    errors.length === 0 &&
    hashChain.valid &&
    missingEvents.length === 0 &&
    failedReceipts.length === 0;

  const summary = certified
    ? `Milestone '${milestone}' certified: SHA-256 hash chain intact (${hashChain.totalEvents} events), ${commandReceipts.length} command receipt(s) verified with exit code 0.`
    : `Milestone '${milestone}' certification rejected: ${errors.join("; ")}`;

  return {
    certified,
    milestone,
    capsulePath,
    hashChain,
    commandReceipts,
    requiredEvents,
    missingEvents,
    failedReceipts,
    errors,
    summary,
  };
}
