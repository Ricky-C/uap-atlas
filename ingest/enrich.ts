// Phase 2 enrichment — fills the three "read-the-document" fields of every
// UAPRecord (summary / objectClass / redactionPct) with claude-sonnet-5.
//
// Two modes:
//   pnpm enrich --probe [file] [--yes]   single live doc, spot-check (page 1 only)
//   pnpm enrich [--dry-run] [--yes]      the offline Batch run over data/records.json
//
// The Batch runner is idempotent and cached: every result is written to
// data/cache/<record.id>.json keyed on {model, promptSha, schemaSha, strategy}.
// A record is re-billed only when one of those changes — a clean re-run costs
// nothing and writes nothing (golden rule 4: ingest never re-bills done work).
//
// Cost control (working-preferences: confirm exact spend before any paid run):
//   --dry-run  renders + count_tokens (both free) and prints the exact estimate,
//              then exits. No batch is created. This is the checkpoint before spend.
//   --yes      required to actually submit the paid batch. Without it the runner
//              prints the estimate and stops.
//   A hard SUBMIT_CAP aborts if the estimate is far above the expected ~$1.45,
//   which would mean a page-strategy misconfiguration rather than a real cost.
//
// The canonical prompt lives in .claude/skills/case-extraction/references/prompt.md
// and is read verbatim — it is the single source of truth, never duplicated here.

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

import { writeRecordsFile } from "./emit";
import { readJson } from "./io";
import { pageCount, renderDocToImages, type ImageMediaType, type RenderedImage } from "./render";
import { OBJECT_CLASSES, type ObjectClass, type UAPRecord } from "../schema";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2048; // hard output cap (covers low-effort thinking + the small JSON)
const RENDER_PX = 1568; // page-image long edge; ~2.5k image tokens/page (measured)
const MAX_PAGES = 3; // first N pages per doc — the incident is usually within the first 3

// Batch API = 50% off. Sonnet 5 intro pricing ($2/$10 per MTok, through 2026-08-31)
// halved → $1 in / $5 out per MTok. Estimate is exact on input (count_tokens) and
// uses the measured ~170 output tokens/doc for the output side.
const BATCH_PRICE_IN = 1.0;
const BATCH_PRICE_OUT = 5.0;
const EST_OUTPUT_TOKENS_PER_DOC = 170; // measured on the probe; realistic, not worst-case
const SUBMIT_CAP_USD = 3.0; // abort above this — expected run is ~$1.45; higher ⇒ misconfig
const POLL_INTERVAL_MS = 30_000;
// The Batch API request cap is 256MB, but a single ~160MB upload proved unreliable
// (connection resets). Submit the corpus as several smaller batches instead — each
// upload is fast and robust, and the per-batch state keeps the whole thing resumable.
const CHUNK_TARGET_BYTES = 32 * 1024 * 1024;

// A single interactive probe is NOT a batch call, so it bills at live rates.
const PROBE_PRICE_IN = 2.0;
const PROBE_PRICE_OUT = 10.0;
const PROBE_CONFIRM_ABOVE_USD = 0.25;

const PROMPT_PATH = join(".claude", "skills", "case-extraction", "references", "prompt.md");
const RECORDS_PATH = join("data", "records.json");
const CACHE_DIR = join("data", "cache");
const BATCH_STATE_PATH = join(CACHE_DIR, "_batch-state.json");

const DEFAULT_PROBE_DOC = join(
  "data", "raw", "release_03",
  "FBI-UAP-D001_FD-302_Unresolved-UAP-Report_ColoradoSprings_2022.pdf",
);

// Structured-output contract. Derived from the runtime OBJECT_CLASSES so the enum
// can never drift from schema.ts. redactionPct is integer-or-null; the 0–100 range
// is enforced in validate() below because structured outputs strips numeric bounds.
const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    objectClass: { type: "string", enum: [...OBJECT_CLASSES] },
    redactionPct: { anyOf: [{ type: "integer" }, { type: "null" }] },
    reviewFlags: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "objectClass", "redactionPct", "reviewFlags"],
};

interface CacheStrategy {
  pagesSent: number;
  pageCount: number;
  renderPx: number;
  maxPages: number;
}

interface Extracted {
  summary: string;
  objectClass: ObjectClass;
  redactionPct: number | null;
  reviewFlags: string[];
}

