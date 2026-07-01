// Phase 2 enrichment — SINGLE-DOCUMENT PROBE.
//
// Reads one PURSUE document, renders its first page to an image, and asks claude-sonnet-5
// for the read-the-document fields of a UAPRecord (summary / objectClass / redactionPct /
// reviewFlags) using the canonical prompt in the case-extraction skill. This proves the
// live call and the output quality on real data before we build the full offline batch run.
//
// The canonical prompt lives in .claude/skills/case-extraction/references/prompt.md and is
// the single source of truth — this reads it verbatim rather than duplicating it.
//
// Guardrails baked in per the spend-control work:
//   - count_tokens PRE-FLIGHT cost gate (count_tokens is free) — estimates and, above a
//     threshold, refuses to spend without --yes.
//   - a hard max_tokens output cap.
// Caching by source-file hash and the Batch API are the next step (the offline run); a
// single interactive probe is intentionally not batched.
//
// Run:  pnpm exec tsx ingest/enrich.ts [path-to-doc] [--yes]

import Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2048; // hard output cap (covers adaptive thinking + the small JSON)
const RENDER_PX = 1568; // page-image long edge; ~2.5k image tokens/page (measured)
const CONFIRM_ABOVE_USD = 0.25; // pre-flight gate — refuse to spend more without --yes

// A single interactive probe is NOT a batch call, so it bills at live rates. Sonnet 5 intro
// pricing runs through 2026-08-31 ($2/$10 per MTok); the full offline run halves this via Batch.
const PRICE_IN = 2.0;
const PRICE_OUT = 10.0;

const PROMPT_PATH = join(".claude", "skills", "case-extraction", "references", "prompt.md");
// Mirrors ObjectClass in schema.ts and the enum in the canonical prompt.
const OBJECT_CLASSES = ["orb", "disc", "fireball", "light", "triangle", "craft", "other", "unknown"];

const DEFAULT_DOC = join(
  "data", "raw", "release_03",
  "FBI-UAP-D001_FD-302_Unresolved-UAP-Report_ColoradoSprings_2022.pdf",
);

type ImageMedia = "image/png" | "image/jpeg";

