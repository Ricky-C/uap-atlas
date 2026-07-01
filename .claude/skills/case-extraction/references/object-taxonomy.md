# Object taxonomy

The `objectClass` enum, what each value means, how the government's own terms map onto it, and how to disambiguate. This enum must match `ObjectClass` in `schema.ts` exactly.

Classify what the document *describes*, not what it "must have been." These are subjective observer reports; the goal is a faithful category for the reported observation, not a verdict on the object.

## Classes

| **Class** | **Meaning** | **Common source terms** |
| --- | --- | --- |
| `orb` | A round or spherical luminous object with a discernible body | orb, sphere, ball of light, "green orb," glowing ball |
| `disc` | A flat, circular or saucer-shaped object | disc, saucer, "flying saucer" |
| `fireball` | A burning or streaking luminous object, often trailing | fireball, streak, "meteor-like" (as reported, not as resolved) |
| `light` | One or more lights or a glow with no discernible structure or shape | light, lights, string of lights, glow, glare, "point of light" |
| `triangle` | A triangular, delta, V, chevron, or boomerang form | triangle, delta, V-shaped, chevron, boomerang |
| `craft` | A structured, solid-bodied object not covered above | cigar, cylinder, "tic-tac," lozenge, football-shaped, rectangular, "mothership" |
| `other` | Clearly describable but none of the above | (e.g. a described formation that is itself the phenomenon) |
| `unknown` | Insufficient information to classify | illegible, contentless, or too vague to place |

## Disambiguation rules

- **Specific over general, but only as supported.** Choose the most specific class the wording actually supports. If torn between a specific shape and a general one, use the one the document supports; if it only describes luminosity with no shape, use `light`; if it describes almost nothing, use `unknown`.
- **Round light vs. shapeless light.** A luminous *round/spherical* object → `orb`. A light or glow with no described shape → `light`. Don't promote a shapeless light to `orb` just because it's bright.
- **Tic-tac / cigar / cylinder →** `craft`**.** These solid, elongated, structured bodies are `craft`, not `light` or `orb`.
- **Reported structure required for** `craft`**.** Only use `craft` when the document describes an object with apparent solidity or geometry. A described light, however anomalous its motion, stays `light` unless structure is reported.
- **Multiple objects.** Classify the primary object. If the phenomenon is a *formation* of lights with no individual shape given, use `light`; if the formation itself is the described subject and doesn't fit a shape, `other`.
- **Video stills / photos / renderings.** Classify the object shown if it's clear; otherwise `unknown` with a `non-document-media` review flag (media handling is set in the prompt, not here).

## Changing the taxonomy

If a real class of object recurs that none of these fit well, add a class — but add it in three places at once: `ObjectClass` in `schema.ts`, the enum in `references/prompt.md`, and this table. Keeping them in sync is the whole point of the skill being the source of truth. Resist adding narrow one-off classes; `other` exists for the long tail.
