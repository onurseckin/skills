import ts from "typescript";
import type {
  MutantRecord,
  MutationGateOptions,
  MutationType,
} from "../anti-mock/anti-mock-types.ts";
import {
  visitBooleanKeywords,
  visitUnaryInversion,
  visitBinaryExpressions,
  visitReturnStatement,
  visitFunctionBody,
  visitStringLiteral,
  CandidateAdder,
} from "../rules/mutation-visitors.ts";

interface MutationCandidate {
  readonly mutationType: MutationType;
  readonly description: string;
  readonly startPosition: number;
  readonly endPosition: number;
  readonly originalText: string;
  readonly replacementText: string;
  readonly line: number;
  readonly column: number;
}

export function generateMutants(sourceCode: string, options?: MutationGateOptions): MutantRecord[] {
  const allowedTypes = options?.mutationTypes
    ? new Set<MutationType>(options.mutationTypes)
    : undefined;
  const fileName =
    typeof options?.file === "string" && options.file.length > 0 ? options.file : "source.ts";

  const sourceFile = ts.createSourceFile(
    fileName,
    sourceCode,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const candidates: MutationCandidate[] = [];

  const addCandidate: CandidateAdder = (
    mutationType,
    description,
    start,
    end,
    originalText,
    replacementText,
  ) => {
    if (allowedTypes && !allowedTypes.has(mutationType)) return;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
    candidates.push({
      mutationType,
      description,
      startPosition: start,
      endPosition: end,
      originalText,
      replacementText,
      line: line + 1,
      column: character + 1,
    });
  };

  function walk(node: ts.Node): void {
    visitBooleanKeywords(node, sourceFile, addCandidate);
    visitUnaryInversion(node, sourceFile, addCandidate);
    visitBinaryExpressions(node, sourceFile, addCandidate);
    visitReturnStatement(node, sourceFile, addCandidate);
    visitFunctionBody(node, sourceFile, addCandidate);
    visitStringLiteral(node, sourceFile, addCandidate);
    ts.forEachChild(node, walk);
  }

  walk(sourceFile);

  const maxMutants =
    typeof options?.maxMutants === "number" ? options.maxMutants : candidates.length;
  const selectedCandidates = candidates.slice(0, maxMutants);

  return selectedCandidates.map((candidate, idx) => {
    const mutatedSource =
      sourceCode.slice(0, candidate.startPosition) +
      candidate.replacementText +
      sourceCode.slice(candidate.endPosition);

    return {
      id: `mutant-${idx + 1}`,
      mutationType: candidate.mutationType,
      description: candidate.description,
      line: candidate.line,
      column: candidate.column,
      startPosition: candidate.startPosition,
      endPosition: candidate.endPosition,
      originalText: candidate.originalText,
      mutatedText: candidate.replacementText,
      mutatedSource,
    };
  });
}
