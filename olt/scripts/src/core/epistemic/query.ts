import type {
  EpistemicConfidenceLevel,
  EpistemicGrade,
  EpistemicQuery,
  EpistemicQueryAggregate,
  EpistemicQueryOrder,
  EpistemicQueryPlan,
  EpistemicQueryPredicate,
  EpistemicQueryProjection,
  EpistemicQueryResult,
  EpistemicRecord,
} from "./types.ts";

export type {
  EpistemicQuery,
  EpistemicQueryAggregate,
  EpistemicQueryOrder,
  EpistemicQueryPlan,
  EpistemicQueryPredicate,
  EpistemicQueryProjection,
  EpistemicQueryResult,
  EpistemicRecord,
};

const GRADE_RANKS: Readonly<Record<EpistemicGrade, number>> = {
  VERY_LOW: 1,
  LOW: 2,
  MEDIUM: 3,
  HIGH: 4,
  VERY_HIGH: 5,
};

export class EpistemicIndexStore {
  private readonly records = new Map<string, EpistemicRecord>();
  private readonly gradeIdx = new Map<EpistemicGrade, Set<string>>();
  private readonly levelIdx = new Map<EpistemicConfidenceLevel, Set<string>>();
  private readonly groundedIdx = new Map<boolean, Set<string>>();
  private readonly tagIdx = new Map<string, Set<string>>();

  public add(record: EpistemicRecord): void {
    this.remove(record.id);
    this.records.set(record.id, record);
    if (!this.gradeIdx.has(record.grade)) this.gradeIdx.set(record.grade, new Set());
    this.gradeIdx.get(record.grade)!.add(record.id);
    if (!this.levelIdx.has(record.level)) this.levelIdx.set(record.level, new Set());
    this.levelIdx.get(record.level)!.add(record.id);
    if (!this.groundedIdx.has(record.grounded)) this.groundedIdx.set(record.grounded, new Set());
    this.groundedIdx.get(record.grounded)!.add(record.id);
    for (const tag of record.tags) {
      if (!this.tagIdx.has(tag)) this.tagIdx.set(tag, new Set());
      this.tagIdx.get(tag)!.add(record.id);
    }
  }

  public addMany(records: readonly EpistemicRecord[]): void {
    for (const record of records) this.add(record);
  }

  public remove(id: string): boolean {
    const existing = this.records.get(id);
    if (!existing) return false;
    this.records.delete(id);
    this.gradeIdx.get(existing.grade)?.delete(id);
    this.levelIdx.get(existing.level)?.delete(id);
    this.groundedIdx.get(existing.grounded)?.delete(id);
    for (const tag of existing.tags) this.tagIdx.get(tag)?.delete(id);
    return true;
  }

  public clear(): void {
    this.records.clear();
    this.gradeIdx.clear();
    this.levelIdx.clear();
    this.groundedIdx.clear();
    this.tagIdx.clear();
  }

  public size(): number {
    return this.records.size;
  }
  public get(id: string): EpistemicRecord | undefined {
    return this.records.get(id);
  }
  public getAll(): readonly EpistemicRecord[] {
    return Array.from(this.records.values());
  }

  public queryCandidates(where?: EpistemicQueryPredicate): {
    candidateIds?: Set<string>;
    usedIndices: string[];
  } {
    if (!where) return { usedIndices: [] };
    const usedIndices: string[] = [];
    const sets: Set<string>[] = [];

    if (where.grades && where.grades.length > 0) {
      usedIndices.push("gradeIdx");
      const gradeSet = new Set<string>();
      for (const g of where.grades) {
        const matches = this.gradeIdx.get(g);
        if (matches) for (const id of matches) gradeSet.add(id);
      }
      sets.push(gradeSet);
    }
    if (where.levels && where.levels.length > 0) {
      usedIndices.push("levelIdx");
      const levelSet = new Set<string>();
      for (const l of where.levels) {
        const matches = this.levelIdx.get(l);
        if (matches) for (const id of matches) levelSet.add(id);
      }
      sets.push(levelSet);
    }
    if (where.grounded !== undefined) {
      usedIndices.push("groundedIdx");
      sets.push(new Set(this.groundedIdx.get(where.grounded) ?? []));
    }
    if (where.tags && where.tags.length > 0) {
      usedIndices.push("tagIdx");
      for (const tag of where.tags) sets.push(new Set(this.tagIdx.get(tag) ?? []));
    }
    if (sets.length === 0) return { usedIndices: [] };
    sets.sort((a, b) => a.size - b.size);
    const result = new Set<string>(sets[0]);
    for (let i = 1; i < sets.length; i++) {
      const current = sets[i]!;
      for (const id of result) {
        if (!current.has(id)) result.delete(id);
      }
    }
    return { candidateIds: result, usedIndices };
  }
}

