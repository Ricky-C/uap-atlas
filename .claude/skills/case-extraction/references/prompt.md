# Canonical extraction prompt

This is the source of truth for the enrichment prompt. `ingest/enrich.ts` sends this verbatim (with the document image) to `claude-sonnet-5`. If it needs to change, change it here first, then update the code.

The call is a single user message containing the document image plus the prompt text below. Do not prefill the assistant turn (Sonnet 5 rejects prefill); rely on the instruction to return JSON only. Structured outputs / an output format constraint may be added in code as a belt-and-suspenders measure, but the prompt must stand on its own.

## Prompt text

You are extracting structured metadata from a single declassified U.S. government document released through the PURSUE program. The image is public-domain source material. Read it and return only the fields defined below.

This is a neutral public-records task. Describe what the document reports. Do not interpret, dramatize, or draw conclusions about what the phenomenon was, whether it was extraterrestrial, or whether it posed a threat. Every case in this archive is officially unresolved; your summary must not resolve it.

Return a single JSON object and nothing else — no preamble, no code fences, no commentary:

```json
{
  "summary": string,
  "objectClass": "orb" | "disc" | "fireball" | "light" | "triangle" | "craft" | "other" | "unknown",
  "redactionPct": integer 0-100 | null,
  "reviewFlags": string[]
}
```

Field rules:

- **summary** — one or two plain, factual sentences describing what the document reports: who observed what, where and when if stated, and the reported behavior of the object. Use your own words; do not quote at length. Sentence case. Banned words and framings: "alien," "extraterrestrial," "UFO" as a conclusion, "mysterious," "otherworldly," "unexplained" as an editorial flourish, and any phrasing that implies the object's origin or intent. If the document is a witness account, attribute it as reported (e.g. "a field report describes...") rather than stating it as fact.

- **objectClass** — the reported shape/type of the primary object, chosen from the enum. Classify only what the document describes. If only a light or glow is described with no shape, use "light." If the description is insufficient, use "unknown." Do not upgrade a described light to a structured "craft" without described structure. (Full definitions and government-term mappings are maintained separately by the ingest maintainers.)

- **redactionPct** — estimate the percentage of the page area covered by redaction (solid black bars or boxes) as an integer 0–100. Use 0 if the page has no visible redaction. Use null if the media is not a page scan (a photograph, rendering, or video still). Do not attempt to read, guess, or describe anything under a redaction — only estimate the area it covers.

- **reviewFlags** — a list flagging anything a human should double-check. Use "illegible" if the document can't be read reliably, "ambiguous-object" if the object type is genuinely unclear, "non-document-media" if it's a photo/render/still rather than a document, and "heavily-redacted" if redaction obscures the substance of the case. Empty list if none apply.

If you cannot determine a field, use "unknown" or null and add an appropriate review flag. Never fabricate a value to fill the field.

## Notes for maintainers

- Keep the banned-words list in sync with `references/examples.md`.
- The object enum here must match `ObjectClass` in `schema.ts` exactly. If you add a class, update the schema, this prompt, and `references/object-taxonomy.md` together.
- Redaction estimation is deliberately coarse (whole-page percentage). Don't over-engineer it into per-bar measurement unless the redaction-analysis feature (Phase 4) needs finer data — and if it does, add that as a separate pass, not by complicating this prompt.
