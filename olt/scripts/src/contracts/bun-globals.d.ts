interface BunRuntimeGlobal {
  readonly argv: string[];
  readonly version: string;
  readonly TOML: {
    parse(input: string): unknown;
  };
}

declare const Bun: BunRuntimeGlobal;
