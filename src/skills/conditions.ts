/**
 * Condition evaluator for skill chains.
 * No eval/Function — uses a safe whitelist token parser.
 *
 * Supports:
 *   "$step.field"             — truthiness
 *   "$step.field === 'val'"   — equality
 *   "$step.count > 0"         — comparison
 *   "expr1 && expr2"          — AND
 *   "expr1 || expr2"          — OR
 */

export function getByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function resolveRef(ref: string, variables: Record<string, unknown>): unknown {
  const clean = ref.startsWith("$") ? ref.slice(1) : ref;
  const dotIdx = clean.indexOf(".");
  if (dotIdx === -1) return variables[clean];
  const stepName = clean.slice(0, dotIdx);
  const fieldPath = clean.slice(dotIdx + 1);
  return getByPath(variables[stepName], fieldPath);
}

type TokenKind = "ref" | "string" | "number" | "boolean" | "null" | "operator" | "logic";
interface Token { kind: TokenKind; value: string; }

function tokenizeExpr(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = expr.trim();

  while (i < s.length) {
    if (s[i] === " " || s[i] === "\t") { i++; continue; }
    if (s.startsWith("&&", i)) { tokens.push({ kind: "logic", value: "&&" }); i += 2; continue; }
    if (s.startsWith("||", i)) { tokens.push({ kind: "logic", value: "||" }); i += 2; continue; }
    if (s.startsWith("===", i)) { tokens.push({ kind: "operator", value: "===" }); i += 3; continue; }
    if (s.startsWith("!==", i)) { tokens.push({ kind: "operator", value: "!==" }); i += 3; continue; }
    if (s.startsWith("==", i)) { tokens.push({ kind: "operator", value: "==" }); i += 2; continue; }
    if (s.startsWith("!=", i)) { tokens.push({ kind: "operator", value: "!=" }); i += 2; continue; }
    if (s.startsWith(">=", i)) { tokens.push({ kind: "operator", value: ">=" }); i += 2; continue; }
    if (s.startsWith("<=", i)) { tokens.push({ kind: "operator", value: "<=" }); i += 2; continue; }
    if (s[i] === ">") { tokens.push({ kind: "operator", value: ">" }); i++; continue; }
    if (s[i] === "<") { tokens.push({ kind: "operator", value: "<" }); i++; continue; }
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i]; let j = i + 1;
      while (j < s.length && s[j] !== quote) j++;
      tokens.push({ kind: "string", value: s.slice(i + 1, j) }); i = j + 1; continue;
    }
    if (/\d/.test(s[i]) || (s[i] === "-" && /\d/.test(s[i + 1] ?? ""))) {
      let j = i; if (s[j] === "-") j++;
      while (j < s.length && /[\d.]/.test(s[j])) j++;
      tokens.push({ kind: "number", value: s.slice(i, j) }); i = j; continue;
    }
    if (s.startsWith("true", i) && !/\w/.test(s[i + 4] ?? "")) { tokens.push({ kind: "boolean", value: "true" }); i += 4; continue; }
    if (s.startsWith("false", i) && !/\w/.test(s[i + 5] ?? "")) { tokens.push({ kind: "boolean", value: "false" }); i += 5; continue; }
    if (s.startsWith("null", i) && !/\w/.test(s[i + 4] ?? "")) { tokens.push({ kind: "null", value: "null" }); i += 4; continue; }
    if (s[i] === "$") {
      let j = i + 1;
      while (j < s.length && /[\w.\[\]]/.test(s[j])) j++;
      tokens.push({ kind: "ref", value: s.slice(i, j) }); i = j; continue;
    }
    i++;
  }
  return tokens;
}

function tokenValue(token: Token, variables: Record<string, unknown>): unknown {
  switch (token.kind) {
    case "ref": return resolveRef(token.value, variables);
    case "string": return token.value;
    case "number": return parseFloat(token.value);
    case "boolean": return token.value === "true";
    case "null": return null;
    default: return undefined;
  }
}

function compare(left: unknown, op: string, right: unknown): boolean {
  switch (op) {
    case "===": return left === right;
    case "!==": return left !== right;
    // eslint-disable-next-line eqeqeq
    case "==": return left == right;
    // eslint-disable-next-line eqeqeq
    case "!=": return left != right;
    case ">": return (left as number) > (right as number);
    case "<": return (left as number) < (right as number);
    case ">=": return (left as number) >= (right as number);
    case "<=": return (left as number) <= (right as number);
    default: return false;
  }
}

export function evaluateCondition(expr: string, variables: Record<string, unknown>): boolean {
  const tokens = tokenizeExpr(expr.trim());
  if (tokens.length === 0) return false;

  const groups: { tokens: Token[]; logic?: "&&" | "||" }[] = [];
  let current: Token[] = [];
  let pendingLogic: "&&" | "||" | undefined;

  for (const tok of tokens) {
    if (tok.kind === "logic") {
      groups.push({ tokens: current, logic: pendingLogic });
      current = [];
      pendingLogic = tok.value as "&&" | "||";
    } else {
      current.push(tok);
    }
  }
  groups.push({ tokens: current, logic: pendingLogic });

  let result: boolean | undefined;
  for (const group of groups) {
    const toks = group.tokens;
    let groupResult: boolean;

    if (toks.length === 1) {
      groupResult = Boolean(tokenValue(toks[0], variables));
    } else if (toks.length === 3 && toks[1].kind === "operator") {
      groupResult = compare(tokenValue(toks[0], variables), toks[1].value, tokenValue(toks[2], variables));
    } else {
      groupResult = Boolean(tokenValue(toks[0] ?? { kind: "null" as const, value: "null" }, variables));
    }

    if (result === undefined) result = groupResult;
    else if (group.logic === "&&") result = result && groupResult;
    else if (group.logic === "||") result = result || groupResult;
  }
  return result ?? false;
}
