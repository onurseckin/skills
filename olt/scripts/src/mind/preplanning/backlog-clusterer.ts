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
    const rawStatus =
      item.status !== undefined && item.status !== null ? String(item.status) : "PENDING";
    const status = rawStatus.toUpperCase();
    const ineligible = ["COMPLETED", "PROCESSED", "DECLINED", "BLOCKED"];
    if (ineligible.includes(status)) {
      return false;
    }
    if (item.plan_path && item.plan_path.trim() !== "") {
      const pathStr = item.plan_path.trim();
      if (existsSync(pathStr) || pathStr.startsWith("docs/planning/")) {
        return false;
      }
    }
    if (status === "PLANNED" && (!item.plan_path || item.plan_path.trim() === "")) {
      return false;
    }
    return true;
  });
}

export function filterEligibleDefects(defects: readonly RawDefectItem[]): readonly RawDefectItem[] {
  return defects.filter((defect) => {
    const rawStatus =
      defect.status !== undefined && defect.status !== null ? String(defect.status) : "OPEN";
    const status = rawStatus.toUpperCase();
    const ineligible = ["COMPLETED", "RESOLVED", "CLOSED", "DECLINED"];
    if (ineligible.includes(status)) {
      return false;
    }
    if (defect.plan_path && defect.plan_path.trim() !== "") {
      const pathStr = defect.plan_path.trim();
      if (existsSync(pathStr) || pathStr.startsWith("docs/planning/")) {
        return false;
      }
    }
    if (status === "PLANNED" && (!defect.plan_path || defect.plan_path.trim() === "")) {
      return false;
    }
    return true;
  });
}

export function classifyDomain(
  title: string,
  description?: string,
  category?: string,
  errorCode?: string,
): DomainCategory {
  const descStr = description !== undefined ? description : "";
  const catStr = category !== undefined ? category : "";
  const errStr = errorCode !== undefined ? errorCode : "";
  const combined = `${title} ${descStr} ${catStr} ${errStr}`.toLowerCase();

  // Explicit domain category override if exact match
  if (category && CANONICAL_DOMAINS.includes(category.toLowerCase() as DomainCategory)) {
    return category.toLowerCase() as DomainCategory;
  }

  // Domain classification heuristics based on priority and domain patterns
  const mindKeywords = [
    "mind",
    "cognitive",
    "feedback",
    "hyper-cognition",
    "pulse",
    "brainstorm",
    "charter",
  ];
  if (mindKeywords.some((w) => combined.includes(w))) {
    return "mind";
  }

  const valKeywords = [
    "validat",
    "test",
    "assert",
    "coverage",
    "apca",
    "contrast",
    "audit",
    "verifier",
    "spec",
  ];
  if (valKeywords.some((w) => combined.includes(w))) {
    return "validation";
  }

  const toolKeywords = [
    "cli",
    "command",
    "tool",
    "script",
    "shell",
    "harness",
    "flags",
    "factory-ops",
  ];
  if (toolKeywords.some((w) => combined.includes(w))) {
    return "tooling";
  }

  const engKeywords = [
    "engine",
    "store",
    "storage",
    "ledger",
    "cache",
    "kv",
    "scheduler",
    "queue",
    "pipeline",
    "bridge",
  ];
  if (engKeywords.some((w) => combined.includes(w))) {
    return "engine";
  }

  const repKeywords = ["report", "brief", "summary", "metrics", "telemetry", "doctor"];
  if (repKeywords.some((w) => combined.includes(w))) {
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
  const hashTarget = combined.length > 0 ? combined : domain;
  const hash = createHash("sha256").update(hashTarget).digest("hex").slice(0, 8);
  const ts = timestamp ? `-${timestamp.replace(/[:.]/g, "-").slice(0, 10)}` : "";
  return `cluster-${domain}-${hash}${ts}`;
}

export function generatePlanPath(clusterId: string, customDir?: string): string {
  const baseDir = customDir !== undefined && customDir !== null ? customDir : "docs/planning";
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
    const titleVal = item.title !== undefined ? item.title : item.id;
    const domain =
      item.domain && CANONICAL_DOMAINS.includes(item.domain.toLowerCase() as DomainCategory)
        ? (item.domain.toLowerCase() as DomainCategory)
        : classifyDomain(titleVal, item.content, item.category);

    const group = domainGroups.get(domain);
    if (group !== undefined) {
      group.itemIds.push(item.id);
      if (item.title) group.titles.push(item.title);
    }
  }

  for (const defect of eligibleDefects) {
    const defectTitle =
      defect.title !== undefined
        ? defect.title
        : defect.message !== undefined
          ? defect.message
          : defect.id;
    const domain =
      defect.domain && CANONICAL_DOMAINS.includes(defect.domain.toLowerCase() as DomainCategory)
        ? (defect.domain.toLowerCase() as DomainCategory)
        : classifyDomain(defectTitle, defect.description, defect.category, defect.error_code);

    const group = domainGroups.get(domain);
    if (group !== undefined) {
      group.defectIds.push(defect.id);
      if (defect.title) group.titles.push(defect.title);
    }
  }

  const plannedAt =
    options !== undefined && options.timestamp !== undefined
      ? options.timestamp
      : new Date().toISOString();
  const clusters: ThematicCluster[] = [];

  for (const domain of CANONICAL_DOMAINS) {
    const group = domainGroups.get(domain);
    if (group === undefined) {
      continue;
    }
    if (group.itemIds.length === 0 && group.defectIds.length === 0) {
      continue;
    }

    const tsOpt = options !== undefined ? options.timestamp : undefined;
    const targetDirOpt = options !== undefined ? options.targetDir : undefined;
    const clusterId = generateClusterId(domain, group.itemIds, group.defectIds, tsOpt);

    const planPath = generatePlanPath(clusterId, targetDirOpt);
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

export const computeClusterId = generateClusterId;