export function matchesEpistemicPredicate(
  record: EpistemicRecord,
  where?: EpistemicQueryPredicate,
): boolean {
  if (!where) return true;
  if (where.minConfidence !== undefined && record.score < where.minConfidence) return false;
  if (where.maxConfidence !== undefined && record.score > where.maxConfidence) return false;
  if (where.grades && where.grades.length > 0 && !where.grades.includes(record.grade)) return false;
  if (where.levels && where.levels.length > 0 && !where.levels.includes(record.level)) return false;
  if (where.grounded !== undefined && record.grounded !== where.grounded) return false;
  if (where.minEntropy !== undefined && record.entropy < where.minEntropy) return false;
  if (where.maxEntropy !== undefined && record.entropy > where.maxEntropy) return false;
  if (where.createdAfter !== undefined && record.timestamp < where.createdAfter) return false;
  if (where.createdBefore !== undefined && record.timestamp > where.createdBefore) return false;
  if (where.contradictions !== undefined) {
    if (typeof where.contradictions === "boolean") {
      if (where.contradictions && record.contradictionCount === 0) return false;
      if (!where.contradictions && record.contradictionCount > 0) return false;
    } else {
      if (
        where.contradictions.min !== undefined &&
        record.contradictionCount < where.contradictions.min
      )
        return false;
      if (
        where.contradictions.max !== undefined &&
        record.contradictionCount > where.contradictions.max
      )
        return false;
    }
  }
  if (where.tags && where.tags.length > 0 && !where.tags.every((t) => record.tags.includes(t)))
    return false;
  return true;
}

export function computeEpistemicAggregate(
  records: readonly EpistemicRecord[],
): EpistemicQueryAggregate {
  const count = records.length;
  if (count === 0) {
    return {
      count: 0,
      meanScore: 0,
      medianScore: 0,
      stdDevScore: 0,
      minScore: 0,
      maxScore: 0,
      gradeDistribution: { VERY_LOW: 0, LOW: 0, MEDIUM: 0, HIGH: 0, VERY_HIGH: 0 },
      groundedCount: 0,
      meanEntropy: 0,
    };
  }
  const scores = records.map((r) => r.score).sort((a, b) => a - b);
  const totalScore = scores.reduce((sum, s) => sum + s, 0);
  const meanScore = Number((totalScore / count).toFixed(6));
  const mid = Math.floor(count / 2);
  const medianScore =
    count % 2 !== 0 ? scores[mid]! : Number(((scores[mid - 1]! + scores[mid]!) / 2).toFixed(6));
  const minScore = scores[0]!;
  const maxScore = scores[scores.length - 1]!;
  const variance = records.reduce((sum, r) => sum + Math.pow(r.score - meanScore, 2), 0) / count;
  const stdDevScore = Number(Math.sqrt(variance).toFixed(6));
  const totalEntropy = records.reduce((sum, r) => sum + r.entropy, 0);
  const meanEntropy = Number((totalEntropy / count).toFixed(6));
  const gradeDistribution: Record<EpistemicGrade, number> = {
    VERY_LOW: 0,
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    VERY_HIGH: 0,
  };
  let groundedCount = 0;
  for (const r of records) {
    gradeDistribution[r.grade] += 1;
    if (r.grounded) groundedCount += 1;
  }
  return {
    count,
    meanScore,
    medianScore,
    stdDevScore,
    minScore,
    maxScore,
    gradeDistribution,
    groundedCount,
    meanEntropy,
  };
}

export class EpistemicQueryOptimizer {
  private readonly planCache = new Map<string, { plan: EpistemicQueryPlan; timestamp: number }>();

