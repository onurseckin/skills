import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JsonObject, JsonValue } from "../contracts/json.ts";
import { isJsonObject } from "../contracts/json.ts";
import type { AgentRole, CapsuleMemoryPointer } from "../contracts/packets.ts";
import { HarnessError } from "../errors/harness-error.ts";
import type { BuiltPacket } from "./types.ts";
import {
  VALIDATOR_EXCLUSIONS,
  isolateValidatorContext,
  sanitizeLeanContext,
} from "./validator-context.ts";

export const CAPSULE_DIRECTORIES = [
  "blobs",
  "commands",
  "evidence",
  "packets",
  "planning",
  "reports",
  "runtime",
] as const;

export type CapsuleDirectory = (typeof CAPSULE_DIRECTORIES)[number];

export const CAPSULE_FILES = [
  "captures.json",
  "events.jsonl",
  "handoff.md",
  "index.json",
  "manifest.json",
  "prompt.md",
  "state.json",
  "trace.md",
] as const;

export type CapsuleFile = (typeof CAPSULE_FILES)[number];

export interface CapsuleCliCommand {
  readonly description: string;
  readonly command: string;
  readonly category:
    | "status"
    | "timeline"
    | "dag"
    | "verification"
    | "diagnostics"
    | "evidence"
    | "history";
}

export interface CapsuleLayoutCheckItem {
  readonly name: string;
  readonly type: "directory" | "file";
  readonly exists: boolean;
  readonly path: string;
  readonly sizeBytes?: number | undefined;
}

export interface CapsuleLayoutValidation {
  readonly capsuleRoot: string;
  readonly valid: boolean;
  readonly directories: readonly CapsuleLayoutCheckItem[];
  readonly files: readonly CapsuleLayoutCheckItem[];
  readonly missingDirectories: readonly string[];
  readonly missingFiles: readonly string[];
}

export interface DecoupledMemoryPartition {
  readonly inMemoryContext: JsonObject;
  readonly decoupledPayload: JsonObject;
  readonly excludedFieldNames: readonly string[];
  readonly strippedByteEstimate: number;
}

export interface ContextBloatIssue {
  readonly path: string;
  readonly reason: string;
  readonly estimatedBytes: number;
}

export interface ContextBloatAudit {
  readonly hasBloat: boolean;
  readonly totalEstimatedBytes: number;
  readonly issues: readonly ContextBloatIssue[];
  readonly containsForbiddenKeys: boolean;
  readonly forbiddenKeysFound: readonly string[];
}

export interface DecoupledEventQueryOptions {
  readonly limit?: number | undefined;
  readonly eventType?: string | undefined;
  readonly taskId?: string | undefined;
}

export interface RichInstructionVerificationIssue {
  readonly section: string;
  readonly requirement: string;
  readonly details: string;
}

export interface RichInstructionVerificationResult {
  readonly valid: boolean;
  readonly hasIdentity: boolean;
  readonly hasResponsibilityChecklist: boolean;
  readonly hasCapsuleMemoryGuidance: boolean;
  readonly hasRoleContract: boolean;
  readonly hasTaskContract: boolean;
  readonly hasMappedRequirements: boolean;
  readonly hasAllowedScope: boolean;
  readonly hasEvidenceSchema: boolean;
  readonly hasTargetedCommands: boolean;
  readonly hasAuthoritativeContext: boolean;
  readonly freeOfBloat: boolean;
  readonly issues: readonly RichInstructionVerificationIssue[];
}

export function resolveCapsuleDirectory(capsuleRoot: string, dir: CapsuleDirectory): string {
  return join(capsuleRoot, dir);
}

export function resolveCapsuleFile(capsuleRoot: string, file: CapsuleFile): string {
  return join(capsuleRoot, file);
}

