import { deconstructPromptBytes, RequirementClause } from "../critic/critic-ops";

export interface DiffFidelityReport {
  promptBytesMatched: boolean;
  totalClauses: number;
  unverifiedClauses: RequirementClause[];
}

export function analyzeDiffAgainstFidelity(
  promptBytes: string,
  diffOutput: string,
): DiffFidelityReport {
  const clauses = deconstructPromptBytes(promptBytes);
  const unverified: RequirementClause[] = [];

  for (const clause of clauses) {
    // Check if the diff somehow satisfies the clause (stub implementation)
    const satisfied = diffOutput.includes(clause.clause) || diffOutput.length > 0; // naive stub
    clause.verified = satisfied;
    if (!satisfied) {
      unverified.push(clause);
    }
  }

  return {
    promptBytesMatched: unverified.length === 0,
    totalClauses: clauses.length,
    unverifiedClauses: unverified,
  };
}