  public plan(query: EpistemicQuery, store?: EpistemicIndexStore): EpistemicQueryPlan {
    const cacheKey = JSON.stringify(query);
    const cached = this.planCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 30000) {
      return { ...cached.plan, cacheHit: true };
    }
    const { candidateIds, usedIndices } = store?.queryCandidates(query.where) ?? {
      usedIndices: [],
    };
    let executionStrategy: EpistemicQueryPlan["executionStrategy"] = "COLLECTION_SCAN";
    let estimatedCost = store ? store.size() : 100;
    if (candidateIds) {
      executionStrategy = candidateIds.size === 0 ? "EMPTY_MATCH" : "INDEX_SCAN";
      estimatedCost = candidateIds.size;
    }
    const plan: EpistemicQueryPlan = {
      executionStrategy,
      usedIndices,
      estimatedCost,
      actualScanCount: 0,
      executionTimeMs: 0,
      cacheHit: false,
    };
    this.planCache.set(cacheKey, { plan, timestamp: Date.now() });
    return plan;
  }

  public execute<T = EpistemicRecord>(
    query: EpistemicQuery,
    storeOrRecords: EpistemicIndexStore | readonly EpistemicRecord[],
  ): EpistemicQueryResult<T> {
    const startTime = performance.now();
    const isStore = storeOrRecords instanceof EpistemicIndexStore;
    const store = isStore ? storeOrRecords : undefined;
    const queryPlan = this.plan(query, store);
    let candidates: readonly EpistemicRecord[];
    let actualScanCount = 0;

    if (queryPlan.executionStrategy === "EMPTY_MATCH") {
      candidates = [];
    } else if (isStore && queryPlan.executionStrategy === "INDEX_SCAN") {
      const { candidateIds } = store!.queryCandidates(query.where);
      const list: EpistemicRecord[] = [];
      if (candidateIds) {
        for (const id of candidateIds) {
          const rec = store!.get(id);
          if (rec) list.push(rec);
        }
      }
      actualScanCount = list.length;
      candidates = list.filter((r) => matchesEpistemicPredicate(r, query.where));
    } else {
      const all = isStore ? store!.getAll() : storeOrRecords;
      actualScanCount = all.length;
      candidates = all.filter((r) => matchesEpistemicPredicate(r, query.where));
    }

    if (query.orderBy && query.orderBy.length > 0) {
      const orders = query.orderBy;
      candidates = [...candidates].sort((a, b) => {
        for (const ord of orders) {
          let cmp = 0;
          if (ord.field === "confidence") cmp = a.score - b.score;
          else if (ord.field === "entropy") cmp = a.entropy - b.entropy;
          else if (ord.field === "contradictions")
            cmp = a.contradictionCount - b.contradictionCount;
          else if (ord.field === "timestamp") cmp = a.timestamp - b.timestamp;
          else if (ord.field === "grade") cmp = GRADE_RANKS[a.grade] - GRADE_RANKS[b.grade];
          if (cmp !== 0) return ord.direction === "desc" ? -cmp : cmp;
        }
        return 0;
      });
    }

    const totalMatched = candidates.length;
    const offset = query.offset ?? 0;
    const limit = query.limit !== undefined ? query.limit : candidates.length;
    const paginated = candidates.slice(offset, offset + limit);
    const projected = paginated.map((r) => this.projectRecord<T>(r, query.projection));
    const aggregate = query.includeAggregate ? computeEpistemicAggregate(candidates) : undefined;
    const executionTimeMs = Number((performance.now() - startTime).toFixed(3));

    return {
      records: projected,
      totalMatched,
      plan: { ...queryPlan, actualScanCount, executionTimeMs },
      aggregate,
    };
  }

  private projectRecord<T>(record: EpistemicRecord, projection?: EpistemicQueryProjection): T {
    if (!projection || projection === "full") return record as unknown as T;
    if (projection === "score_only") {
      return {
        id: record.id,
        score: record.score,
        grade: record.grade,
        level: record.level,
      } as unknown as T;
    }
    if (projection === "vector") {
      return { id: record.id, vector: record.vector, score: record.score } as unknown as T;
    }
    return {
      id: record.id,
      timestamp: record.timestamp,
      score: record.score,
      grade: record.grade,
      level: record.level,
      grounded: record.grounded,
      contradictionCount: record.contradictionCount,
      tags: record.tags,
    } as unknown as T;
  }
}
