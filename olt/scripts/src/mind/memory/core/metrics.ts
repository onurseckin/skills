import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import type { MemoryDocument } from "./types.ts";
import { extractGenerationFromCapsuleId } from "./types.ts";
import { createMemoryDocument, normalizeTags } from "./storage.ts";
export function indexCapsuleDocuments(capsulesDir: string, explicitRun?: string): MemoryDocument[] {
  const documents: MemoryDocument[] = [];
  const capsuleDirs: Array<{ name: string; path: string }> = [];

  if (existsSync(capsulesDir)) {
    try {
      const entries = readdirSync(capsulesDir, { withFileTypes: true });
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (entry !== undefined && entry.isDirectory() && !entry.name.startsWith(".")) {
          capsuleDirs.push({ name: entry.name, path: join(capsulesDir, entry.name) });
        }
      }
    } catch {
      // Non-fatal capsule scan error
    }
  }

  if (explicitRun !== undefined) {
    const explicitAbs = resolve(explicitRun);
    const capName = basename(explicitAbs);
    if (!capsuleDirs.some((c) => c.path === explicitAbs)) {
      capsuleDirs.push({ name: capName, path: explicitAbs });
    }
  }

  for (let i = 0; i < capsuleDirs.length; i += 1) {
    const cap = capsuleDirs[i];
    if (cap === undefined) continue;

    const gen = extractGenerationFromCapsuleId(cap.name);

    // 1. Prompt
    const promptPath = join(cap.path, "prompt.md");
    if (existsSync(promptPath)) {
      try {
        const promptContent = readFileSync(promptPath, "utf-8");
        documents.push(
          createMemoryDocument({
            id: `prompt-${cap.name}`,
            kind: "capsule",
            title: `Capsule Prompt (${cap.name})`,
            capsule_id: cap.name,
            generation: gen,
            tags: normalizeTags([
              "capsule",
              "prompt",
              cap.name,
              ...(gen !== null ? [`gen-${gen}`] : []),
            ]),
            source_path: promptPath,
            content: promptContent,
            snippet: promptContent.slice(0, 200),
            metadata: { capsule: cap.name, generation: gen, file: "prompt.md" },
          }),
        );
      } catch {
        // Ignore read error
      }
    }

    // 2. Trace
    const tracePath = join(cap.path, "trace.md");
    if (existsSync(tracePath)) {
      try {
        const traceContent = readFileSync(tracePath, "utf-8");
        documents.push(
          createMemoryDocument({
            id: `trace-${cap.name}`,
            kind: "capsule",
            title: `Execution Trace (${cap.name})`,
            capsule_id: cap.name,
            generation: gen,
            tags: normalizeTags([
              "capsule",
              "trace",
              cap.name,
              ...(gen !== null ? [`gen-${gen}`] : []),
            ]),
            source_path: tracePath,
            content: traceContent,
            snippet: traceContent.slice(0, 200),
            metadata: { capsule: cap.name, generation: gen, file: "trace.md" },
          }),
        );
      } catch {
        // Ignore read error
      }
    }

    // 3. State.json tasks
    const statePath = join(cap.path, "state.json");
    if (existsSync(statePath)) {
      try {
        const stateRaw = readFileSync(statePath, "utf-8");
        const stateObj = JSON.parse(stateRaw) as Record<string, unknown>;

        if (Array.isArray(stateObj.tasks)) {
          for (let j = 0; j < stateObj.tasks.length; j += 1) {
            const task = stateObj.tasks[j];
            if (task !== null && typeof task === "object" && !Array.isArray(task)) {
              const taskObj = task as Record<string, unknown>;
              const taskId = typeof taskObj.id === "string" ? taskObj.id : `task-${j}`;
              const label = typeof taskObj.label === "string" ? taskObj.label : taskId;
              const status = typeof taskObj.status === "string" ? taskObj.status : "unknown";
              const writeScope = Array.isArray(taskObj.write_scope)
                ? taskObj.write_scope.join(", ")
                : "";

              const content = `${taskId} ${label} ${status} ${writeScope}`;
              const snippet = `Task [${taskId}] (${status}): ${label}. Write scope: ${writeScope}`;

              documents.push(
                createMemoryDocument({
                  id: `task-${cap.name}-${taskId}`,
                  kind: "capsule",
                  title: `Task ${taskId} (${cap.name})`,
                  capsule_id: cap.name,
                  generation: gen,
                  tags: normalizeTags([
                    "capsule",
                    "task",
                    status.toLowerCase(),
                    taskId.toLowerCase(),
                    cap.name,
                    ...(gen !== null ? [`gen-${gen}`] : []),
                  ]),
                  source_path: statePath,
                  content,
                  snippet,
                  metadata: {
                    task_id: taskId,
                    status,
                    capsule: cap.name,
                    generation: gen,
                    write_scope: task.write_scope,
                  },
                }),
              );
            }
          }
        }
      } catch {
        // Ignore state parse error
      }
    }
  }

  return documents;
}

/**
 * Indexes decisions from candidate proposals, audit reports, and round reviews.
 */
