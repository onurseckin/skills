import type {
  EpistemicGrade,
  EpistemicQueryAggregate,
  EpistemicQueryPredicate,
  EpistemicRecord,
} from "./types.ts";

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
