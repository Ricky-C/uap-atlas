# Examples

Few-shot examples for the extraction task: what a good output looks like, what a bad one looks like, and why. These are representative patterns based on the kinds of documents in the PURSUE releases — illustrative, not transcriptions of specific files. Use them when tuning `references/prompt.md` or judging whether a generated summary is neutral.

The recurring failure mode is not wrong facts — it's *tone*: sensational language, or stating a witness account as established fact. Watch for that above all.

## Example 1 — a clear orb field report

Document: an FBI field-interview form describing a witness account of a luminous spherical object near Colorado Springs that reportedly moved faster than a pursuing aircraft. Light redaction on the witness's identifying details.

Good:

```json
{
  "summary": "A field report describes a witness observing a luminous spherical object near Colorado Springs that reportedly accelerated beyond a pursuing helicopter before being lost from view.",
  "objectClass": "orb",
  "redactionPct": 12,
  "reviewFlags": []
}
```

Bad:

```json
{
  "summary": "A mysterious alien orb was seen over Colorado Springs, outrunning military aircraft in an unexplained display of impossible speed.",
  "objectClass": "orb",
  "redactionPct": 12,
  "reviewFlags": []
}
```

Why it's bad: "mysterious alien," "impossible," and "unexplained display" editorialize and imply origin; it states the account as fact rather than as reported. The good version attributes it ("a field report describes...") and describes behavior plainly.

## Example 2 — a heavily redacted document

Document: a memo whose substantive paragraphs are almost entirely covered by black redaction bars; only a date and a location header are legible.

Good:

```json
{
  "summary": "A memo referencing a reported sighting; the substance of the account is redacted, leaving only administrative header information legible.",
  "objectClass": "unknown",
  "redactionPct": 78,
  "reviewFlags": ["heavily-redacted"]
}
```

Bad:

```json
{
  "summary": "A memo about a triangular craft; the redacted text likely describes a covered-up military encounter.",
  "objectClass": "triangle",
  "redactionPct": 78,
  "reviewFlags": []
}
```

Why it's bad: it invents an object class and a narrative ("triangular craft," "covered-up") from redacted content it cannot read — a de-anonymization/fabrication violation. The good version reports only what's legible, classes it `unknown`, and flags it.

## Example 3 — a video still (non-document media)

Document: an infrared video still showing a bright point of light against a dark background, no accompanying text.

Good:

```json
{
  "summary": "An infrared still frame shows a single bright point of light against a dark background, with no accompanying textual detail.",
  "objectClass": "light",
  "redactionPct": null,
  "reviewFlags": ["non-document-media"]
}
```

Bad:

```json
{
  "summary": "Thermal footage captures a fast-moving UFO glowing with heat signatures unlike any known aircraft.",
  "objectClass": "orb",
  "redactionPct": 0,
  "reviewFlags": []
}
```

Why it's bad: "UFO... unlike any known aircraft" concludes and dramatizes; "fast-moving" isn't supported by a single still; `orb` over-specifies a shapeless point (should be `light`); `redactionPct` should be `null` for non-page media, not `0`; and the `non-document-media` flag is missing.

## Example 4 — an ambiguous object

Document: a report describing "several objects in a rough formation" without giving any individual shape, at night.

Good:

```json
{
  "summary": "A report describes several objects observed at night in a loose formation; no individual shape is given.",
  "objectClass": "light",
  "redactionPct": 4,
  "reviewFlags": ["ambiguous-object"]
}
```

Bad:

```json
{
  "summary": "A fleet of craft flew in tight formation, suggesting coordinated intelligent control.",
  "objectClass": "craft",
  "redactionPct": 4,
  "reviewFlags": []
}
```

Why it's bad: "fleet of craft," "tight," and "coordinated intelligent control" add specificity and interpretation the document doesn't support; `craft` requires described structure. The good version reports the formation plainly, uses `light` (no shape given), and flags the ambiguity.

## Tuning checklist

When reviewing generated summaries, reject any that:

- use a banned word or imply origin/intent,
- state a witness account as established fact instead of as reported,
- describe or infer anything under a redaction,
- assign an object class more specific than the document supports,
- assert motion or detail not present in a single still image.
