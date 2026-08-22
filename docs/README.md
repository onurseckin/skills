# Repository Documentation

Welcome to the central documentation directory for the **`@onurseckin/skills`** multi-skill repository.

## 🏛️ Scope & Documentation Invariants

Root `docs/` is **strictly reserved** for repository-wide multi-skill collection guidelines, quality gates, packaging standards, and repository-level governance.

### Architectural Invariants:
1. **No Individual Skill Runtime Docs in Root `docs/`:**
   - All documentation specific to an individual skill (such as role definitions, reference guides, protocol specifications, checklists, and state models) resides strictly inside that skill's dedicated directory (e.g., `orchestrating-long-tasks/references/`, `orchestrating-long-tasks/roles/`, `orchestrating-long-tasks/mind/`).
   - `orchestrating-long-tasks/docs/` is prohibited and must not exist.
2. **No Stale Planning Files:**
   - Static execution planning directories (e.g., `docs/planning/`) are prohibited. Active execution state lives dynamically in `.capsules/<run-id>/`.
3. **Repository-Wide Guidelines Only:**
   - Root `docs/` houses only repository-wide authoring, packaging, and governance policies.

---

## 📚 Core Repository Guidelines

- [**Skill Collection Guidelines**](./SKILL_COLLECTION_GUIDELINES.md): Comprehensive guidelines for authoring, packaging, validating, and governing skills across this monorepo.
