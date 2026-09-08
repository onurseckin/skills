---
description: TypeScript style guidelines enforcing zero comments, zero any, zero suppressions, and explicit typing standards
globs:
  - "**/*.ts"
  - "**/*.tsx"
alwaysApply: true
---

# TypeScript Style & Code Quality Rules

- Zero Comments Invariant: absolute ban on comments in .ts and .tsx files. No JSDoc, no inline explanations, no header blocks, no commented-out code.
- Zero TypeScript any: absolute ban on `any` in annotations, casts, generic defaults, and implicit any. Replace with `unknown` + type guards or narrow interfaces.
- Zero Compiler Suppressions: absolute ban on `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`, `oxlint-disable`, and `v8 ignore`.
- Ban on Type Laundering: `as unknown as Target` is forbidden unless strictly required by 3rd-party library typing boundaries and reported explicitly.
- Modularity: maximum 400 physical lines per file.

## Detailed Requirements

### 1. Zero Comments Invariant

- Absolute ban on comments in all `.ts` and `.tsx` files.
- Prohibited:
  - Single-line comments (`//`)
  - Multi-line / block comments (`/* ... */`)
  - JSDoc docstrings (`/** ... */`)
  - Header or copyright comment blocks
  - Commented-out code fragments
- Code must be self-documenting through precise identifiers, explicit types, and clean abstractions.

### 2. Zero TypeScript `any`

- Absolute ban on `any`:
  - Type annotations: no `val: any`
  - Type casts / assertions: no `as any` or `<any>`
  - Generic type defaults: no `<T = any>`
  - Function parameters or return types: no `any`
  - Implicit `any`
- Alternatives:
  - Use `unknown` with runtime type guards (e.g., `typeof`, `instanceof`, custom assertion functions, schema validators).
  - Define narrow interfaces, discriminated unions, or structural record shapes (e.g., `Record<string, unknown>`).

### 3. Zero Compiler and Linter Suppressions

- Absolute ban on compiler, linter, and coverage suppressions:
  - TypeScript: `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`
  - ESLint: `eslint-disable`, `eslint-disable-line`, `eslint-disable-next-line`
  - Oxlint: `oxlint-disable`, `oxlint-disable-line`, `oxlint-disable-next-line`
  - V8 Coverage: `/* v8 ignore ... */`, `/* c8 ignore ... */`
- Any type errors or lint warnings must be resolved by fixing the underlying code, not by suppressing checks.

### 4. Ban on Type Laundering

- `as unknown as Target` type laundering is forbidden.
- Forcing types through double-assertions bypasses the compiler's structural verification.
- Narrow data properly using:
  - Type guards and user-defined type predicates.
  - Validation schemas (e.g., Zod, ArkType, or bespoke validators).
  - Explicit transformation and parsing routines.
- Exception: Strictly limited to external, un-typed third-party library boundaries where no other typing mechanism is viable; any such exception must be explicitly documented and reported outside of source comments.

### 5. Modularity and File Size Limit

- Every `.ts` and `.tsx` file must not exceed 400 physical lines of code.
- Files approaching this limit must be decomposed into focused, single-responsibility modules within dedicated subdirectories or companion files.
