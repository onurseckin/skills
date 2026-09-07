export interface CognitiveValidatorCommandLockOptions {
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly commands?: Readonly<Record<string, unknown>> | readonly unknown[] | null | undefined;
  readonly events?: readonly unknown[] | null | undefined;
  readonly grants?: readonly unknown[] | null | undefined;
}
