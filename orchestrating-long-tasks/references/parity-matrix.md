# Parity Matrix & Host Capabilities

This document provides two authoritative parity references:

1. **Agent Host Feature Parity Matrix**: Capabilities and subagent mechanics across supported AI assistant hosts.
2. **Oracle Migration Parity Record**: The 65-behavior baseline verified during the pure-Bun runtime migration.

---

## 1. Agent Host Feature Parity Matrix

| Feature / Capability                           |      Google Antigravity       |       Anthropic Claude Code        |    OpenAI Codex / ChatGPT    |     Generic Subagent CLI     |
| :--------------------------------------------- | :---------------------------: | :--------------------------------: | :--------------------------: | :--------------------------: |
| **Two-Tier Orchestration**                     |  Native (`invoke_subagent`)   | Native (`Agent Teams` / Teammates) |  Native (Subagent Dispatch)  |  Scripted Fork / Subprocess  |
| **Triad Floor ($2N+1$ Sizing)**                | Supported (Batch `Subagents`) |  Supported (Concurrent Teammates)  |   Supported (Batch Runner)   |   Supported (Process Pool)   |
| **Zero-JSON CLI Briefs**                       |   Supported (`<= 30` lines)   |     Supported (`<= 30` lines)      |  Supported (`<= 30` lines)   |  Supported (`<= 30` lines)   |
| **Structured Pushbacks (`task:reject`)**       |           Supported           |             Supported              |          Supported           |          Supported           |
| **Dual-Channel Visual Validation**             | Supported (Playwright + DOM)  |    Supported (Playwright + DOM)    | Supported (Playwright + DOM) | Supported (Playwright + DOM) |
| **Cascading Scope Replanning (`plan:replan`)** |           Supported           |             Supported              |          Supported           |          Supported           |
| **GVUI Graph Export (`summary:export`)**       |           Supported           |             Supported              |          Supported           |          Supported           |
| **Posix Inode Kernel Locking (`flock`)**       |           Supported           |             Supported              |          Supported           |          Supported           |
| **Subagent Messaging (`send_message`)**        |            Direct             |               Direct               |            Direct            |          IPC / Pipe          |
| **Crash & Lease Recovery**                     |   Deterministic (`recover`)   |     Deterministic (`recover`)      |  Deterministic (`recover`)   |  Deterministic (`recover`)   |

---

## 2. Oracle Migration Parity Record (65-Behavior Baseline)

On 2026-08-13, the temporary Python oracle passed 31 storage tests and 34 planning tests immediately before retirement. The mapped Bun suites passed in the same workspace; the TypeScript tests remain authoritative after the oracle is removed.

### Storage Oracle — 31 Behaviors

| Python oracle behavior                                                | Bun test file                           |
| --------------------------------------------------------------------- | --------------------------------------- |
| `test_atomic_write_sets_mode_before_syncing_content`                  | `tests/core/durable-runtime.test.ts`    |
| `test_collision_invalid_run_ids_and_blank_actor_are_rejected`         | `tests/store/capsule-integrity.test.ts` |
| `test_corrupt_complete_event_is_rejected_by_verify_and_recovery`      | `tests/store/events-recovery.test.ts`   |
| `test_deep_event_json_is_reported_as_integrity_error`                 | `tests/store/events-recovery.test.ts`   |
| `test_deep_state_json_is_reported_as_integrity_error`                 | `tests/store/capsule-integrity.test.ts` |
| `test_empty_event_log_cannot_fabricate_recovery_history`              | `tests/store/events-recovery.test.ts`   |
| `test_event_validation_streams_multiple_records_without_read_bytes`   | `tests/store/events-recovery.test.ts`   |
| `test_external_runtime_source_is_allowed`                             | `tests/core/durable-runtime.test.ts`    |
| `test_init_preserves_prompt_and_records_assurance_and_structure`      | `tests/store/capsule-integrity.test.ts` |
| `test_json_size_limits_are_integrity_issues`                          | `tests/store/capsule-integrity.test.ts` |
| `test_kernel_lock_blocks_an_independent_process_until_release`        | `tests/platform/lock.test.ts`           |
| `test_lock_with_missing_owner_is_retained_fail_closed`                | `tests/platform/lock.test.ts`           |
| `test_manifest_and_state_use_bounded_descriptor_reads`                | `tests/core/json-paths.test.ts`         |
| `test_manifest_run_id_and_prompt_digest_format_are_verified`          | `tests/store/capsule-integrity.test.ts` |
| `test_mutate_exception_does_not_append_or_advance_state`              | `tests/store/transaction.test.ts`       |
| `test_mutated_projection_is_normalized_to_json_types`                 | `tests/store/transaction.test.ts`       |
| `test_nested_lock_times_out_without_removing_owner_lock`              | `tests/platform/lock.test.ts`           |
| `test_oversized_event_is_bounded_without_path_read_bytes`             | `tests/store/events-recovery.test.ts`   |
| `test_projection_shape_rejects_boolean_revision_even_with_valid_hash` | `tests/store/events-recovery.test.ts`   |
| `test_recovery_ignores_but_preserves_only_a_torn_final_fragment`      | `tests/store/events-recovery.test.ts`   |
| `test_recovery_ignores_valid_final_event_without_newline`             | `tests/store/events-recovery.test.ts`   |
| `test_recovery_rebuilds_stale_state_from_last_complete_event`         | `tests/store/events-recovery.test.ts`   |
| `test_replaced_lock_and_renamed_owned_lock_are_retained`              | `tests/platform/lock.test.ts`           |
| `test_runtime_directory_is_copied_and_integrity_bound`                | `tests/core/durable-runtime.test.ts`    |
| `test_runtime_integrity_binds_directory_modes`                        | `tests/core/durable-runtime.test.ts`    |
| `test_runtime_integrity_binds_empty_directories`                      | `tests/core/durable-runtime.test.ts`    |
| `test_runtime_source_change_during_copy_aborts_and_cleans_capsule`    | `tests/store/capsule-integrity.test.ts` |
| `test_runtime_sources_reject_symlinks_and_non_directories`            | `tests/core/durable-runtime.test.ts`    |
| `test_safe_repo_path_rejects_absolute_parent_and_symlink_escape`      | `tests/core/json-paths.test.ts`         |
| `test_transactions_advance_hash_chain_and_projection_together`        | `tests/store/events-recovery.test.ts`   |
| `test_verified_load_rejects_prompt_mutation`                          | `tests/store/capsule-integrity.test.ts` |

