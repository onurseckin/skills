# Authority & Policy Lead Audit Blueprint: Repo Policy

## 1. Exact Findings Count

**Total Things to Look For:** 8

## 2. Call Graph & State Transition Trace

- `detectRepoEcosystem(repoRoot)` -> Determines ecosystem (`bun`, `cargo`, `python`, `node`, `unknown`).
- `generateDefaultRepoPolicy(repoRoot)` -> Hydrates defaults based on ecosystem.
- `validateRepoPolicy(raw)` -> Coerces and type-checks the raw JSON object.
- `loadRepoPolicy(repoRoot, customPath)` -> (Entry Point) Reads file -> Parses JSON -> calls `validateRepoPolicy` or falls back to `generateDefaultRepoPolicy`.
- `saveRepoPolicy(policy)` -> Validates -> Writes to disk.
- `initRepoPolicy(repoRoot)` -> Generates default -> Saves to disk -> Returns policy.

## 3. Native Host Tool Interaction

- Configures default, allowed, and forbidden commands (e.g., `bun test`, `cargo test`, `git push`, `rm -rf /`).
- These configurations actively restrict what the RBAC engine permits during `invoke_subagent` and `run_command` cycles.

## 4. Edge Cases, Failure Vectors & LLM Friction Points

1. **L61**: `repoRoot ? resolve(repoRoot) : findRepoRoot()` - If `findRepoRoot` throws or is undefined, it fails abruptly without graceful degradation.
2. **L63-L86**: Monorepo ecosystem collision. It checks for lockfiles sequentially. The first match wins (e.g., if both `bun.lock` and `Cargo.toml` exist, it assigns `bun`), completely ignoring secondary ecosystems.
3. **L159**: Python package manager misdetection. It assumes `poetry` only if `poetry.lock` exists. `pyproject.toml` projects using `uv` or modern pip are forced into fallback categories.
4. **L188**: Node package manager collision. It checks `pnpm` > `yarn` > `npm`. Same monorepo collision risk.
5. **L229-L377**: Manual `typeof` validation chain. Over 15 properties are validated manually instead of using a schema validator. Huge friction point if complex shapes are added.
6. **L254/L262**: Missing string type guard before `trim()` on nested objects in test runners. If a user passes an array for a command, `.trim()` throws and halts orchestration.
7. **L305-L320**: `reviewProtocol` uses `Number.isSafeInteger` and `>= 1`. If invalid, it silently overwrites the user's config with the default instead of alerting them.
8. **L404**: Silent bare catch on JSON parse in `loadRepoPolicy`. If the policy JSON is malformed, it silently returns the default policy. **Critical vector**: User constraints are silently dropped!

## 5. TypeScript Refactoring Blueprints & Simplification Proposals

- **Zod Integration**: Replace the massive `validateRepoPolicy` function with a strict Zod schema (`z.object({...}).strict()`).
- **Throw on Invalid Policy**: Modify `loadRepoPolicy` to log or throw explicit parsing errors. Dropping a malformed policy silently is a major integrity violation.
- **Monorepo Awareness**: Upgrade `detectRepoEcosystem` to return an array of active ecosystems `RepoEcosystem[]` and merge their allowed command arrays.
