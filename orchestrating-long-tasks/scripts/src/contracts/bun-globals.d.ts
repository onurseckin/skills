interface BunRuntimeGlobal {
  readonly argv: string[];
  readonly version: string;
}

declare const Bun: BunRuntimeGlobal;
