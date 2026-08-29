import type { BreakthroughProposal } from "./classifier.ts";

export function synthesizeFlavorBreakthroughProposals(
  simplerScore: number,
  fasterScore: number,
  qualityScore: number,
): BreakthroughProposal[] {
  const breakthroughProposals: BreakthroughProposal[] = [];

  if (simplerScore < 85) {
    breakthroughProposals.push({
      id: "PROP-SIMP-001",
      title: "Radical Architecture & File Consolidation",
      targetDimension: "simpler",
      rationale:
        "Excess abstraction layers and fragmented utility modules introduce cognitive friction and maintenance overhead.",
      firstPrinciplesAnalysis:
        "Every layer of indirection must justify its existence with concrete isolation benefits. Direct module exports eliminate redundant mapping logic.",
      estimatedSimplicityGain: "40% reduction in mental hops and import graph depth",
      estimatedLatencyReduction: "Faster test suite startup and quicker file discovery",
      implementationPlan: [
        "Audit module dependency graphs for 1:1 pass-through wrappers.",
        "Consolidate companion utilities into unified domain modules.",
        "Remove obsolete abstraction shims.",
      ],
    });
  }

  if (fasterScore < 85) {
    breakthroughProposals.push({
      id: "PROP-FAST-001",
      title: "Topological Concurrency Expansion ($P = W / S$)",
      targetDimension: "faster",
      rationale:
        "Independent tasks are being queued serially despite available Work/Span parallelism headroom.",
      firstPrinciplesAnalysis:
        "When write scopes are disjoint, tasks have zero resource contention. Concurrency is limited only by topological span length $S$.",
      estimatedSimplicityGain: "Elimination of complex queue synchronization barriers",
      estimatedLatencyReduction: "Up to 3x wall-clock execution speedup via parallel wave lanes",
      implementationPlan: [
        "Partition active ready queue by disjoint write scopes.",
        "Dispatch parallel worker subagents simultaneously up to Work/Span headroom.",
        "Adopt continuous 1:1 pairing: validate immediately upon implementer submission.",
      ],
    });
  }

  if (qualityScore < 85) {
    breakthroughProposals.push({
      id: "PROP-QUAL-001",
      title: "Zero-Any Type Hardening & Counterfactual Probing",
      targetDimension: "higher_quality",
      rationale:
        "Untyped references or unproven gates weaken system guarantees and risk silent regressions.",
      firstPrinciplesAnalysis:
        "TypeScript's type checker provides zero-cost compile-time invariants when untyped escapes are eliminated.",
      estimatedSimplicityGain: "Self-documenting interfaces with total type safety",
      estimatedLatencyReduction:
        "Elimination of debugging cycles caused by runtime type mismatches",
      implementationPlan: [
        "Replace all `any` types with strict discriminated unions or type narrowing.",
        "Run `gate:prove` against disposable scratch copies to verify gate falsifiability.",
        "Mandate adversarial probe rounds before accepting validator passes.",
      ],
    });
  }

  return breakthroughProposals;
}
