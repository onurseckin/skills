import { HarnessError } from "../../core/errors/index.ts";
import {
  PERMUTATION_THEMES,
  VIEWPORT_DIMENSIONS,
  THEME_PERMUTATION_GRID,
  type ThemeMode,
  type PermutationSurface,
  type ViewportProfileName,
  type ViewportDimension,
} from "./types.ts";
export class PermutationGridManager {
  private readonly grid: readonly PermutationSurface[] = THEME_PERMUTATION_GRID;

  public getAllPermutations(): readonly PermutationSurface[] {
    return this.grid;
  }

  public getPermutationsByTheme(theme: ThemeMode): PermutationSurface[] {
    return this.grid.filter((p) => p.theme === theme);
  }

  public getPermutationsByViewport(viewport: ViewportProfileName): PermutationSurface[] {
    return this.grid.filter((p) => p.viewport === viewport);
  }

  public getPermutation(permutationId: string): PermutationSurface {
    const found = this.grid.find((p) => p.permutationId === permutationId);
    if (!found) {
      throw new HarnessError(
        "NOT_FOUND",
        `Permutation surface '${permutationId}' does not exist in 12-Permutation Surface Grid.`,
      );
    }
    return found;
  }

  public verifyFullMatrixCoverage(testedPermutationIds: readonly string[]): {
    covered: boolean;
    totalExpected: number;
    testedCount: number;
    missingPermutations: string[];
    coveragePercent: number;
  } {
    const testedSet = new Set(testedPermutationIds);
    const missing = this.grid.map((p) => p.permutationId).filter((id) => !testedSet.has(id));

    const totalExpected = this.grid.length;
    const testedCount = totalExpected - missing.length;
    const coveragePercent = Math.round((testedCount / totalExpected) * 100);

    return {
      covered: missing.length === 0,
      totalExpected,
      testedCount,
      missingPermutations: missing,
      coveragePercent,
    };
  }
}

/**
 * ============================================================================
 * 2. Automated Mathematical Contrast Calculation (WCAG 2.1 & APCA)
 * ============================================================================
 */
