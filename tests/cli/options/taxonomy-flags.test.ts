import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  CATEGORY_FLAG_HELP,
  declaredToolFlags,
  tokenExtraFlags,
  toolRefFlags,
} from "../../../../olt/scripts/src/cli/taxonomy-flags.ts";

describe("taxonomy-flags", () => {
  test("CATEGORY_FLAG_HELP is defined and non-empty", () => {
    expect(CATEGORY_FLAG_HELP).toBeDefined();
    expect(CATEGORY_FLAG_HELP.length).toBeGreaterThan(0);
    expect(CATEGORY_FLAG_HELP).toContain("Generic category of the tool");
  });

  describe("toolRefFlags", () => {
    test("returns undefined when no tool flag is provided and no tool-extra flag is provided", () => {
      expect(toolRefFlags({})).toBeUndefined();
    });

    test("parses plain tool flags without categories", () => {
      const refs = toolRefFlags({
        tool: ["read_file", "write_file"],
      });
      expect(refs).toEqual([{ name: "read_file" }, { name: "write_file" }]);
    });

    test("parses tool flags with category annotations", () => {
      const refs = toolRefFlags({
        tool: ["read_file=file_system", "run_command=shell"],
      });
      expect(refs).toEqual([
        { name: "read_file", category: "file_system" },
        { name: "run_command", category: "shell" },
      ]);
    });

    test("parses tool flags with associated tool-extra metadata", () => {
      const refs = toolRefFlags({
        tool: ["bash=shell", "browser=navigation"],
        "tool-extra": ["bash:timeout=30", "bash:env=prod", "browser:headless=true"],
      });
      expect(refs).toEqual([
        {
          name: "bash",
          category: "shell",
          extras: {
            timeout: "30",
            env: "prod",
          },
        },
        {
          name: "browser",
          category: "navigation",
          extras: {
            headless: "true",
          },
        },
      ]);
    });

    test("throws HarnessError on duplicate tool names", () => {
      expect(() => {
        toolRefFlags({
          tool: ["read_file", "read_file"],
        });
      }).toThrow(HarnessError);
    });

    test("throws HarnessError on orphan tool-extra without matching tool flag", () => {
      expect(() => {
        toolRefFlags({
          "tool-extra": ["orphan_tool:key=val"],
        });
      }).toThrow(HarnessError);

      expect(() => {
        toolRefFlags({
          tool: ["registered_tool"],
          "tool-extra": ["orphan_tool:key=val"],
        });
      }).toThrow(HarnessError);
    });

    test("throws HarnessError on duplicate tool-extra key for the same tool", () => {
      expect(() => {
        toolRefFlags({
          tool: ["bash"],
          "tool-extra": ["bash:timeout=30", "bash:timeout=60"],
        });
      }).toThrow(HarnessError);
    });

    test("throws HarnessError on malformed tool-extra syntax", () => {
      expect(() => {
        toolRefFlags({
          tool: ["bash"],
          "tool-extra": ["invalid_format_without_colon"],
        });
      }).toThrow(HarnessError);

      expect(() => {
        toolRefFlags({
          tool: ["bash"],
          "tool-extra": ["bash:key_without_equal"],
        });
      }).toThrow(HarnessError);

      expect(() => {
        toolRefFlags({
          tool: ["bash"],
          "tool-extra": [":key=val"],
        });
      }).toThrow(HarnessError);
    });

    test("throws HarnessError on malformed tool= category syntax", () => {
      expect(() => {
        toolRefFlags({
          tool: ["tool_without_cat="],
        });
      }).toThrow(HarnessError);

      expect(() => {
        toolRefFlags({
          tool: ["=category_without_tool"],
        });
      }).toThrow(HarnessError);
    });
  });

  describe("tokenExtraFlags", () => {
    test("returns undefined when token-extra flag is not provided", () => {
      expect(tokenExtraFlags({})).toBeUndefined();
    });

    test("parses valid token-extra counters", () => {
      const counters = tokenExtraFlags({
        "token-extra": ["prompt_tokens=150", "completion_tokens=300", "zero_count=0"],
      });
      expect(counters).toEqual({
        prompt_tokens: 150,
        completion_tokens: 300,
        zero_count: 0,
      });
    });

    test("throws HarnessError on duplicate token-extra counter name", () => {
      expect(() => {
        tokenExtraFlags({
          "token-extra": ["tokens=100", "tokens=200"],
        });
      }).toThrow(HarnessError);
    });

    test("throws HarnessError on invalid non-integer or negative count", () => {
      expect(() => {
        tokenExtraFlags({
          "token-extra": ["tokens=-5"],
        });
      }).toThrow(HarnessError);

      expect(() => {
        tokenExtraFlags({
          "token-extra": ["tokens=12.34"],
        });
      }).toThrow(HarnessError);

      expect(() => {
        tokenExtraFlags({
          "token-extra": ["tokens=not_a_number"],
        });
      }).toThrow(HarnessError);
    });

    test("throws HarnessError on malformed token-extra entry without equal sign", () => {
      expect(() => {
        tokenExtraFlags({
          "token-extra": ["invalid_format"],
        });
      }).toThrow(HarnessError);
    });
  });

  describe("declaredToolFlags", () => {
    test("returns empty object when no tool flags are provided", () => {
      expect(declaredToolFlags({})).toEqual({});
    });

    test("parses tool and toolCategory", () => {
      expect(
        declaredToolFlags({
          tool: "git_diff",
          "tool-category": "vcs",
        }),
      ).toEqual({
        tool: "git_diff",
        toolCategory: "vcs",
      });
    });

    test("parses tool with tool-extra key-value pairs", () => {
      expect(
        declaredToolFlags({
          tool: "git_diff",
          "tool-extra": ["staged=true", "cached=false"],
        }),
      ).toEqual({
        tool: "git_diff",
        toolExtras: {
          staged: "true",
          cached: "false",
        },
      });
    });

    test("throws HarnessError on tool-extra without tool", () => {
      expect(() => {
        declaredToolFlags({
          "tool-extra": ["key=value"],
        });
      }).toThrow(HarnessError);
    });

    test("throws HarnessError on duplicate key in tool-extra for single tool", () => {
      expect(() => {
        declaredToolFlags({
          tool: "my_tool",
          "tool-extra": ["k=v1", "k=v2"],
        });
      }).toThrow(HarnessError);
    });
  });
});
