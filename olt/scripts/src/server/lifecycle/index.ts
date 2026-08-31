/**
 * Dev Server Lifecycle & State Preservation Subsystem.
 *
 * Provides dev server lifecycle coordination, atomic restart locking, state snapshot
 * preservation (active endpoints, environment variables, PID history, port configurations,
 * run flags), graceful SIGTERM/SIGKILL shutdown, and transactional rollback on failure.
 */

export * from "./types.ts";
export * from "./snapshot.ts";
export * from "./lock.ts";
export * from "./shutdown.ts";
export * from "./starter.ts";
export * from "./coordinator.ts";
