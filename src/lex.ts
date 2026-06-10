export type TokenKind =
  | "IDENT"
  | "NUMBER"
  | "STRING"
  | "NEWLINE"
  | "COLON"
  | "COMMA"
  | "LPAREN"
  | "RPAREN"
  | "LBRACE"
  | "RBRACE"
  | "EQ"
  | "PLUS_EQ"
  | "MINUS_EQ"
  | "PLUS_EQ_AT"
  | "MINUS_EQ_AT"
  | "STAR_EQ"
  | "SLASH_EQ"
  | "EQEQ"
  | "NE"
  | "LT"
  | "GT"
  | "LTE"
  | "GTE"
  | "PLUSPLUS"
  | "MINUSMINUS"
  | "PLUS"
  | "MINUS"
  | "PLUS_AT"
  | "MINUS_AT"
  | "STAR"
  | "SLASH"
  | "EQ_HASH"
  | "DOT"
  | "EOF";

export type Token = {
  kind: TokenKind;
  lexeme: string;
  leadingTrivia: string;
};

const KEYWORDS = new Set(
  [
    "IF",
    "ELSE",
    "ENDIF",
    "WHILE",
    "ENDWHILE",
    "AND",
    "OR",
    "NOT",
    "REPEAT",
    "ENDREPEAT",
    "GOTO",
    "GOSUB",
    "RETURN",
    "TERMINATE_THIS_SCRIPT",
    "VAR_INT",
    "VAR_FLOAT",
    "LVAR_INT",
    "LVAR_FLOAT",
    "SCRIPT_NAME",
    "MISSION_START",
    "MISSION_END",
    "GOSUB_FILE",
    "START_NEW_SCRIPT",
    "LAUNCH_MISSION",
    "LOAD_AND_LAUNCH_MISSION",
    "OFF",
    "ON",
    "TRUE",
    "FALSE",
  ].map((s) => s.toUpperCase()),
);

export function isKeywordUpper(name: string): boolean {
  return KEYWORDS.has(name.toUpperCase());
}

