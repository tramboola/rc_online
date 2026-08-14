# Keyboard Keycap Polish Design

## Context

The preflight controller card uses the same `kbd` styling for two different
purposes: the large keyboard diagram on the left and the compact binding labels
on the right. The later generic rule overrides the diagram key height, making
the keycaps look compressed.

## Approved direction

Use arcade-style keycaps in the existing RC Mania visual language:

- standard keys are 64 by 54 pixels;
- `SPACE` spans two keys and is 137 pixels wide;
- keys retain the existing cyan border, dark fill, display typeface, and subtle
  inset lower edge;
- the diagram remains centered in its current column and adds no animation,
  gradients, or new colors;
- compact binding labels on the right keep their existing dimensions.

## Implementation boundary

Separate the two visual roles in CSS so binding-label rules cannot override the
diagram keycaps. Make the smallest markup change needed to give the binding list
an explicit class. Do not change keyboard behavior, controller switching,
calibration, responsive routing, or any production data.

## Verification

- Add a regression assertion for the keyboard diagram and binding-list classes.
- Run the web test suite and TypeScript check.
- Render the preflight screen locally in the Browser plugin at desktop size.
- Confirm keyboard/gamepad switching still works, check browser console health,
  and provide the resulting screenshot in chat.
- Do not push or deploy without separate user approval.