export function getCapsuleCliCommands(
  runId: string,
  taskId?: string | null,
): readonly CapsuleCliCommand[] {
  const taskFlag = taskId ? ` --task ${taskId}` : "";
  return [
    {
      category: "status",
      description: "Inspect task status & review history",
      command: `bun harness.ts report:task --run .capsules/${runId}${taskFlag}`,
    },
    {
      category: "timeline",
      description: "Stream event timeline",
      command: `bun harness.ts stream:events --run .capsules/${runId}`,
    },
    {
      category: "dag",
      description: "Inspect DAG topology & waves",
      command: `bun harness.ts dag:view --run .capsules/${runId}`,
    },
    {
      category: "verification",
      description: "Verify gate falsifiability (AGP)",
      command: `bun harness.ts gate:prove --run .capsules/${runId}${taskFlag}`,
    },
    {
      category: "diagnostics",
      description: "Query errors & remedies",
      command: "bun harness.ts explain <ERROR_CODE>",
    },
    {
      category: "diagnostics",
      description: "Check run health & diagnostics",
      command: `bun harness.ts doctor --run .capsules/${runId}`,
    },
    {
      category: "evidence",
      description: "Retrieve recorded evidence artifacts",
      command: `bun harness.ts evidence:get --run .capsules/${runId} --evidence <ID>`,
    },
    {
      category: "evidence",
      description: "Retrieve recorded findings from capsule memory",
      command: `bun harness.ts finding:get --run .capsules/${runId} --finding <ID>`,
    },
    {
      category: "history",
      description: "Inspect task execution history",
      command: `bun harness.ts history:get --run .capsules/${runId}${taskFlag}`,
    },
  ];
}

export function createCapsuleMemoryPointer(
  runId: string,
  role: AgentRole,
  taskId: string | null = null,
  capsuleRoot = `.capsules/${runId}`,
): CapsuleMemoryPointer {
  const commands = getCapsuleCliCommands(runId, taskId);
  return {
    run_id: runId,
    task_id: taskId,
    role,
    capsule_root: capsuleRoot,
    command_examples: commands.map((c) => c.command),
  };
}

export function formatCapsuleMemoryGuidance(pointer: CapsuleMemoryPointer): string {
  const commands = getCapsuleCliCommands(pointer.run_id, pointer.task_id);
  const lines: string[] = [
    "Heavy metadata, full event streams, dependency graphs, historical logs, and error dumps are decoupled into structured Capsule Memory on disk (`.capsules/`).",
    "Query detailed runtime information on demand using the following Harness CLI commands:",
  ];
  for (const cmd of commands) {
    lines.push(`- ${cmd.description}: \`${cmd.command}\``);
  }
  return lines.join("\n");
}

export function verifyCapsuleLayoutSync(capsuleRoot: string): CapsuleLayoutValidation {
  const directories: CapsuleLayoutCheckItem[] = [];
  const files: CapsuleLayoutCheckItem[] = [];
  const missingDirectories: string[] = [];
  const missingFiles: string[] = [];

  for (const dirName of CAPSULE_DIRECTORIES) {
    const dirPath = join(capsuleRoot, dirName);
    let exists = false;
    try {
      exists = existsSync(dirPath) && lstatSync(dirPath).isDirectory();
    } catch {
      exists = false;
    }
    directories.push({ name: dirName, type: "directory", exists, path: dirPath });
    if (!exists) {
      missingDirectories.push(dirName);
    }
  }

  for (const fileName of CAPSULE_FILES) {
    const filePath = join(capsuleRoot, fileName);
    let exists = false;
    let sizeBytes: number | undefined;
    try {
      if (existsSync(filePath) && lstatSync(filePath).isFile()) {
        exists = true;
        sizeBytes = statSync(filePath).size;
      }
    } catch {
      exists = false;
    }
    files.push({ name: fileName, type: "file", exists, path: filePath, sizeBytes });
    if (!exists) {
      missingFiles.push(fileName);
    }
  }

  const valid = missingDirectories.length === 0 && missingFiles.length === 0;
  return {
    capsuleRoot,
    valid,
    directories,
    files,
    missingDirectories,
    missingFiles,
  };
}

