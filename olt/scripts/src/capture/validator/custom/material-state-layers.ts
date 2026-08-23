import type { ElementPhysicsSnapshot, ValidationDefect } from "../types.ts";
import { generateRemediations } from "../synthesis/remediation-generator.ts";

interface MD3LayerSpec {
  readonly target: number;
  readonly min: number;
  readonly max: number;
}

const MD3_SPECS: Readonly<Record<string, MD3LayerSpec>> = {
  hover: { target: 0.08, min: 0.06, max: 0.1 },
  focus: { target: 0.12, min: 0.1, max: 0.14 },
  pressed: { target: 0.12, min: 0.1, max: 0.14 },
  dragged: { target: 0.16, min: 0.14, max: 0.18 },
};

export function validateMaterialStateLayers(
  element: ElementPhysicsSnapshot,
  index: number,
): ValidationDefect | null {
  const layers = element.stateLayers;
  if (!layers) return null;

  const violations: string[] = [];

  for (const [state, spec] of Object.entries(MD3_SPECS)) {
    const actualOpacity = layers[state];
    if (actualOpacity !== undefined) {
      if (actualOpacity < spec.min || actualOpacity > spec.max) {
        violations.push(
          `${state} opacity ${(actualOpacity * 100).toFixed(0)}% (expected ${(spec.target * 100).toFixed(0)}%)`,
        );
      }
    }
  }

  if (violations.length > 0) {
    return {
      id: `cust-md3-layers-${index}`,
      pillar: "custom",
      category: "md3-state-layers",
      elementSelector: element.selector,
      message: `Material Design 3 state layer deviation: ${violations.join(", ")}.`,
      severity: "moderate",
      remediations: generateRemediations("md3-state-layers"),
      metadata: {
        violations: violations.join("; "),
      },
    };
  }

  return null;
}
