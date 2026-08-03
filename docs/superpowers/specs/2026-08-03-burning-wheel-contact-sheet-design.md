# Burning Wheel Contact Sheet Design

## Goal

Create a single preview image containing four clearly different burning racing-wheel concepts. The user will select one concept before any website asset is replaced.

The final selected artwork will replace the RC car image in the `CREATOR CHALLENGE / BEAT THE PRO LAP` card on the RC Mania home page.

## Existing UI Context

- The challenge card uses a dark red-to-black background and a thin dark-red frame.
- Artwork occupies the right side of the card, currently at roughly 55% of its width.
- The left side contains the headline, supporting copy, and `$1,000` value and must remain readable.
- The card currently applies reduced opacity and `screen` blending to its artwork.

## Contact Sheet

Create one square 2x2 contact sheet with generous separation and padding. Each quadrant contains one isolated wheel, angled three-quarters toward the viewer and visually moving toward the right. Flames should trail toward the upper-right or right edge so the selected asset will naturally fit the card composition.

The four concepts are:

1. **Photoreal** — black racing tire, realistic metallic rim, dense orange-red flames.
2. **Racing poster** — high-contrast graphic treatment, angular shapes, sharp red and orange fire.
3. **Cinematic drift** — heated rim, strong flame core, sparks, and the clearest sense of speed. This is the recommended direction for the existing card.
4. **Cyber racing** — dark technical rim, red-orange fire, and restrained cyan accents that echo the RC Mania palette.

## Visual Constraints

- Wheel only: no car body, driver, road, environment, logos, brand marks, or watermark.
- One wheel per quadrant, fully visible, with a clean outer silhouette.
- The four concepts must be materially different rather than minor variations.
- No generated text. Quadrant numbers `1` through `4` will be added during local post-processing for reliable labeling.
- The wheel and fire must not use chroma green.
- Avoid heavy smoke or soft atmospheric effects that would produce unusable transparent edges.

## Transparency and Preview Format

Use the built-in image generation workflow on a perfectly flat `#00ff00` chroma-key background. Remove the background locally with the installed chroma-key helper, validate the alpha channel and edge quality, then save the numbered contact sheet as WebP with transparency.

The contact sheet is a selection preview only. It will not be referenced by production code.

## Selected Asset Integration

After the user selects a concept:

1. Produce a clean single-wheel version without the quadrant number.
2. Remove the background and save it as `apps/web/public/assets/challenge-burning-wheel.webp` with alpha transparency.
3. Replace the current `/assets/car-red.webp` reference only in the Creator Challenge card.
4. Tune the card artwork sizing and positioning only if required to preserve headline readability and the existing hover treatment.
5. Verify desktop and mobile layouts, asset loading, production build, and the final rendered card.

## Acceptance Criteria

- A single transparent WebP preview shows four numbered and clearly distinct concepts.
- All concepts match the approved directions and fit the right-side card composition.
- The user can unambiguously select a variant by number.
- No production website file is changed before the user selects a concept.
- The final selected asset is a lightweight transparent WebP and does not reduce text readability in the challenge card.