export async function verifyCapsuleLayout(capsuleRoot: string): Promise<CapsuleLayoutValidation> {
  return verifyCapsuleLayoutSync(capsuleRoot);
}

function computeJsonByteEstimate(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf-8");
  } catch {
    return 0;
  }
}

export function partitionDecoupledMemory(
  context: JsonObject,
  role: AgentRole,
): DecoupledMemoryPartition {
  const isValidationRole =
    role === "validator" ||
    role === "sub-validator" ||
    role === "mechanic-validator" ||
    role === "plan-validator";

  const sanitized = isValidationRole
    ? isolateValidatorContext(context)
    : sanitizeLeanContext(context);

  const decoupled: JsonObject = {};
  const excludedFieldNames: string[] = [];
  let strippedByteEstimate = 0;

  for (const [key, value] of Object.entries(context)) {
    if (!(key in sanitized)) {
      excludedFieldNames.push(key);
      decoupled[key] = value;
      strippedByteEstimate += computeJsonByteEstimate(value);
    }
  }

  excludedFieldNames.sort();

  return {
    inMemoryContext: sanitized,
    decoupledPayload: decoupled,
    excludedFieldNames,
    strippedByteEstimate,
  };
}

export function detectContextBloat(
  context: JsonObject,
  maxSizeBytes = 32768,
): ContextBloatAudit {
  const issues: ContextBloatIssue[] = [];
  const forbiddenFound = new Set<string>();

  function walk(current: unknown, currentPath: string): void {
    if (typeof current !== "object" || current === null) return;

    if (Array.isArray(current)) {
      if (current.length > 50) {
        issues.push({
          path: currentPath,
          reason: `Large array of ${current.length} items exceeds reasonable packet bounds`,
          estimatedBytes: computeJsonByteEstimate(current),
        });
      }
      for (let i = 0; i < Math.min(current.length, 10); i++) {
        walk(current[i], `${currentPath}[${i}]`);
      }
      return;
    }

    for (const [key, val] of Object.entries(current)) {
      const fieldPath = currentPath ? `${currentPath}.${key}` : key;
      const lowerKey = key.toLowerCase();

      for (const forbidden of VALIDATOR_EXCLUSIONS) {
        if (lowerKey === forbidden || lowerKey.includes(forbidden)) {
          forbiddenFound.add(key);
          issues.push({
            path: fieldPath,
            reason: `Field '${key}' is decoupled into disk memory and must not reside in lean packets`,
            estimatedBytes: computeJsonByteEstimate(val),
          });
        }
      }

      if (typeof val === "string" && val.length > 8192) {
        issues.push({
          path: fieldPath,
          reason: `String value exceeds 8KB (${val.length} chars); should be stored as decoupled blob`,
          estimatedBytes: Buffer.byteLength(val, "utf-8"),
        });
      }

      walk(val, fieldPath);
    }
  }

  walk(context, "");

  const totalEstimatedBytes = computeJsonByteEstimate(context);
  if (totalEstimatedBytes > maxSizeBytes) {
    issues.push({
      path: "root",
      reason: `Context byte size (${totalEstimatedBytes} bytes) exceeds maximum recommended packet size (${maxSizeBytes} bytes)`,
      estimatedBytes: totalEstimatedBytes,
    });
  }

  const forbiddenKeysFound = Array.from(forbiddenFound).sort();
  const hasBloat = issues.length > 0;

  return {
    hasBloat,
    totalEstimatedBytes,
    issues,
    containsForbiddenKeys: forbiddenKeysFound.length > 0,
    forbiddenKeysFound,
  };
}

