// Read + parse JSON, failing loud and naming the offending file — every pipeline
// JSON read goes through here so a truncated or malformed file gives an operator a
// path, not a bare SyntaxError (CLAUDE.md: fail loud in ingest, name the file).

import { readFileSync } from "node:fs";

export function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(`ingest: cannot read ${path}: ${(cause as Error).message}`, { cause });
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`ingest: ${path} is not valid JSON: ${(cause as Error).message}`, { cause });
  }
}
