export interface ReportDagFlags {
  readonly [key: string]: string | boolean | number | undefined;
  readonly run?: string;
  readonly "run-id"?: string;
  readonly repo?: string;
  readonly detailed?: boolean;
  readonly recommendations?: boolean;
  readonly "box-style"?: "rounded" | "sharp" | "ascii";
  readonly all?: boolean;
  readonly json?: boolean;
}

export interface ReportUnifiedFlags {
  readonly [key: string]: string | boolean | number | undefined;
  readonly run?: string;
  readonly "run-id"?: string;
  readonly repo?: string;
  readonly detailed?: boolean;
  readonly json?: boolean;
}
