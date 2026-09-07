export const ENGINE_RESULT_TYPE = "DoctorCheckEngineResult";

export type WiringDefectCondition = "exported-but-never-invoked" | "invoked-but-cannot-fail";

export interface SourceDocument {
  readonly path: string;
  readonly text: string;
}

export interface EngineDeclaration {
  readonly name: string;
  readonly path: string;
  readonly line: number;
  readonly parameterCount: number;
  readonly emptyObjectDefault: boolean;
}

export interface EngineInvocation {
  readonly name: string;
  readonly path: string;
  readonly line: number;
  readonly argumentCount: number;
}

export interface WiringDefect {
  readonly engine: string;
  readonly condition: WiringDefectCondition;
  readonly declaredAt: string;
  readonly evidence: string;
}

export interface EngineWiringReport {
  readonly exportedEngines: readonly string[];
  readonly invokedEngines: readonly string[];
  readonly declarations: readonly EngineDeclaration[];
  readonly invocations: readonly EngineInvocation[];
  readonly defects: readonly WiringDefect[];
  readonly introduced: readonly WiringDefect[];
  readonly accepted: readonly WiringDefect[];
  readonly resolved: readonly string[];
  readonly passed: boolean;
}

export function defectKey(defect: WiringDefect): string {
  return `${defect.engine}|${defect.condition}`;
}
