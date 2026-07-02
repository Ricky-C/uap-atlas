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
  "incidentDate": string | null,
  "incidentLocation": string | null,
  "reviewFlags": string[]
}
```

Field rules:

- **summary** — one or two plain, factual sentences describing what the document reports: who observed what, where and when if stated, and the reported behavior of the object. Use your own words; do not quote at length. Sentence case. Banned words and framings: "alien," "extraterrestrial," "UFO" as a conclusion, "mysterious," "otherworldly," "unexplained" as an editorial flourish, and any phrasing that implies the object's origin or intent. If the document is a witness account, attribute it as reported (e.g. "a field report describes...") rather than stating it as fact.

- **objectClass** — the reported shape/type of the primary object, chosen from the enum. Classify only what the document describes. If only a light or glow is described with no shape, use "light." If the description is insufficient, use "unknown." Do not upgrade a described light to a structured "craft" without described structure. (Full definitions and government-term mappings are maintained separately by the ingest maintainers.)

- **redactionPct** — estimate the percentage of the page area covered by redaction (solid black bars or boxes) as an integer 0–100. Use 0 if the page has no visible redaction. Use null if the media is not a page scan (a photograph, rendering, or video still). Do not attempt to read, guess, or describe anything under a redaction — only estimate the area it covers.

- **incidentDate** — the date of the reported incident itself, exactly as precise as the document states it, in ISO form: "1947-08-04" (full date), "2008-07" (month known), "1948" (year only). This is the date the observation happened — NOT the date the document was written, filed, transmitted, or the date of an interview about it. A letter dated 7 April 1949 describing a 1948 sighting has incidentDate "1948" (or finer if stated). Use null if the document does not state when the incident occurred. Never infer a date from context, filing metadata, or a redaction.

- **incidentLocation** — where the reported incident occurred, as a concise place string the way the document states it (e.g. "near Boston, Massachusetts", "Oak Ridge, Tennessee", "Savannah River Plant, South Carolina"). Prefer the most specific place the document gives for the incident itself, not the office that wrote the document (an FBI Knoxville memo about a sighting over Oak Ridge has incidentLocation "Oak Ridge, Tennessee"). Use null if the document does not state a location, and null — never a reconstruction — if the location is redacted or withheld.

- **reviewFlags** — a list flagging anything a human should double-check. Use "illegible" if the document can't be read reliably, "ambiguous-object" if the object type is genuinely unclear, "non-document-media" if it's a photo/render/still rather than a document, "heavily-redacted" if redaction obscures the substance of the case, "ambiguous-date" if a date is stated but it is unclear whether it is the incident date, and "ambiguous-location" if a place is mentioned but it is unclear whether the incident happened there. Empty list if none apply.

If you cannot determine a field, use "unknown" or null and add an appropriate review flag. Never fabricate a value to fill the field.

## Notes for maintainers

- Keep the banned-words list in sync with `references/examples.md`.
- `incidentDate`/`incidentLocation` are document-extracted and take precedence over the portal CSV values in `patchRecords` (the CSV has blanks and outright errors — see the 2026-vs-1987 case). A null extraction never erases a CSV value. Dates are re-normalized through `normalizeDate` at patch time, so minor format drift degrades to null rather than corrupting the field.
- The object enum here must match `ObjectClass` in `schema.ts` exactly. If you add a class, update the schema, this prompt, and `references/object-taxonomy.md` together.
- Redaction estimation is deliberately coarse (whole-page percentage). Don't over-engineer it into per-bar measurement unless the redaction-analysis feature (Phase 4) needs finer data — and if it does, add that as a separate pass, not by complicating this prompt.
