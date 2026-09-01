/**
 * @file index.ts
 * Root Facade for tests/docs/ test domain
 */

export { DOCS_BOOK_SUITES } from "./book/index.ts";
export { DOCS_ARCHITECTURE_SUITES } from "./architecture/index.ts";

export const DOCS_ALL_SUITES = [...DOCS_BOOK_SUITES, ...DOCS_ARCHITECTURE_SUITES] as const;
