# Authority & Policy Lead Audit Blueprint: Manifest Parser & Schema

## 1. Exact Findings Count

**Total Things to Look For:** 14

## 2. Call Graph & State Transition Trace

- **Entry Points:** `parseUnifiedAgentManifest` -> `yaml.load`
- **Alternative Entry Points:** `parseYaml` -> `parseBlock` -> `parseBlockScalar` / `parseFlowSequence` / `parseFlowMapping`
- **Callers:** Agent bootstrapper, validation hooks.
- **State Transitions:**
  - `parseYaml` processes raw strings through state machine to generate an AST.
  - Recursively calls block handlers resulting in a parsed manifest object.

## 3. Native Host Tool Interaction

- `findSkillRoot` limits tree traversal to a hardcoded depth, which can fail in monorepo structures.
- Heavily utilized during `invoke_subagent` and `define_subagent` to load correct role context and validation schemas.
- Synchronous file reads `readFileSync` interact poorly with the non-blocking execution model, causing main-thread stutter during mass dispatch.

## 4. Edge Cases, Failure Vectors, & LLM Friction Points

- **Hand-rolled YAML parsing (manifest-parser.ts):** The `parseYaml` function is a fragile 500+ line manual implementation, while `manifest-schema.ts` already correctly imports and uses `js-yaml`.
- **Infinite loop / Stack Overflow risks:** `parseBlock` recursion can blow the call stack for deeply nested payloads.
- **Array as Object edge case (manifest-schema.ts):** `typeof doc !== "object"` allows arrays to pass through, leading to undefined behavior when accessing properties like `doc.permissions`.
- **Anchor & Alias failures:** The manual YAML parser does not support YAML anchors (`&`) or aliases (`*`).
- **Path traversal limits:** `findSkillRoot` limits tree traversal to a hardcoded `depth < 5`, failing in deeply nested monorepo structures.
- **Inconsistent file reading:** `readFileSync` is used synchronously, blocking the main thread during manifest loads.
- **String split edge cases:** `split(/\r?\n/)` is used, ignoring legacy Mac `\r` line endings.
- **Regex performance:** Complex regexes in scalar parsing could lead to ReDoS vulnerabilities.
- **Manual type guarding (manifest-schema.ts):** Overly verbose manual type checking instead of a robust schema validator like Zod.
- **Silent fallback to cwd:** `findSkillRoot` falls back to `process.cwd()` which might be completely unrelated to the skill root if invoked from a different context.
- **Type casting violations:** Heavy use of `as Record<string, unknown>` and `as unknown[]` masking true types.
- **Missing error contexts:** `parseYaml` swallows syntax errors by returning partial parsed objects or empty objects.
- **Redundant role mappings:** `ROLE_ALIASES` hardcodes tiers and aliases which should ideally be dynamically driven by the manifests.
- **Lack of JSON superset support:** The manual parser attempts to `JSON.parse` first but fails on inline JSON arrays within YAML blocks.

## 5. TypeScript Refactoring Blueprints & Simplification Proposals

- **Blueprint A:** Delete the entire hand-rolled `parseYaml` and `parseMarkdownFrontmatter` YAML logic in `manifest-parser.ts`. Replace with `js-yaml` (already imported in `manifest-schema.ts`) and `gray-matter` for frontmatter.
- **Blueprint B:** Replace manual validations in `manifest-schema.ts` with `zod` schemas to guarantee compile-time and runtime type safety.
