export type KeyModifier = "ctrl" | "alt" | "shift";

export type SpecialKey =
  | "up"
  | "down"
  | "left"
  | "right"
  | "page_up"
  | "page_down"
  | "home"
  | "end"
  | "insert"
  | "delete"
  | "enter"
  | "tab"
  | "backtab"
  | "backspace"
  | "escape"
  | "space"
  | "f1"
  | "f2"
  | "f3"
  | "f4"
  | "f5"
  | "f6"
  | "f7"
  | "f8"
  | "f9"
  | "f10"
  | "f11"
  | "f12";

export interface KeyStroke {
  readonly char: string;
  readonly special?: SpecialKey | undefined;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly raw: string;
}

const SPECIAL_SEQUENCES: Readonly<Record<string, { special: SpecialKey; ctrl?: boolean; alt?: boolean; shift?: boolean }>> = {
  "\x1b[A": { special: "up" },
  "\x1b[B": { special: "down" },
  "\x1b[C": { special: "right" },
  "\x1b[D": { special: "left" },
  "\x1bOA": { special: "up" },
  "\x1bOB": { special: "down" },
  "\x1bOC": { special: "right" },
  "\x1bOD": { special: "left" },
  "\x1b[1;2A": { special: "up", shift: true },
  "\x1b[1;2B": { special: "down", shift: true },
  "\x1b[1;2C": { special: "right", shift: true },
  "\x1b[1;2D": { special: "left", shift: true },
  "\x1b[1;5A": { special: "up", ctrl: true },
  "\x1b[1;5B": { special: "down", ctrl: true },
  "\x1b[1;5C": { special: "right", ctrl: true },
  "\x1b[1;5D": { special: "left", ctrl: true },
  "\x1b[1;3A": { special: "up", alt: true },
  "\x1b[1;3B": { special: "down", alt: true },
  "\x1b[1;3C": { special: "right", alt: true },
  "\x1b[1;3D": { special: "left", alt: true },
  "\x1b[H": { special: "home" },
  "\x1b[F": { special: "end" },
  "\x1b[1~": { special: "home" },
  "\x1b[4~": { special: "end" },
  "\x1b[2~": { special: "insert" },
  "\x1b[3~": { special: "delete" },
  "\x1b[5~": { special: "page_up" },
  "\x1b[6~": { special: "page_down" },
  "\x1b[Z": { special: "backtab", shift: true },
  "\x1bOP": { special: "f1" },
  "\x1bOQ": { special: "f2" },
  "\x1bOR": { special: "f3" },
  "\x1bOS": { special: "f4" },
  "\x1b[15~": { special: "f5" },
  "\x1b[17~": { special: "f6" },
  "\x1b[18~": { special: "f7" },
  "\x1b[19~": { special: "f8" },
  "\x1b[20~": { special: "f9" },
  "\x1b[21~": { special: "f10" },
  "\x1b[23~": { special: "f11" },
  "\x1b[24~": { special: "f12" },
};

function parseSingleSequence(input: string): KeyStroke {
  if (input in SPECIAL_SEQUENCES) {
    const entry = SPECIAL_SEQUENCES[input];
    if (entry) {
      return {
        char: "",
        special: entry.special,
        ctrl: entry.ctrl ?? false,
        alt: entry.alt ?? false,
        shift: entry.shift ?? false,
        raw: input,
      };
    }
  }

  if (input === "\r" || input === "\n") {
    return { char: "\n", special: "enter", ctrl: false, alt: false, shift: false, raw: input };
  }
  if (input === "\t") {
    return { char: "\t", special: "tab", ctrl: false, alt: false, shift: false, raw: input };
  }
  if (input === "\x7f" || input === "\x08") {
    return { char: "", special: "backspace", ctrl: false, alt: false, shift: false, raw: input };
  }
  if (input === "\x1b") {
    return { char: "", special: "escape", ctrl: false, alt: false, shift: false, raw: input };
  }
  if (input === " ") {
    return { char: " ", special: "space", ctrl: false, alt: false, shift: false, raw: input };
  }

  if (input.length === 1) {
    const code = input.charCodeAt(0);
    if (code >= 1 && code <= 26 && code !== 9 && code !== 10 && code !== 13) {
      const char = String.fromCharCode(code + 96);
      return { char, ctrl: true, alt: false, shift: false, raw: input };
    }
    const isUpper = input >= "A" && input <= "Z";
    return { char: input, ctrl: false, alt: false, shift: isUpper, raw: input };
  }

  if (input.startsWith("\x1b") && input.length === 2) {
    const char = input[1] ?? "";
    return { char, ctrl: false, alt: true, shift: char >= "A" && char <= "Z", raw: input };
  }

  return { char: input, ctrl: false, alt: false, shift: false, raw: input };
}

export function parseKeySequence(buffer: Uint8Array | string): readonly KeyStroke[] {
  const text = typeof buffer === "string" ? buffer : new TextDecoder().decode(buffer);
  if (!text) {
    return [];
  }

  const strokes: KeyStroke[] = [];
  let index = 0;

  while (index < text.length) {
    if (text[index] === "\x1b") {
      let matchLen = 0;
      for (let len = 8; len >= 2; len--) {
        const sub = text.slice(index, index + len);
        if (sub in SPECIAL_SEQUENCES) {
          matchLen = len;
          break;
        }
      }

      if (matchLen > 0) {
        strokes.push(parseSingleSequence(text.slice(index, index + matchLen)));
        index += matchLen;
        continue;
      }

      if (index + 1 < text.length) {
        strokes.push(parseSingleSequence(text.slice(index, index + 2)));
        index += 2;
        continue;
      }

      strokes.push(parseSingleSequence("\x1b"));
      index += 1;
      continue;
    }

    const char = text[index] ?? "";
    strokes.push(parseSingleSequence(char));
    index += 1;
  }

  return strokes;
}
