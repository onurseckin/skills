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

export interface ObjectArgumentProperty {
  readonly name: string;
  readonly emptyLiteral: boolean;
  readonly valueText: string;
}

export type ArgumentShape =
  | { readonly kind: "opaque"; readonly text: string }
  | { readonly kind: "undefined" }
  | { readonly kind: "object"; readonly properties: readonly ObjectArgumentProperty[] };

export interface EngineInvocation {
  readonly name: string;
  readonly path: string;
  readonly line: number;
  readonly argumentCount: number;
  readonly argumentShapes: readonly ArgumentShape[];
}

export interface OptionReadSet {
  readonly decidable: boolean;
  readonly names: ReadonlySet<string>;
  readonly reason: string;
}

export interface InvocationVoidness {
  readonly voided: boolean;
  readonly reason: string;
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