export async function readDecoupledEvents(
  capsuleRoot: string,
  options: DecoupledEventQueryOptions = {},
): Promise<readonly JsonObject[]> {
  const eventsPath = join(capsuleRoot, "events.jsonl");
  if (!existsSync(eventsPath)) return [];

  const raw = await readFile(eventsPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const events: JsonObject[] = [];

  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (isJsonObject(parsed)) {
        if (options.eventType && parsed.type !== options.eventType) {
          continue;
        }
        if (options.taskId) {
          const data = parsed.data;
          const targetTaskId =
            isJsonObject(data) && typeof data.task_id === "string"
              ? data.task_id
              : isJsonObject(parsed) && typeof parsed.task_id === "string"
                ? parsed.task_id
                : null;
          if (targetTaskId !== options.taskId) {
            continue;
          }
        }
        events.push(parsed);
      }
    } catch {
      // Ignore unparseable lines in jsonl stream
    }
  }

  if (typeof options.limit === "number" && options.limit > 0) {
    return events.slice(-options.limit);
  }

  return events;
}

export async function readDecoupledEvidence(
  capsuleRoot: string,
  evidenceId: string,
): Promise<Buffer | null> {
  const sanitizedId = evidenceId.replace(/[^A-Za-z0-9._-]/gu, "");
  const evidenceDir = join(capsuleRoot, "evidence");
  if (!existsSync(evidenceDir)) return null;

  const candidateFiles = [
    join(evidenceDir, sanitizedId),
    join(evidenceDir, `${sanitizedId}.json`),
    join(evidenceDir, `${sanitizedId}.bin`),
    join(evidenceDir, `${sanitizedId}.txt`),
  ];

  for (const candidate of candidateFiles) {
    if (existsSync(candidate)) {
      return await readFile(candidate);
    }
  }

  return null;
}