// The SDK reads ANTHROPIC_API_KEY from the environment; load it from .env if not already set.
function loadEnv(): void {
  if (process.env.ANTHROPIC_API_KEY) return;
  const p = join(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^ANTHROPIC_API_KEY\s*=\s*(.*)$/.exec(line.trim());
    if (m) {
      process.env.ANTHROPIC_API_KEY = m[1].replace(/^["']|["']$/g, "").trim();
      return;
    }
  }
}

function loadPrompt(): string {
  const md = readFileSync(PROMPT_PATH, "utf8");
  const body = md.split("## Prompt text")[1]?.split("## Notes for maintainers")[0];
  if (!body) throw new Error(`ingest/enrich: could not find the prompt body in ${PROMPT_PATH}`);
  return body.trim();
}

// One representative image per document: render page 1 of a PDF to PNG, or use a native image
// as-is. This is the one-image-per-doc design that keeps a big multi-page report cheap.
function toImage(file: string): { data: string; media: ImageMedia; note: string } {
  const ext = extname(file).toLowerCase();
  if (ext === ".pdf") {
    const prefix = join(tmpdir(), `enrich-probe-${basename(file, ".pdf")}`);
    execFileSync("pdftoppm", ["-png", "-singlefile", "-f", "1", "-l", "1", "-scale-to", String(RENDER_PX), file, prefix]);
    const png = `${prefix}.png`;
    const data = readFileSync(png).toString("base64");
    rmSync(png, { force: true });
    return { data, media: "image/png", note: `rendered page 1 @${RENDER_PX}px` };
  }
  const media: ImageMedia = ext === ".png" ? "image/png" : "image/jpeg";
  return { data: readFileSync(file).toString("base64"), media, note: "native image" };
}

interface Check {
  field: string;
  ok: boolean;
  detail: string;
}

// Validate the model's JSON against the output contract (see the case-extraction skill).
function validate(v: unknown): Check[] {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const summary = o.summary;
  const objectClass = o.objectClass;
  const redactionPct = o.redactionPct;
  const reviewFlags = o.reviewFlags;
  return [
    {
      field: "summary",
      ok: typeof summary === "string" && summary.length > 0,
      detail: typeof summary === "string" ? `${summary.length} chars` : `not a string (${typeof summary})`,
    },
    {
      field: "objectClass",
      ok: typeof objectClass === "string" && OBJECT_CLASSES.includes(objectClass),
      detail: String(objectClass),
    },
    {
      field: "redactionPct",
      ok:
        redactionPct === null ||
        (typeof redactionPct === "number" && Number.isInteger(redactionPct) && redactionPct >= 0 && redactionPct <= 100),
      detail: redactionPct === null ? "null" : String(redactionPct),
    },
    {
      field: "reviewFlags",
      ok: Array.isArray(reviewFlags) && reviewFlags.every((x) => typeof x === "string"),
      detail: Array.isArray(reviewFlags) ? JSON.stringify(reviewFlags) : `not an array (${typeof reviewFlags})`,
    },
  ];
}

async function main(): Promise<void> {
  loadEnv();
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ingest/enrich: no ANTHROPIC_API_KEY (checked env and .env)");
  }

  const args = process.argv.slice(2);
  const yes = args.includes("--yes");
  const file = args.find((a) => !a.startsWith("--")) ?? DEFAULT_DOC;
  if (!existsSync(file)) throw new Error(`ingest/enrich: file not found: ${file}`);

  const prompt = loadPrompt();
  const img = toImage(file);
  const content: Anthropic.ContentBlockParam[] = [
    { type: "image", source: { type: "base64", media_type: img.media, data: img.data } },
    { type: "text", text: prompt },
  ];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];
  const client = new Anthropic();

  console.log(`ingest/enrich: ${basename(file)} (${img.note})`);

  // --- pre-flight cost gate (count_tokens is free) ---
  const ct = await client.messages.countTokens({ model: MODEL, messages });
  const estIn = (ct.input_tokens / 1e6) * PRICE_IN;
  const estWorstOut = (MAX_TOKENS / 1e6) * PRICE_OUT;
  const estMax = estIn + estWorstOut;
  console.log(
    `  pre-flight: ${ct.input_tokens} input tokens → ~$${estIn.toFixed(4)} in + up to $${estWorstOut.toFixed(4)} out ` +
      `(max_tokens ${MAX_TOKENS}) = <= $${estMax.toFixed(4)}`,
  );
  if (estMax > CONFIRM_ABOVE_USD && !yes) {
    throw new Error(
      `ingest/enrich: estimated max $${estMax.toFixed(4)} exceeds the $${CONFIRM_ABOVE_USD} gate — re-run with --yes to proceed`,
    );
  }

  // --- live enrichment call (bounded by max_tokens) ---
  const resp = await client.messages.create({ model: MODEL, max_tokens: MAX_TOKENS, messages });
  const textBlock = resp.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`ingest/enrich: no text block in response (stop_reason: ${resp.stop_reason})`);
  }
  // The prompt mandates JSON-only; tolerate an accidental code fence just in case.
  const raw = textBlock.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`ingest/enrich: response was not valid JSON:\n${raw}`);
  }

  const checks = validate(parsed);
  const cost = (resp.usage.input_tokens / 1e6) * PRICE_IN + (resp.usage.output_tokens / 1e6) * PRICE_OUT;

  console.log("\n  --- extracted record fields ---");
  console.log(
    JSON.stringify(parsed, null, 2)
      .split("\n")
      .map((l) => "  " + l)
      .join("\n"),
  );
  console.log("\n  --- output-contract check ---");
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.field}: ${c.detail}`);
  const allOk = checks.every((c) => c.ok);
  console.log(
    `\n  usage: ${resp.usage.input_tokens} in + ${resp.usage.output_tokens} out tokens -> ` +
      `actual cost $${cost.toFixed(5)} (single live call, Sonnet 5 intro pricing)`,
  );
  console.log(`  stop_reason: ${resp.stop_reason} | contract: ${allOk ? "all fields valid" : "SOME FIELDS INVALID"}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