interface CacheEntry extends Extracted {
  recordId: string;
  sha256: string;
  model: string;
  promptSha: string;
  schemaSha: string;
  strategy: CacheStrategy;
  stopReason: string | null;
  usage: { input_tokens: number; output_tokens: number };
  enrichedAt: string;
}

interface BatchState {
  // Absent only in the transient "submitting" marker written just before
  // batches.create(); present ("submitted") once the batch id is recorded.
  batchId?: string;
  status: "submitting" | "submitted";
  model: string;
  promptSha: string;
  schemaSha: string;
  renderPx: number;
  maxPages: number;
  customIds: string[];
  docStrategies: Record<string, CacheStrategy>;
  submittedAt: string;
}

type SubmittedState = BatchState & { batchId: string };

// MessageBatch type without guessing the SDK's export path.
type MB = Awaited<ReturnType<Anthropic["messages"]["batches"]["retrieve"]>>;

interface DocPlan {
  record: UAPRecord;
  mediaPath: string;
  pageCount: number;
  pagesSent: number;
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const usd = (n: number): string => `$${n.toFixed(4)}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// The SDK reads ANTHROPIC_API_KEY from the environment; load it from .env if unset.
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

function requireKey(): void {
  loadEnv();
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ingest/enrich: no ANTHROPIC_API_KEY (checked env and .env)");
  }
}

// Read the canonical prompt body verbatim (only the "## Prompt text" section, so
// editing maintainer notes below it does not change the promptSha and re-bill).
function loadPrompt(): string {
  const md = readFileSync(PROMPT_PATH, "utf8");
  const body = md.split("## Prompt text")[1]?.split("## Notes for maintainers")[0];
  if (!body) throw new Error(`ingest/enrich: could not find the prompt body in ${PROMPT_PATH}`);
  return body.trim();
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
      ok: typeof objectClass === "string" && (OBJECT_CLASSES as readonly string[]).includes(objectClass),
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

// ---------------------------------------------------------------------------
// Batch runner
// ---------------------------------------------------------------------------

function mediaPathFor(record: UAPRecord): string {
  const p = record.media.docImage ?? record.media.rendering ?? record.media.video;
  if (!p) throw new Error(`ingest/enrich: record ${record.id} has no media path`);
  return p;
}

function readRecords(): UAPRecord[] {
  const value = readJson(RECORDS_PATH);
  if (!Array.isArray(value)) throw new Error(`ingest/enrich: ${RECORDS_PATH} is not a JSON array`);
  return value as UAPRecord[];
}

function ensureCacheDir(): void {
  mkdirSync(CACHE_DIR, { recursive: true });
}

const cachePath = (recordId: string): string => join(CACHE_DIR, `${recordId}.json`);

function readCache(recordId: string): CacheEntry | null {
  const p = cachePath(recordId);
  if (!existsSync(p)) return null;
  return readJson(p) as CacheEntry;
}

// Atomic write (temp + rename) so a killed process never leaves a partial cache.
function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

// A cache is a hit (skip, never re-bill) only when every keyed field matches the
// current config. pagesSent captures maxPages/pageCount changes precisely: a
// short doc whose pagesSent is unchanged stays cached when maxPages is bumped.
function isCacheValid(
  entry: CacheEntry | null,
  cfg: { promptSha: string; schemaSha: string; pagesSent: number },
): boolean {
  return (
    entry !== null &&
    entry.model === MODEL &&
    entry.promptSha === cfg.promptSha &&
    entry.schemaSha === cfg.schemaSha &&
    entry.strategy.renderPx === RENDER_PX &&
    entry.strategy.pagesSent === cfg.pagesSent
  );
}

function planDoc(record: UAPRecord): DocPlan {
  const mediaPath = mediaPathFor(record);
  const pc = pageCount(mediaPath); // pdfinfo for PDFs, 1 for native images — free/local
  return { record, mediaPath, pageCount: pc, pagesSent: Math.min(MAX_PAGES, pc) };
}

function buildParams(images: RenderedImage[], prompt: string): Anthropic.MessageCreateParamsNonStreaming {
  const content: Anthropic.ContentBlockParam[] = [
    ...images.map(
      (img): Anthropic.ContentBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.data },
      }),
    ),
    { type: "text", text: prompt },
  ];
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content }],
    // effort:"low" bounds adaptive thinking so it can't eat max_tokens; structured
    // outputs is belt-and-suspenders on top of the prompt's own JSON-only instruction.
    output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
  };
}

function readBatchState(): BatchState | null {
  if (!existsSync(BATCH_STATE_PATH)) return null;
  return readJson(BATCH_STATE_PATH) as BatchState;
}

function clearBatchState(): void {
  if (existsSync(BATCH_STATE_PATH)) unlinkSync(BATCH_STATE_PATH);
}

const sumCounts = (c: MB["request_counts"]): number =>
  c.processing + c.succeeded + c.errored + c.canceled + c.expired;

type BatchDecision = { kind: "adopt"; batch: MB } | { kind: "wait"; batch: MB } | { kind: "none" };

// Recover from a submit that was interrupted after the "submitting" marker was
// written but before the batch id was recorded. Scan the batches created around
// our submit time and, when one's custom_id set matches this request set exactly,
// adopt it (collect, don't resubmit — the whole point of the pre-submit marker).
// Scoped to created_at >= submittedAt so a stale prior-config batch (same ids,
// earlier time) is never adopted; capped to a few recent batches.
async function findInterruptedBatch(
  client: Anthropic,
  customIds: string[],
  submittedAtISO: string,
): Promise<BatchDecision> {
  const target = new Set(customIds);
  const since = Date.parse(submittedAtISO) - 120_000; // 2-min skew tolerance
  let scanned = 0;
  for await (const b of client.messages.batches.list()) {
    if (++scanned > 30) break;
    const created = Date.parse(b.created_at);
    if (Number.isFinite(created) && created < since) break; // list is newest-first
    if (sumCounts(b.request_counts) !== customIds.length) continue;
    if (b.processing_status === "ended") {
      const ids = new Set<string>();
      for await (const item of await client.messages.batches.results(b.id)) ids.add(item.custom_id);
      if (ids.size === target.size && [...target].every((id) => ids.has(id))) return { kind: "adopt", batch: b };
    } else {
      // in_progress / canceling: can't read ids yet, but a same-size batch created
      // right after our interrupted submit is almost certainly ours — wait for it.
      return { kind: "wait", batch: b };
    }
  }
  return { kind: "none" };
}

// Pull the JSON out of a batch result message and validate it. Returns null (a
// per-doc failure — reported, not cached, free to retry) on anything unexpected:
// a non-end_turn stop, no text block, unparseable JSON, or a contract violation.
function extractAndValidate(message: Anthropic.Message, customId: string): Extracted | null {
  if (message.stop_reason !== "end_turn") {
    console.warn(`  ${customId}: FAILED (stop_reason=${message.stop_reason}) — not cached`);
    return null;
  }
  // Adaptive thinking can make content[0] a thinking block — find the text block.
  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    console.warn(`  ${customId}: FAILED (no text block) — not cached`);
    return null;
  }
  const raw = textBlock.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`  ${customId}: FAILED (invalid JSON) — not cached`);
    return null;
  }
  const checks = validate(parsed);
  const bad = checks.filter((c) => !c.ok);
  if (bad.length > 0) {
    console.warn(`  ${customId}: FAILED (${bad.map((c) => `${c.field}=${c.detail}`).join("; ")}) — not cached`);
    return null;
  }
  const o = parsed as Record<string, unknown>;
  return {
    summary: o.summary as string,
    objectClass: o.objectClass as ObjectClass,
    redactionPct: o.redactionPct as number | null,
    reviewFlags: o.reviewFlags as string[],
  };
}

// Apply cached fields into records.json, writing only if something changed (so a
// clean re-run leaves the file byte-identical). reviewFlags is not a UAPRecord
// field — it is printed for the human spot-check, never persisted.
function patchRecords(): boolean {
  const records = readRecords();
  let changed = false;
  for (const rec of records) {
    const c = readCache(rec.id);
    if (!c) continue;
    if (rec.summary !== c.summary || rec.objectClass !== c.objectClass || rec.redactionPct !== c.redactionPct) {
      rec.summary = c.summary;
      rec.objectClass = c.objectClass;
      rec.redactionPct = c.redactionPct;
      changed = true;
    }
  }
  if (changed) writeRecordsFile(records, RECORDS_PATH);
  return changed;
}

// Poll a submitted batch until it ends, then stream and collect its results.
// Idempotent and resumable: killing this and re-running retrieves the SAME batch
// (never resubmits) and collects. Failures are reported and left uncached so the
// next run's uncached set is exactly the failures — a free retry.
async function finishBatch(client: Anthropic, state: SubmittedState): Promise<void> {
  let batch = await client.messages.batches.retrieve(state.batchId);
  while (batch.processing_status !== "ended") {
    const c = batch.request_counts;
    console.log(
      `  batch ${state.batchId}: ${batch.processing_status} — ` +
        `processing ${c.processing}, succeeded ${c.succeeded}, errored ${c.errored} (Ctrl-C to detach; re-run to resume)`,
    );
    await sleep(POLL_INTERVAL_MS);
    batch = await client.messages.batches.retrieve(state.batchId);
  }

  console.log(`collecting batch ${state.batchId}…`);
  const promptSha = state.promptSha;
  const schemaSha = state.schemaSha;
  let succeeded = 0;
  let failed = 0;
  const flagReport: string[] = [];

  for await (const item of await client.messages.batches.results(state.batchId)) {
    if (item.result.type !== "succeeded") {
      failed++;
      const detail = item.result.type === "errored" ? `: ${JSON.stringify(item.result.error.error)}` : "";
      console.warn(`  ${item.custom_id}: ${item.result.type}${detail} — not cached (free retry next run)`);
      continue;
    }
    const message = item.result.message;
    const extracted = extractAndValidate(message, item.custom_id);
    if (!extracted) {
      failed++;
      continue;
    }
    const strategy = state.docStrategies[item.custom_id] ?? {
      pagesSent: 0,
      pageCount: 0,
      renderPx: state.renderPx,
      maxPages: state.maxPages,
    };
    const entry: CacheEntry = {
      recordId: item.custom_id,
      sha256: item.custom_id, // record.id is already the source-file content hash slice
      model: MODEL,
      promptSha,
      schemaSha,
      strategy,
      ...extracted,
      stopReason: message.stop_reason,
      usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
      enrichedAt: new Date().toISOString(),
    };
    // Skip the write if an equivalent entry already exists (a re-collect after a
    // crash) — otherwise only enrichedAt/usage would change and every committed
    // cache file would churn on a re-run that did no new work.
    const prior = readCache(item.custom_id);
    const unchanged =
      prior !== null &&
      prior.model === MODEL &&
      prior.promptSha === promptSha &&
      prior.schemaSha === schemaSha &&
      prior.strategy.pagesSent === strategy.pagesSent &&
      prior.summary === extracted.summary &&
      prior.objectClass === extracted.objectClass &&
      prior.redactionPct === extracted.redactionPct;
    if (!unchanged) writeJsonAtomic(cachePath(item.custom_id), entry);
    succeeded++;
    if (extracted.reviewFlags.length > 0) flagReport.push(`  ${item.custom_id}: ${extracted.reviewFlags.join(", ")}`);
  }

  console.log(`collected: ${succeeded} succeeded, ${failed} failed of ${state.customIds.length}.`);
  if (flagReport.length > 0) {
    console.log("review flags (human spot-check — not persisted to records.json):");
    for (const line of flagReport) console.log(line);
  }
  const patched = patchRecords();
  console.log(`records.json ${patched ? "updated" : "unchanged"}.`);
  clearBatchState(); // only after a successful patch — a crash before here re-collects idempotently
}

interface BuiltRequest {
  plan: DocPlan;
  request: { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming };
  bytes: number; // approximate serialized image+prompt payload, for batch chunking
}

// Greedily pack requests into batches each ≤ targetBytes (a single request always
// gets at least its own batch). Preserves order.
function chunkByPayload(items: BuiltRequest[], targetBytes: number): BuiltRequest[][] {
  const chunks: BuiltRequest[][] = [];
  let cur: BuiltRequest[] = [];
  let curBytes = 0;
  for (const it of items) {
    if (cur.length > 0 && curBytes + it.bytes > targetBytes) {
      chunks.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(it);
    curBytes += it.bytes;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

// Submit one chunk as a batch and collect it. Writes the "submitting" marker BEFORE
// create() (so an orphan is discoverable on the next run), then the id, then polls
// and collects. finishBatch clears the state file, so the next chunk starts clean.
async function submitChunk(client: Anthropic, chunk: BuiltRequest[], promptSha: string, schemaSha: string): Promise<void> {
  const docStrategies: Record<string, CacheStrategy> = {};
  for (const b of chunk) {
    docStrategies[b.plan.record.id] = {
      pagesSent: b.plan.pagesSent,
      pageCount: b.plan.pageCount,
      renderPx: RENDER_PX,
      maxPages: MAX_PAGES,
    };
  }
  const base = {
    model: MODEL,
    promptSha,
    schemaSha,
    renderPx: RENDER_PX,
    maxPages: MAX_PAGES,
    customIds: chunk.map((b) => b.plan.record.id),
    docStrategies,
    submittedAt: new Date().toISOString(),
  };
  writeJsonAtomic(BATCH_STATE_PATH, { ...base, status: "submitting" });
  const batch = await client.messages.batches.create({ requests: chunk.map((b) => b.request) });
  const submitted: SubmittedState = { ...base, batchId: batch.id, status: "submitted" };
  writeJsonAtomic(BATCH_STATE_PATH, submitted);
  console.log(`  submitted batch ${batch.id} (${chunk.length} docs). polling…`);
  await finishBatch(client, submitted);
}

async function runBatch(opts: { dryRun: boolean; yes: boolean; only?: string[]; limit?: number }): Promise<void> {
  requireKey();
  ensureCacheDir();
  const client = new Anthropic();

  // Resume/collect/reconcile an in-flight batch before anything else — never resubmit.
  const state = readBatchState();
  if (state) {
    if (state.batchId) {
      // A recorded in-flight batch: resume and collect it (dry-run reports only).
      if (opts.dryRun) {
        const b = await client.messages.batches.retrieve(state.batchId);
        console.log(`enrich --dry-run: batch ${state.batchId} is ${b.processing_status} (submitted ${state.submittedAt}). Re-run without --dry-run to collect.`);
        return;
      }
      console.log(`resuming batch ${state.batchId} (submitted ${state.submittedAt}).`);
      await finishBatch(client, state as SubmittedState);
    } else {
      // Interrupted submit: the "submitting" marker exists but no id was recorded.
      if (opts.dryRun) {
        console.log("enrich --dry-run: a prior submit was interrupted; re-run without --dry-run to reconcile.");
        return;
      }
      console.warn("a prior submit was interrupted before the batch id was recorded — reconciling with the server…");
      const decision = await findInterruptedBatch(client, state.customIds, state.submittedAt);
      if (decision.kind === "wait") {
        throw new Error(`ingest/enrich: a matching batch ${decision.batch.id} is ${decision.batch.processing_status} — wait for it, then re-run to collect`);
      }
      if (decision.kind === "adopt") {
        const adopted: SubmittedState = { ...state, batchId: decision.batch.id, status: "submitted" };
        writeJsonAtomic(BATCH_STATE_PATH, adopted);
        console.log(`adopted batch ${decision.batch.id} from the interrupted submit — collecting, not resubmitting.`);
        await finishBatch(client, adopted);
      } else {
        console.log("no batch was created by the interrupted submit — clearing the marker and continuing.");
        clearBatchState();
      }
    }
    // fall through to partition + (chunked) submit of any remaining uncached docs
  }

  const prompt = loadPrompt();
  const promptSha = sha256(prompt);
  const schemaSha = sha256(JSON.stringify(OUTPUT_SCHEMA));

  const records = readRecords();
  const plans = records.map(planDoc);
  const uncached = plans.filter((p) => !isCacheValid(readCache(p.record.id), { promptSha, schemaSha, pagesSent: p.pagesSent }));

  // Optional subset for a bounded live test: --only=<id,id,...> or --limit=<n>.
  let selected = uncached;
  if (opts.only) {
    const want = new Set(opts.only);
    const missing = opts.only.filter((id) => !uncached.some((p) => p.record.id === id));
    if (missing.length > 0) console.warn(`--only: ignoring ${missing.length} id(s) not in the uncached set: ${missing.join(", ")}`);
    selected = uncached.filter((p) => want.has(p.record.id));
  } else if (opts.limit !== undefined) {
    selected = uncached.slice(0, opts.limit);
  }

  if (selected.length === 0) {
    const patched = patchRecords();
    const scope = opts.only || opts.limit !== undefined ? "for this selection" : `(all ${plans.length} records)`;
    console.log(`enrich: nothing to enrich ${scope}. records.json ${patched ? "updated" : "unchanged"}.`);
    return;
  }

  const subsetNote = selected.length === uncached.length ? "" : ` (of ${uncached.length} uncached)`;
  console.log(`enrich: ${selected.length}/${plans.length} records to enrich this run${subsetNote}.`);

  // Render + count_tokens (both free) over the selected set to price the run exactly.
  const built: BuiltRequest[] = [];
  let totalInput = 0;
  let totalPayloadBytes = 0;
  for (const p of selected) {
    const rendered = renderDocToImages(p.mediaPath, { renderPx: RENDER_PX, maxPages: MAX_PAGES });
    const params = buildParams(rendered.images, prompt);
    const ct = await client.messages.countTokens({ model: MODEL, messages: params.messages });
    totalInput += ct.input_tokens;
    const bytes = rendered.images.reduce((s, im) => s + im.data.length, 0) + prompt.length;
    totalPayloadBytes += bytes;
    // Key the cache on planDoc's INTENDED pagesSent (= min(MAX_PAGES, pageCount)),
    // which isCacheValid recomputes the same way at read time. Using the actual
    // rendered image count here would drift (and re-bill forever) if pdftoppm ever
    // emits fewer pages than pdfinfo reports for a malformed page.
    built.push({ plan: p, request: { custom_id: p.record.id, params }, bytes });
  }

  const inputCost = (totalInput / 1e6) * BATCH_PRICE_IN;
  const estOutputCost = ((built.length * EST_OUTPUT_TOKENS_PER_DOC) / 1e6) * BATCH_PRICE_OUT;
  const estTotal = inputCost + estOutputCost;
  const worstTotal = inputCost + ((built.length * MAX_TOKENS) / 1e6) * BATCH_PRICE_OUT;

  const payloadMB = totalPayloadBytes / (1024 * 1024);
  const chunks = chunkByPayload(built, CHUNK_TARGET_BYTES);
  console.log(`\n  --- cost estimate (Batch API, ${MODEL} intro pricing $${BATCH_PRICE_IN}/$${BATCH_PRICE_OUT} per MTok) ---`);
  console.log(`  ${built.length} docs, ${totalInput} input tokens (exact, count_tokens) → ${usd(inputCost)} in`);
  console.log(`  output est. @${EST_OUTPUT_TOKENS_PER_DOC} tok/doc (measured) → ${usd(estOutputCost)} out`);
  console.log(`  estimated total: ${usd(estTotal)}   (worst case if every doc emits ${MAX_TOKENS} out: ${usd(worstTotal)})`);
  console.log(`  request payload: ~${payloadMB.toFixed(0)} MB → ${chunks.length} batch(es) of ≤${(CHUNK_TARGET_BYTES / 1024 / 1024).toFixed(0)} MB`);

  if (opts.dryRun) {
    console.log("\n  dry run — no batch submitted, no spend.");
    return;
  }

  if (estTotal > SUBMIT_CAP_USD) {
    throw new Error(
      `ingest/enrich: estimate ${usd(estTotal)} exceeds the ${usd(SUBMIT_CAP_USD)} safety cap ` +
        `(expected ~$1.45). Aborting — check the page strategy before spending.`,
    );
  }

  if (!opts.yes) {
    console.log(`\n  estimate ${usd(estTotal)} is within the ${usd(SUBMIT_CAP_USD)} cap. Re-run with --yes to submit the paid batch.`);
    return;
  }

  // Double-submit guard: never submit while another (unrelated) batch is still running.
  for await (const b of client.messages.batches.list()) {
    if (b.processing_status === "in_progress" || b.processing_status === "canceling") {
      throw new Error(`ingest/enrich: batch ${b.id} is already ${b.processing_status} — refusing to submit another`);
    }
  }

  // Submit as one or more payload-bounded batches, sequentially. Each is fully
  // collected (its state cleared) before the next is submitted, so an interruption
  // resumes the in-flight batch and a re-run continues the remaining chunks.
  console.log(`\n  submitting ${built.length} docs as ${chunks.length} batch(es)…`);
  for (let i = 0; i < chunks.length; i++) {
    console.log(`\n  --- batch ${i + 1}/${chunks.length} (${chunks[i].length} docs) ---`);
    await submitChunk(client, chunks[i], promptSha, schemaSha);
  }
  console.log(`\n  all ${chunks.length} batch(es) collected.`);
}

// ---------------------------------------------------------------------------
// Single-doc probe (unchanged behavior — page 1 only, live pricing)
// ---------------------------------------------------------------------------

// One representative image: render page 1 of a PDF to PNG, or use a native image as-is.
function probeImage(file: string): { data: string; media: ImageMediaType; note: string } {
  const ext = extname(file).toLowerCase();
  if (ext === ".pdf") {
    // Random per-run scratch dir (not a predictable /tmp name) with guaranteed
    // cleanup — mirrors ingest/render.ts and avoids a symlink/TOCTOU on the output.
    const scratch = mkdtempSync(join(tmpdir(), "enrich-probe-"));
    try {
      const prefix = join(scratch, "page");
      execFileSync("pdftoppm", ["-png", "-singlefile", "-f", "1", "-l", "1", "-scale-to", String(RENDER_PX), file, prefix]);
      const data = readFileSync(`${prefix}.png`).toString("base64");
      return { data, media: "image/png", note: `rendered page 1 @${RENDER_PX}px` };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  const media: ImageMediaType = ext === ".png" ? "image/png" : "image/jpeg";
  return { data: readFileSync(file).toString("base64"), media, note: "native image" };
}

async function runProbe(file: string, yes: boolean): Promise<void> {
  requireKey();
  if (!existsSync(file)) throw new Error(`ingest/enrich: file not found: ${file}`);

  const prompt = loadPrompt();
  const img = probeImage(file);
  const content: Anthropic.ContentBlockParam[] = [
    { type: "image", source: { type: "base64", media_type: img.media, data: img.data } },
    { type: "text", text: prompt },
  ];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];
  const client = new Anthropic();

  console.log(`ingest/enrich --probe: ${basename(file)} (${img.note})`);

  // --- pre-flight cost gate (count_tokens is free) ---
  const ct = await client.messages.countTokens({ model: MODEL, messages });
  const estIn = (ct.input_tokens / 1e6) * PROBE_PRICE_IN;
  const estWorstOut = (MAX_TOKENS / 1e6) * PROBE_PRICE_OUT;
  const estMax = estIn + estWorstOut;
  console.log(
    `  pre-flight: ${ct.input_tokens} input tokens → ~${usd(estIn)} in + up to ${usd(estWorstOut)} out ` +
      `(max_tokens ${MAX_TOKENS}) = <= ${usd(estMax)}`,
  );
  if (estMax > PROBE_CONFIRM_ABOVE_USD && !yes) {
    throw new Error(
      `ingest/enrich: estimated max ${usd(estMax)} exceeds the ${usd(PROBE_CONFIRM_ABOVE_USD)} gate — re-run with --yes`,
    );
  }

  // --- live enrichment call (bounded by max_tokens) ---
  const resp = await client.messages.create({ model: MODEL, max_tokens: MAX_TOKENS, messages });
  const textBlock = resp.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`ingest/enrich: no text block in response (stop_reason: ${resp.stop_reason})`);
  }
  const raw = textBlock.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`ingest/enrich: response was not valid JSON:\n${raw}`);
  }

  const checks = validate(parsed);
  const cost = (resp.usage.input_tokens / 1e6) * PROBE_PRICE_IN + (resp.usage.output_tokens / 1e6) * PROBE_PRICE_OUT;

  console.log("\n  --- extracted record fields ---");
  console.log(JSON.stringify(parsed, null, 2).split("\n").map((l) => "  " + l).join("\n"));
  console.log("\n  --- output-contract check ---");
  for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.field}: ${c.detail}`);
  const allOk = checks.every((c) => c.ok);
  console.log(
    `\n  usage: ${resp.usage.input_tokens} in + ${resp.usage.output_tokens} out tokens -> ` +
      `actual cost ${usd(cost)} (single live call, Sonnet 5 intro pricing)`,
  );
  console.log(`  stop_reason: ${resp.stop_reason} | contract: ${allOk ? "all fields valid" : "SOME FIELDS INVALID"}`);
}

function flagValue(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const yes = args.includes("--yes");
  if (args.includes("--probe")) {
    const file = args.find((a) => !a.startsWith("--")) ?? DEFAULT_PROBE_DOC;
    await runProbe(file, yes);
    return;
  }
  const only = flagValue(args, "only");
  const limit = flagValue(args, "limit");
  await runBatch({
    dryRun: args.includes("--dry-run"),
    yes,
    only: only ? only.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    limit: limit !== undefined ? Number(limit) : undefined,
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
