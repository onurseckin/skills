import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
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
  options?: { readonly rootDir?: string | undefined } | undefined,
): readonly RawBacklogItem[] {
  const root = options?.rootDir !== undefined ? options.rootDir : process.cwd();
  return items.filter((item) => {
    const rawStatus =
      item.status !== undefined && item.status !== null ? String(item.status) : "PENDING";
    const status = rawStatus.toUpperCase();
    const ineligible = [
      "COMPLETED",
      "PROCESSED",
      "DECLINED",
      "BLOCKED",
      "DISPATCHED",
      "IN_PROGRESS",
      "CLAIMED",
      "RUNNING",
    ];
    if (ineligible.includes(status)) return false;
    if (item.plan_path && item.plan_path.trim() !== "") {
      const pathStr = item.plan_path.trim();
      const resolvedPath = isAbsolute(pathStr) ? pathStr : resolve(root, pathStr);
      if (existsSync(resolvedPath)) return false;
    } else if (status === "PLANNED") {
      return false;
    }
    return true;
  });
}

export function filterEligibleDefects(
  defects: readonly RawDefectItem[],
  options?: { readonly rootDir?: string | undefined } | undefined,
): readonly RawDefectItem[] {
  const root = options?.rootDir !== undefined ? options.rootDir : process.cwd();
  return defects.filter((defect) => {
    const rawStatus =
      defect.status !== undefined && defect.status !== null ? String(defect.status) : "OPEN";
    const status = rawStatus.toUpperCase();
    const ineligible = [
      "COMPLETED",
      "RESOLVED",
      "CLOSED",
      "DECLINED",
      "DISPATCHED",
      "IN_PROGRESS",
      "CLAIMED",
      "RUNNING",
    ];
    if (ineligible.includes(status)) return false;
    if (defect.plan_path && defect.plan_path.trim() !== "") {
      const pathStr = defect.plan_path.trim();
      const resolvedPath = isAbsolute(pathStr) ? pathStr : resolve(root, pathStr);
      if (existsSync(resolvedPath)) return false;
    } else if (status === "PLANNED") {
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
  const combined = `${title} ${descStr} ${catStr} ${errStr}`;

  if (category && CANONICAL_DOMAINS.includes(category.toLowerCase() as DomainCategory)) {
    return category.toLowerCase() as DomainCategory;
  }

  if (/\b(mind|cognitive|feedback|hyper-cognition|pulse|brainstorm|charter)\b/i.test(combined)) {
    return "mind";
  }
  if (
    /\b(validat(e|ed|ing|ion|or|ions|ors)?|test(s|ed|ing|er|ers)?|assert(s|ed|ing|ion|ions)?|coverage|apca|contrast|audit(s|ed|ing|or|ors)?|verifier|verif(y|ied|ying)|spec(s|ification|ifications)?)\b/i.test(
      combined,
    )
  ) {
    return "validation";
  }
  if (
    /\b(cli|command(s|ed|ing)?|tool(s|ing)?|script(s|ed|ing)?|shell|harness|flags|factory-ops)\b/i.test(
      combined,
    )
  ) {
    return "tooling";
  }
  if (
    /\b(engine|store|storage|ledger|cache|kv|scheduler|queue|pipeline|bridge)\b/i.test(combined)
  ) {
    return "engine";
  }
  if (
    /\b(report(s|ed|ing|er|ers)?|brief(s|ed|ing)?|summary|metrics|telemetry|doctor)\b/i.test(
      combined,
    )
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
  const eligibleItems = filterEligibleBacklogItems(items, options);
  const eligibleDefects = filterEligibleDefects(defects, options);

  if (eligibleItems.length === 0 && eligibleDefects.length === 0) return [];

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
    if (group === undefined || (group.itemIds.length === 0 && group.defectIds.length === 0))
      continue;

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
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8");
  const items: RawBacklogItem[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as RawBacklogItem;
      if (parsed && typeof parsed.id === "string") items.push(parsed);
    } catch {}
  }
  return Object.freeze(items);
}

export function loadDefectItems(filePath: string): readonly RawDefectItem[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8");
  const defects: RawDefectItem[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as RawDefectItem;
      if (parsed && typeof parsed.id === "string") defects.push(parsed);
    } catch {}
  }
  return Object.freeze(defects);
}

export const computeClusterId = generateClusterId;
