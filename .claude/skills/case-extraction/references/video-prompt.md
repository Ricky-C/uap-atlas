# Canonical extraction prompt — released videos (text mode)

This is the source of truth for the VIDEO enrichment prompt. `ingest/enrich.ts` sends this verbatim, followed by the portal CSV's official Description Blurb, to `claude-sonnet-5` — text only, no image. It exists as its own file (its own sha) so tuning it can never move the document corpus' cache keys: adding or editing this prompt re-bills zero documents.

The call is a single user message: this prompt text, then a `--- OFFICIAL RELEASE DESCRIPTION ---` divider, then the blurb. The output contract is identical to the document prompt's, so the same schema, validation, cache shape, and patch pipeline apply.

## Prompt text

You are extracting structured metadata for a declassified U.S. government UAP video released through the PURSUE program. You are given the video's official release description (public-domain text written by the releasing agency), not the footage itself. Read the description and return only the fields defined below.

This is a neutral public-records task. Describe what the release reports. Do not interpret, dramatize, or draw conclusions about what the phenomenon was, whether it was extraterrestrial, or whether it posed a threat. Every case in this archive is officially unresolved; your summary must not resolve it.

Return a single JSON object and nothing else — no preamble, no code fences, no commentary:

```json
{
  "summary": string,
  "objectClass": "orb" | "disc" | "fireball" | "light" | "triangle" | "craft" | "other" | "unknown",
  "redactionPct": null,
  "incidentDate": string | null,
  "incidentLocation": string | null,
  "reviewFlags": string[]
}
```

Field rules:

- **summary** — one or two plain, factual sentences describing what the video reportedly shows: who observed what, where and when if stated, and the reported behavior of the object. Use your own words; do not quote at length. Sentence case. Banned words and framings: "alien," "extraterrestrial," "UFO" as a conclusion, "mysterious," "otherworldly," "unexplained" as an editorial flourish, and any phrasing that implies the object's origin or intent. Attribute reported observations as reported (e.g. "an eyewitness described...", "footage captured by a Navy aircrew reportedly shows...") rather than stating them as fact. Do not summarize the release's administrative language (authentication, cropping, privacy notes) — summarize the incident.

- **objectClass** — the reported shape/type of the primary object, chosen from the enum. Classify only what the description describes. If only a light or glow is described with no shape, use "light." If the description is insufficient, use "unknown." Do not upgrade a described light to a structured "craft" without described structure.

- **redactionPct** — always null. A video has no page area to measure.

- **incidentDate** — the date of the reported incident itself, exactly as precise as the description states it, in ISO form: "2024-10-15" (full date), "2024-10" (month known), "2022" (year only). This is the date the observation happened — NOT the release date or analysis date. Use null if the description does not state when the incident occurred. Never infer a date.

- **incidentLocation** — where the reported incident occurred, as a concise place string the way the description states it (e.g. "northeastern United States", "Arabian Gulf"). Use null if the description does not state a location, and null — never a reconstruction — if the location is withheld to protect a person's privacy or for any other stated reason.

- **reviewFlags** — a list flagging anything a human should double-check. Use "ambiguous-object" if the object type is genuinely unclear, "ambiguous-date" if a date is stated but it is unclear whether it is the incident date, "ambiguous-location" if a place is mentioned but it is unclear whether the incident happened there, and "thin-description" if the description is too sparse to summarize meaningfully. Empty list if none apply.

Witness identities are protected in these releases ("a private citizen", "an eyewitness"). Preserve that anonymity exactly — never speculate about who a witness is, where they live, or any identifying detail, even if the description hints at one.

If you cannot determine a field, use "unknown" or null and add an appropriate review flag. Never fabricate a value to fill the field.

## Notes for maintainers

- The output contract is deliberately identical to `prompt.md`'s (same JSON shape, `redactionPct` pinned to null) so `enrich.ts` shares one schema, validator, cache shape, and patch path for both modes.
- Blurbs come from the portal CSV's Description Blurb column at enrich time (never persisted into records.json); the cache key is the record id (`dvids-<id>`) with this prompt's sha.
- Editing the "## Prompt text" section re-bills only the ~84 video records (text-only, cheap); it never touches the document cache.
- Keep the banned-words list in sync with `prompt.md` and `references/examples.md`.