### Requirements, Graph, Plan, and Scheduler Oracle — 34 Behaviors

| Python oracle behavior                                                    | Bun test file                             |
| ------------------------------------------------------------------------- | ----------------------------------------- |
| `test_apply_rejects_unhashable_nested_values_as_harness_errors`           | `tests/graph/plan-application.test.ts`    |
| `test_batch_excludes_identical_and_ancestor_descendant_write_conflicts`   | `tests/scheduler/batch.test.ts`           |
| `test_batch_honors_dependencies_max_parallel_and_deep_copy_safety`        | `tests/scheduler/batch.test.ts`           |
| `test_batch_ranking_is_deterministic_in_the_documented_direction`         | `tests/scheduler/batch.test.ts`           |
| `test_context_constraint_and_non_actionable_lines_need_rationales`        | `tests/requirements/traceability.test.ts` |
| `test_dependency_edges_point_from_task_to_prerequisite`                   | `tests/graph/dependencies.test.ts`        |
| `test_dependency_map_rejects_invalid_graphs`                              | `tests/graph/dependencies.test.ts`        |
| `test_duplicate_edges_unknown_endpoints_and_malformed_types_are_rejected` | `tests/graph/contracts.test.ts`           |
| `test_effort_rejects_huge_integer_without_overflow`                       | `tests/graph/contracts.test.ts`           |
| `test_every_nonblank_line_is_disposed_exactly_once`                       | `tests/requirements/traceability.test.ts` |
| `test_exact_excerpt_and_utf8_prompt_digest_are_required`                  | `tests/requirements/traceability.test.ts` |
| `test_execution_active_tasks_preserve_every_contract_field`               | `tests/graph/plan-revision.test.ts`       |
| `test_execution_cycle_is_rejected_but_relational_topic_cycle_is_allowed`  | `tests/graph/dependencies.test.ts`        |
| `test_full_requirement_task_and_mandatory_gate_coverage_is_required`      | `tests/graph/contracts.test.ts`           |
| `test_invalid_and_duplicate_requirement_and_acceptance_ids_are_rejected`  | `tests/requirements/malformed.test.ts`    |
| `test_invalid_apply_does_not_advance_state_or_events`                     | `tests/graph/plan-application.test.ts`    |
| `test_long_dependency_chain_validates_and_schedules_iteratively`          | `tests/graph/dependencies.test.ts`        |
| `test_malformed_requirement_types_and_boolean_integers_are_rejected`      | `tests/requirements/malformed.test.ts`    |
| `test_plan_application_is_audited_and_initializes_scheduler_projection`   | `tests/graph/plan-application.test.ts`    |
| `test_plan_files_must_be_regular_non_symlink_json_objects`                | `tests/graph/plan-application.test.ts`    |
| `test_plan_symlink_is_rejected_without_o_nofollow_support`                | `tests/graph/plan-application.test.ts`    |
| `test_ready_status_is_rejected_when_prerequisites_are_not_done`           | `tests/graph/contracts.test.ts`           |
| `test_requirement_status_must_be_exactly_planned`                         | `tests/requirements/traceability.test.ts` |
| `test_revision_archives_exact_prior_documents_as_immutable_history`       | `tests/graph/plan-revision.test.ts`       |
| `test_revision_cannot_change_done_task_dependencies`                      | `tests/graph/plan-revision.test.ts`       |
| `test_revision_cannot_change_running_task_dependencies`                   | `tests/graph/plan-revision.test.ts`       |
| `test_revision_cannot_downgrade_ready_task_to_hide_unfinished_dependency` | `tests/graph/plan-revision.test.ts`       |
| `test_revision_must_increase_by_exactly_one`                              | `tests/graph/plan-application.test.ts`    |
| `test_revision_rejects_requirement_source_changes_and_done_task_changes`  | `tests/graph/plan-revision.test.ts`       |
| `test_stale_expected_state_revision_is_rejected_without_mutation`         | `tests/graph/plan-application.test.ts`    |
| `test_tasks_need_valid_requirements_normalized_scopes_and_artifacts`      | `tests/graph/contracts.test.ts`           |
| `test_unhashable_nested_graph_values_return_issues`                       | `tests/graph/contracts.test.ts`           |
| `test_unhashable_nested_requirement_values_return_issues`                 | `tests/requirements/malformed.test.ts`    |
| `test_valid_revision_preserves_satisfied_and_done_runtime_history`        | `tests/graph/plan-revision.test.ts`       |
