# Domain 2: CLI Engine & Zero-JSON Shield Polish

## Overview

This document records the completion of residual polish tasks for the CLI Engine & Zero-JSON Shield as part of Audit 2.

## Implemented Changes

1. **`execute.ts` and `registry` cleanup:**
   - Moved `PLAN_BRAINSTORM_SPEC` out of `execute.ts`.
   - Registered it properly within `registry/plan.ts`.
   - Updated `execute.ts` to directly use `findCommand` via the dynamic registry lookup without hardcoding edge cases.

2. **`harness.ts` top-level error handling:**
   - Modified the top-level `.catch()` block under `import.meta.main`.
   - Utilized `stripOutputFormat(argv)` to intelligently decide error formatting.
   - Any pre-execution error (such as stdin parsing or invalid arguments) is now formatted cleanly as a Markdown error message if the `--format=json` flag was not supplied, rather than dumping a raw JSON structure `{"ok": false, ...}`.

3. **`output-format.ts` strict token parsing:**
   - Replaced complex and fragile index arithmetic (`argv.some`, `argv.filter`) in `stripOutputFormat()` with a clean, single-pass loop.
   - Handled `--format=json` and `--format json` forms explicitly, safely stripping arguments and preserving intent without false positives.
   - Enforced strict typing for `noUncheckedIndexedAccess`.

## Status

All assigned domain requirements are fully implemented, strict `bun run typecheck` (0 `any`, 0 `@ts-ignore`) passes successfully, and the CLI Engine now provides a stronger Zero-JSON Shield surface.