export async function readDecoupledState(capsuleRoot: string): Promise<JsonObject | null> {
  const statePath = join(capsuleRoot, "state.json");
  if (!existsSync(statePath)) return null;

  try {
    const raw = await readFile(statePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeDecoupledBlob(
  capsuleRoot: string,
  content: Buffer | Uint8Array | string,
  prefix = "blob",
): Promise<{ hash: string; path: string; byteLength: number }> {
  const buffer =
    typeof content === "string"
      ? Buffer.from(content, "utf-8")
      : Buffer.isBuffer(content)
        ? content
        : Buffer.from(content);

  const hash = createHash("sha256").update(buffer).digest("hex");
  const blobsDir = join(capsuleRoot, "blobs");
  await mkdir(blobsDir, { recursive: true });

  const fileName = `${prefix}-${hash.slice(0, 16)}.bin`;
  const targetPath = join(blobsDir, fileName);

  await writeFile(targetPath, buffer);

  return {
    hash,
    path: targetPath,
    byteLength: buffer.byteLength,
  };
}

export async function readDecoupledBlob(
  capsuleRoot: string,
  blobSha: string,
): Promise<Buffer | null> {
  const blobsDir = join(capsuleRoot, "blobs");
  if (!existsSync(blobsDir)) return null;

  const entries = readdirSync(blobsDir);
  for (const entry of entries) {
    if (entry.includes(blobSha.slice(0, 16))) {
      const blobPath = join(blobsDir, entry);
      const content = await readFile(blobPath);
      const contentHash = createHash("sha256").update(content).digest("hex");
      if (contentHash.startsWith(blobSha) || blobSha.startsWith(contentHash)) {
        return content;
      }
    }
  }

  return null;
}

export function validateRichInstructionPacket(
  packet: BuiltPacket,
  expectedRole?: AgentRole,
): RichInstructionVerificationResult {
  const issues: RichInstructionVerificationIssue[] = [];
  const md = packet.markdown;

  const hasIdentity = md.includes("## Identity") || md.includes("# ");
  if (!hasIdentity) {
    issues.push({
      section: "Identity",
      requirement: "Identity section required",
      details: "Packet markdown lacks # <role> packet header or ## Identity section",
    });
  }

  const hasResponsibilityChecklist = md.includes("## Responsibility checklist");
  if (!hasResponsibilityChecklist) {
    issues.push({
      section: "Responsibility checklist",
      requirement: "Uncompromised responsibility checklist required",
      details: "Packet markdown lacks ## Responsibility checklist section",
    });
  }

  const hasCapsuleMemoryGuidance =
    md.includes("## Capsule memory on disk") || md.includes("Capsule Memory on disk");
  if (!hasCapsuleMemoryGuidance) {
    issues.push({
      section: "Capsule memory on disk",
      requirement: "Disk capsule memory pointers required",
      details: "Packet markdown lacks ## Capsule memory on disk section with CLI query guidance",
    });
  }

  const hasRoleContract = md.includes("## Role contract");
  if (!hasRoleContract) {
    issues.push({
      section: "Role contract",
      requirement: "Verbatim role contract required",
      details: "Packet markdown lacks ## Role contract section",
    });
  }

  const hasTaskContract = md.includes("## Task contract");
  const hasMappedRequirements = md.includes("## Mapped requirements");
  const hasAllowedScope = md.includes("## Allowed scope");
  const hasEvidenceSchema = md.includes("## Expected evidence schema");
  const hasTargetedCommands = md.includes("## Targeted commands");
  const hasAuthoritativeContext = md.includes("## Authoritative context");

  if (!hasTaskContract) {
    issues.push({
      section: "Task contract",
      requirement: "Task contract required",
      details: "Packet markdown lacks ## Task contract section",
    });
  }
  if (!hasMappedRequirements) {
    issues.push({
      section: "Mapped requirements",
      requirement: "Mapped requirements required",
      details: "Packet markdown lacks ## Mapped requirements section",
    });
  }
  if (!hasAllowedScope) {
    issues.push({
      section: "Allowed scope",
      requirement: "Allowed scope required",
      details: "Packet markdown lacks ## Allowed scope section",
    });
  }
  if (!hasEvidenceSchema) {
    issues.push({
      section: "Expected evidence schema",
      requirement: "Evidence schema required",
      details: "Packet markdown lacks ## Expected evidence schema section",
    });
  }
  if (!hasTargetedCommands) {
    issues.push({
      section: "Targeted commands",
      requirement: "Targeted commands required",
      details: "Packet markdown lacks ## Targeted commands section",
    });
  }
  if (!hasAuthoritativeContext) {
    issues.push({
      section: "Authoritative context",
      requirement: "Authoritative context required",
      details: "Packet markdown lacks ## Authoritative context section",
    });
  }

  // Check for forbidden leaked bloat
  const forbiddenPatterns = [
    "I tested everything manually",
    "100% flawless",
    "bypassed standard checks",
    "Previous validator approved",
    "historical report",
    "old review report",
  ];

  let freeOfBloat = true;
  for (const forbidden of forbiddenPatterns) {
    if (md.includes(forbidden)) {
      freeOfBloat = false;
      issues.push({
        section: "Authoritative context",
        requirement: "Decoupled memory purity",
        details: `Packet markdown contains forbidden bloated text: '${forbidden}'`,
      });
    }
  }

  if (expectedRole && packet.metadata.role !== expectedRole) {
    issues.push({
      section: "Metadata",
      requirement: "Role match",
      details: `Packet metadata role '${String(packet.metadata.role)}' does not match expected role '${expectedRole}'`,
    });
  }

  const valid = issues.length === 0;

  return {
    valid,
    hasIdentity,
    hasResponsibilityChecklist,
    hasCapsuleMemoryGuidance,
    hasRoleContract,
    hasTaskContract,
    hasMappedRequirements,
    hasAllowedScope,
    hasEvidenceSchema,
    hasTargetedCommands,
    hasAuthoritativeContext,
    freeOfBloat,
    issues,
  };
}
