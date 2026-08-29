import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type {
  ClusterOptions,
  DomainCategory,
  RawBacklogItem,
  RawDefectItem,
  ThematicCluster,
} from "./types.ts";

export const CANONICAL_DOMAINS: readonly DomainCategory[] = [
  "core",
  "validation",
  "tooling",
  "engine",
  "mind",
  "reporting",
] as const;

export function filterEligibleBacklogItems(
  items: readonly RawBacklogItem[],
): readonly RawBacklogItem[] {
  return items.filter((item) => {
    if (item.plan_path && item.plan_path.trim() !== "") {
      return false;
    }
    const status = (item.status || "PENDING").toUpperCase();
    return (
      status !== "PLANNED" &&
      status !== "PROCESSED" &&
      status !== "COMPLETED" &&
      status !== "DECLINED" &&
      status !== "BLOCKED"
    );
  });
}

export function filterEligibleDefects(defects: readonly RawDefectItem[]): readonly RawDefectItem[] {
  return defects.filter((defect) => {
    if (defect.plan_path && defect.plan_path.trim() !== "") {
      return false;
    }
    const status = (defect.status || "OPEN").toUpperCase();
    return (
      status !== "PLANNED" &&
      status !== "RESOLVED" &&
      status !== "COMPLETED" &&
      status !== "CLOSED" &&
      status !== "DECLINED"
    );
  });
}

export function classifyDomain(
  title: string,
  description?: string,
  category?: string,
  errorCode?: string,
): DomainCategory {
  const combined =
    `${title} ${description ?? ""} ${category ?? ""} ${errorCode ?? ""}`.toLowerCase();

  // Explicit domain category override if exact match
  if (category && CANONICAL_DOMAINS.includes(category.toLowerCase() as DomainCategory)) {
    return category.toLowerCase() as DomainCategory;
  }

  // Domain classification heuristics based on priority and domain patterns
  if (
    combined.includes("mind") ||
    combined.includes("cognitive") ||
    combined.includes("feedback") ||
    combined.includes("hyper-cognition") ||
    combined.includes("pulse") ||
    combined.includes("brainstorm") ||
    combined.includes("charter")
  ) {
    return "mind";
  }

  if (
    combined.includes("validat") ||
    combined.includes("test") ||
    combined.includes("assert") ||
    combined.includes("coverage") ||
    combined.includes("apca") ||
    combined.includes("contrast") ||
    combined.includes("audit") ||
    combined.includes("verifier") ||
    combined.includes("spec")
  ) {
    return "validation";
  }

  if (
    combined.includes("cli") ||
    combined.includes("command") ||
    combined.includes("tool") ||
    combined.includes("script") ||
    combined.includes("shell") ||
    combined.includes("harness") ||
    combined.includes("flags") ||
    combined.includes("factory-ops")
  ) {
    return "tooling";
  }

  if (
    combined.includes("engine") ||
    combined.includes("store") ||
    combined.includes("storage") ||
    combined.includes("ledger") ||
    combined.includes("cache") ||
    combined.includes("kv") ||
    combined.includes("scheduler") ||
    combined.includes("queue") ||
    combined.includes("pipeline") ||
    combined.includes("bridge")
  ) {
    return "engine";
  }

  if (
    combined.includes("report") ||
    combined.includes("brief") ||
    combined.includes("summary") ||
    combined.includes("metrics") ||
    combined.includes("telemetry") ||
    combined.includes("doctor")
  ) {
    return "reporting";
  }

  return "core";
}

export function generateClusterId(
  domain: DomainCategory,
  itemIds: readonly string[],
  defectIds: readonly string[],
  timestamp?: string,
): string {
  const combined = [...itemIds, ...defectIds].slice().sort().join(",");
  const hash = createHash("sha256")
    .update(combined || domain)
    .digest("hex")
    .slice(0, 8);
  const ts = timestamp ? `-${timestamp.replace(/[:.]/g, "-").slice(0, 10)}` : "";
  return `cluster-${domain}-${hash}${ts}`;
}

export function generatePlanPath(clusterId: string, customDir?: string): string {
  const baseDir = customDir ?? "docs/planning";
  return `${baseDir}/${clusterId}/PLAN.md`;
}

export function clusterBacklogAndDefects(
  items: readonly RawBacklogItem[],
  defects: readonly RawDefectItem[],
  options?: ClusterOptions,
): readonly ThematicCluster[] {
  const eligibleItems = filterEligibleBacklogItems(items);
  const eligibleDefects = filterEligibleDefects(defects);

  if (eligibleItems.length === 0 && eligibleDefects.length === 0) {
    return [];
  }

  const domainGroups = new Map<
    DomainCategory,
    { itemIds: string[]; defectIds: string[]; titles: string[] }
  >();

  for (const domain of CANONICAL_DOMAINS) {
    domainGroups.set(domain, { itemIds: [], defectIds: [], titles: [] });
  }

  for (const item of eligibleItems) {
    const domain =
      item.domain && CANONICAL_DOMAINS.includes(item.domain.toLowerCase() as DomainCategory)
        ? (item.domain.toLowerCase() as DomainCategory)
        : classifyDomain(item.title ?? item.id, item.content, item.category);

    const group = domainGroups.get(domain)!;
    group.itemIds.push(item.id);
    if (item.title) group.titles.push(item.title);
  }

  for (const defect of eligibleDefects) {
    const domain =
      defect.domain && CANONICAL_DOMAINS.includes(defect.domain.toLowerCase() as DomainCategory)
        ? (defect.domain.toLowerCase() as DomainCategory)
        : classifyDomain(
            defect.title ?? defect.message ?? defect.id,
            defect.description,
            defect.category,
            defect.error_code,
          );

    const group = domainGroups.get(domain)!;
    group.defectIds.push(defect.id);
    if (defect.title) group.titles.push(defect.title);
  }

  const plannedAt = options?.timestamp ?? new Date().toISOString();
  const clusters: ThematicCluster[] = [];

  for (const domain of CANONICAL_DOMAINS) {
    const group = domainGroups.get(domain)!;
    if (group.itemIds.length === 0 && group.defectIds.length === 0) {
      continue;
    }

    const clusterId = generateClusterId(domain, group.itemIds, group.defectIds, options?.timestamp);

    const planPath = generatePlanPath(clusterId, options?.targetDir);
    const domainCapitalized = domain.charAt(0).toUpperCase() + domain.slice(1);
    const title = `${domainCapitalized} Continuous Pre-Planning Domain Cluster`;

    clusters.push({
      cluster_id: clusterId,
      domain,
      title,
      plan_path: planPath,
      backlog_item_ids: Object.freeze([...group.itemIds]),
      defect_ids: Object.freeze([...group.defectIds]),
      planned_at: plannedAt,
      description: `Domain cluster covering ${group.itemIds.length} backlog item(s) and ${group.defectIds.length} defect(s).`,
    });
  }

  return Object.freeze(clusters);
}

export function loadBacklogItems(filePath: string): readonly RawBacklogItem[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const content = readFileSync(filePath, "utf-8");
  const items: RawBacklogItem[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as RawBacklogItem;
      if (parsed && typeof parsed.id === "string") {
        items.push(parsed);
      }
    } catch {
      // Ignore corrupted lines
    }
  }
  return Object.freeze(items);
}

export function loadDefectItems(filePath: string): readonly RawDefectItem[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const content = readFileSync(filePath, "utf-8");
  const defects: RawDefectItem[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as RawDefectItem;
      if (parsed && typeof parsed.id === "string") {
        defects.push(parsed);
      }
    } catch {
      // Ignore corrupted lines
    }
  }
  return Object.freeze(defects);
}
