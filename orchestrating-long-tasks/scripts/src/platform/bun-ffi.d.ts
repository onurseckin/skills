declare module "bun:ffi" {
  export const FFIType: { readonly i32: "i32"; readonly ptr: "ptr" };
  export const read: {
    i32(pointer: number | bigint, offset?: number): number;
  };
  export function dlopen<T extends Record<string, unknown>>(
    path: string,
    symbols: T,
  ): {
    symbols: { [K in keyof T]: (...arguments_: number[]) => number | bigint };
    close(): void;
  };
}
