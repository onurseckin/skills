import { OrchestratorPartition, computeWorkSpanMetrics, ValidatorDemand } from "..";
import { applicableValidatorDomains, ValidatorDomain, VALIDATOR_DOMAINS } from "../../../core/contracts";
import { DependencyMap } from "../../../graph/dag-forensics";
import { isInteger } from "../../../requirements/predicates";
import { ScheduledTask } from "../conflict/rank";

export function partitionOrchestratorDomains(
  tasks: readonly ScheduledTask[],
  dependencies: DependencyMap,
  maxPartitions = 4,
): OrchestratorPartition[] {
  if (tasks.length === 0) return [];

  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const primaryDomainMap = new Map<string, string>();

  for (const task of tasks) {
    const domains = applicableValidatorDomains(task.write_scope);
    if (domains.includes("ui-design")) {
      primaryDomainMap.set(task.id, "frontend-ui");
    } else if (domains.includes("system-design")) {
      primaryDomainMap.set(task.id, "backend-system");
    } else if (domains.includes("security")) {
      primaryDomainMap.set(task.id, "security-auth");
    } else {
      primaryDomainMap.set(task.id, "core-engine");
    }
  }

  const domainGroups = new Map<string, ScheduledTask[]>();
  for (const task of tasks) {
    const domain = primaryDomainMap.get(task.id) ?? "core-engine";
    const group = domainGroups.get(domain) ?? [];
    group.push(task);
    domainGroups.set(domain, group);
  }

  const partitions: OrchestratorPartition[] = [];
  const sortedDomains = Array.from(domainGroups.keys()).sort();

  for (const domain of sortedDomains) {
    const groupTasks = domainGroups.get(domain) ?? [];
    const groupTaskIds = groupTasks.map((t) => t.id).sort();
    const writeScopes = Array.from(new Set(groupTasks.flatMap((t) => t.write_scope))).sort();

    const crossDeps = new Set<string>();
    for (const task of groupTasks) {
      for (const prereq of dependencies.get(task.id) ?? []) {
        if (!groupTaskIds.includes(prereq)) {
          const prereqDomain = primaryDomainMap.get(prereq);
          if (prereqDomain && prereqDomain !== domain) {
            crossDeps.add(`orchestrator-domain-${prereqDomain}`);
          }
        }
      }
    }

    let groupWork = 0;
    for (const t of groupTasks) {
      groupWork += isInteger(t.effort) && t.effort > 0 ? t.effort : 1;
    }

    const subDeps: DependencyMap = new Map();
    for (const t of groupTasks) {
      const rawPrereqs = dependencies.get(t.id);
      const prereqs = rawPrereqs
        ? Array.from(rawPrereqs).filter((id: string) => groupTaskIds.includes(id))
        : [];
      subDeps.set(t.id, new Set(prereqs));
    }
    const subMetrics = computeWorkSpanMetrics(subDeps, taskMap);
    const recommendedWorkers = Math.max(
      1,
      Math.min(groupTasks.length, Math.ceil(subMetrics.parallelismFactor)),
    );

    partitions.push({
      partitionId: `orchestrator-domain-${domain}`,
      domain,
      taskIds: groupTaskIds,
      writeScopes,
      dependencies: Array.from(crossDeps).sort(),
      work: groupWork,
      span: subMetrics.span,
      recommendedWorkers,
    });
  }

  // Cap partition count if configured
  if (partitions.length > maxPartitions && maxPartitions > 0) {
    const main = partitions.slice(0, maxPartitions - 1);
    const remainder = partitions.slice(maxPartitions - 1);
    const mergedTaskIds = Array.from(new Set(remainder.flatMap((p) => p.taskIds))).sort();
    const mergedWriteScopes = Array.from(new Set(remainder.flatMap((p) => p.writeScopes))).sort();
    const mergedDeps = Array.from(new Set(remainder.flatMap((p) => p.dependencies)))
      .filter((d) => !remainder.some((r) => r.partitionId === d))
      .sort();
    const mergedWork = remainder.reduce((acc, p) => acc + p.work, 0);
    const mergedSpan = Math.max(...remainder.map((p) => p.span));
    const mergedWorkers = Math.max(...remainder.map((p) => p.recommendedWorkers));

    return [
      ...main,
      {
        partitionId: "orchestrator-domain-composite",
        domain: "composite",
        taskIds: mergedTaskIds,
        writeScopes: mergedWriteScopes,
        dependencies: mergedDeps,
        work: mergedWork,
        span: mergedSpan,
        recommendedWorkers: mergedWorkers,
      },
    ];
  }

  return partitions;
}
export function calculateValidatorAllocations(tasks: readonly ScheduledTask[]): {
  demands: readonly ValidatorDemand[];
  fleet: Readonly<Record<ValidatorDomain, number>>;
} {
  const counts: Record<ValidatorDomain, number> = {
    "code-quality": 0,
    product: 0,
    security: 0,
    "system-design": 0,
    "ui-design": 0,
  };

  for (const task of tasks) {
    const domains = applicableValidatorDomains(task.write_scope);
    for (const domain of domains) {
      counts[domain] += 1;
    }
  }

  const demands: ValidatorDemand[] = [];
  const fleet: Record<ValidatorDomain, number> = {
    "code-quality": 0,
    product: 0,
    security: 0,
    "system-design": 0,
    "ui-design": 0,
  };

  for (const domain of VALIDATOR_DOMAINS) {
    const count = counts[domain];
    const rec = Math.min(count, Math.max(count > 0 ? 1 : 0, Math.ceil(count / 2)));
    fleet[domain] = rec;
    demands.push({
      domain,
      taskCount: count,
      recommendedValidators: rec,
    });
  }

  return { demands, fleet };
}
export function calculateCriticConcurrency(
  taskCount: number,
  waveCount: number,
  partitionCount: number,
): number {
  if (taskCount === 0) return 1;
  const base = Math.max(1, partitionCount);
  const waveLoad = Math.ceil(taskCount / Math.max(1, waveCount));
  return Math.min(4, Math.max(1, Math.min(base, waveLoad)));
}