export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  const n = source.length;
  let i = 0;
  let trivia = "";

  const pushNewline = (raw: string) => {
    tokens.push({ kind: "NEWLINE", lexeme: raw, leadingTrivia: trivia });
    trivia = "";
  };

  while (i < n) {
    const c = source[i]!;

    if (c === "\r" && source[i + 1] === "\n") {
      pushNewline("\r\n");
      i += 2;
      continue;
    }
    if (c === "\n") {
      pushNewline("\n");
      i += 1;
      continue;
    }

    if (c === " " || c === "\t" || c === "\v" || c === "\f") {
      trivia += c;
      i += 1;
      continue;
    }

    // In SCM script grammar, parentheses and comma are treated as whitespace
    // separators, not meaningful tokens.
    if (c === "(" || c === ")" || c === ",") {
      trivia += c;
      i += 1;
      continue;
    }

    if (c === "/" && source[i + 1] === "/") {
      trivia += "//";
      i += 2;
      while (i < n && source[i] !== "\n" && !(source[i] === "\r" && source[i + 1] === "\n")) {
        trivia += source[i]!;
        i += 1;
      }
      continue;
    }

    if (c === "/" && source[i + 1] === "*") {
      trivia += "/*";
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (source[i] === "/" && source[i + 1] === "*") {
          trivia += "/*";
          i += 2;
          depth += 1;
          continue;
        }
        if (source[i] === "*" && source[i + 1] === "/") {
          trivia += "*/";
          i += 2;
          depth -= 1;
          continue;
        }
        trivia += source[i]!;
        i += 1;
      }
      continue;
    }

    const leading = trivia;
    trivia = "";

    const emit = (kind: TokenKind, lexeme: string) => {
      tokens.push({ kind, lexeme, leadingTrivia: leading });
    };

    if (c === "(") {
      emit("LPAREN", "(");
      i += 1;
      continue;
    }
    if (c === ")") {
      emit("RPAREN", ")");
      i += 1;
      continue;
    }
    if (c === "{") {
      emit("LBRACE", "{");
      i += 1;
      continue;
    }
    if (c === "}") {
      emit("RBRACE", "}");
      i += 1;
      continue;
    }
    if (c === ",") {
      emit("COMMA", ",");
      i += 1;
      continue;
    }
    if (c === ":") {
      emit("COLON", ":");
      i += 1;
      continue;
    }

    if (c === "=" && source[i + 1] === "#") {
      emit("EQ_HASH", "=#");
      i += 2;
      continue;
    }
    if (c === "=" && source[i + 1] === "=") {
      emit("EQEQ", "==");
      i += 2;
      continue;
    }
    if (c === "<" && source[i + 1] === ">") {
      emit("NE", "<>");
      i += 2;
      continue;
    }
    if (c === "<" && source[i + 1] === "=") {
      emit("LTE", "<=");
      i += 2;
      continue;
    }
    if (c === ">" && source[i + 1] === "=") {
      emit("GTE", ">=");
      i += 2;
      continue;
    }
    if (c === "+" && source[i + 1] === "=" && source[i + 2] === "@") {
      emit("PLUS_EQ_AT", "+=@");
      i += 3;
      continue;
    }
    if (c === "-" && source[i + 1] === "=" && source[i + 2] === "@") {
      emit("MINUS_EQ_AT", "-=@");
      i += 3;
      continue;
    }
    if (c === "+" && source[i + 1] === "=") {
      emit("PLUS_EQ", "+=");
      i += 2;
      continue;
    }
    if (c === "-" && source[i + 1] === "=") {
      emit("MINUS_EQ", "-=");
      i += 2;
      continue;
    }
    if (c === "*" && source[i + 1] === "=") {
      emit("STAR_EQ", "*=");
      i += 2;
      continue;
    }
    if (c === "/" && source[i + 1] === "=") {
      emit("SLASH_EQ", "/=");
      i += 2;
      continue;
    }

    if (c === "+" && source[i + 1] === "@") {
      emit("PLUS_AT", "+@");
      i += 2;
      continue;
    }
    if (c === "-" && source[i + 1] === "@") {
      emit("MINUS_AT", "-@");
      i += 2;
      continue;
    }
    if (c === "+" && source[i + 1] === "+") {
      emit("PLUSPLUS", "++");
      i += 2;
      continue;
    }
    if (c === "-" && source[i + 1] === "-") {
      const nx = source[i + 2];
      if (nx !== undefined && nx >= "0" && nx <= "9") {
        emit("MINUS", "-");
        i += 1;
        continue;
      }
      emit("MINUSMINUS", "--");
      i += 2;
      continue;
    }

    if (c === "=") {
      emit("EQ", "=");
      i += 1;
      continue;
    }
    if (c === "<") {
      emit("LT", "<");
      i += 1;
      continue;
    }
    if (c === ">") {
      emit("GT", ">");
      i += 1;
      continue;
    }
    if (c === "+") {
      emit("PLUS", "+");
      i += 1;
      continue;
    }
    if (c === "-") {
      emit("MINUS", "-");
      i += 1;
      continue;
    }
    if (c === "*") {
      emit("STAR", "*");
      i += 1;
      continue;
    }
    if (c === "/") {
      emit("SLASH", "/");
      i += 1;
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      let s = quote;
      i += 1;
      while (i < n) {
        const d = source[i]!;
        s += d;
        i += 1;
        if (d === quote) break;
      }
      emit("STRING", s);
      continue;
    }

    if (c >= "0" && c <= "9") {
      let j = i;
      while (j < n && source[j]! >= "0" && source[j]! <= "9") j++;
      const floatHere = j < n && source[j] === "." && j + 1 < n && source[j + 1]! >= "0" && source[j + 1]! <= "9";
      const sciHere = j < n && (source[j] === "e" || source[j] === "E");
      const nx = source[j];
      const identTail =
        nx !== undefined &&
        ((nx >= "A" && nx <= "Z") || (nx >= "a" && nx <= "z") || nx === "_");
      if (!floatHere && !sciHere && identTail) {
        let s = "";
        while (i < j) {
          s += source[i]!;
          i += 1;
        }
        while (i < n) {
          const d = source[i]!;
          if ((d >= "A" && d <= "Z") || (d >= "a" && d <= "z") || (d >= "0" && d <= "9") || d === "_" || d === "&" || d === "@") {
            s += d;
            i += 1;
          } else if (
            d === "." &&
            i + 1 < n &&
            ((source[i + 1]! >= "A" && source[i + 1]! <= "Z") ||
              (source[i + 1]! >= "a" && source[i + 1]! <= "z") ||
              (source[i + 1]! >= "0" && source[i + 1]! <= "9") ||
              source[i + 1] === "_")
          ) {
            s += d;
            i += 1;
          } else break;
        }
        emit("IDENT", s);
        continue;
      }
    }

    if ((c >= "0" && c <= "9") || (c === "." && i + 1 < n && source[i + 1]! >= "0" && source[i + 1]! <= "9")) {
      let s = "";
      if (c === ".") {
        s += c;
        i += 1;
        while (i < n && source[i]! >= "0" && source[i]! <= "9") {
          s += source[i]!;
          i += 1;
        }
      } else {
        while (i < n && source[i]! >= "0" && source[i]! <= "9") {
          s += source[i]!;
          i += 1;
        }
        if (i < n && source[i] === ".") {
          s += ".";
          i += 1;
          while (i < n && source[i]! >= "0" && source[i]! <= "9") {
            s += source[i]!;
            i += 1;
          }
        }
        if (i < n && (source[i] === "e" || source[i] === "E")) {
          s += source[i]!;
          i += 1;
          if (i < n && (source[i] === "+" || source[i] === "-")) {
            s += source[i]!;
            i += 1;
          }
          while (i < n && source[i]! >= "0" && source[i]! <= "9") {
            s += source[i]!;
            i += 1;
          }
        }
      }
      emit("NUMBER", s);
      continue;
    }

    if (c === ".") {
      emit("DOT", ".");
      i += 1;
      continue;
    }

    if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_") {
      let s = "";
      while (i < n) {
        const d = source[i]!;
        if ((d >= "A" && d <= "Z") || (d >= "a" && d <= "z") || (d >= "0" && d <= "9") || d === "_" || d === "&" || d === "@") {
          s += d;
          i += 1;
        } else if (
          d === "." &&
          i + 1 < n &&
          ((source[i + 1]! >= "A" && source[i + 1]! <= "Z") ||
            (source[i + 1]! >= "a" && source[i + 1]! <= "z") ||
            (source[i + 1]! >= "0" && source[i + 1]! <= "9") ||
            source[i + 1] === "_")
        ) {
          s += d;
          i += 1;
        } else break;
      }
      emit("IDENT", s);
      continue;
    }

    throw new Error(`Unexpected character ${JSON.stringify(c)} at offset ${i}`);
  }

  tokens.push({ kind: "EOF", lexeme: "", leadingTrivia: trivia });
  return tokens;
}
