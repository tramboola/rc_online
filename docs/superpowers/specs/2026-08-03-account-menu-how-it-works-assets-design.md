# Account Menu, How It Works, and Web Asset Optimization Design

## Goal

Fix the authenticated account menu so it does not affect header layout, add a useful balance and plan management action, publish a product-focused How It Works page, and reduce the weight of the website's raster assets.

## Scope

The change covers the Next.js web application only. It does not add a separate account page, payment backend, subscription management backend, or safety-focused marketing content.

## Account menu

The account dropdown remains anchored to the profile chip in the top-right corner. It must use absolute positioning with enough CSS specificity that the shared `data-panel` styles cannot return it to normal document flow. Opening the menu must not change the header height, move the RC Mania logo, or shift the page content.

The signed-in menu contains:

- Google profile initials, display name, and email;
- the current USD account balance;
- a primary `MANAGE BALANCE & PLANS` link to `/pricing#packs`;
- a secondary `SIGN OUT` action.

The menu continues to close on outside pointer interaction and Escape.

## How It Works page

The `/how-it-works` route uses the existing RC Mania visual language: dark technical panels, cyan frames, red accents, condensed typography, cut corners, and the shared site header.

The page is product-focused and explains the user journey in five steps:

1. Sign in with Google.
2. Choose drive time.
3. Join the live queue. The copy explicitly states that when nobody is waiting, the user receives a car immediately without queueing.
4. Check the keyboard or optional game controller.
5. Drive and review the results.

A compact requirements section lists a desktop computer, a modern browser, a stable internet connection, and an optional game controller. The page does not include a safety section or infrastructure deep dive.

The final calls to action are `VIEW PRICING` and `BACK TO LIVE TRACK`.

The header's How It Works navigation item links to `/how-it-works` and receives the active state on that route.

## Asset conversion

All PNG, JPG, and JPEG files under `apps/web/public` are converted to WebP while retaining their source dimensions and alpha channel where present. Existing WebP files remain WebP. Application references are updated, and superseded PNG/JPG/JPEG files are removed so they are not copied into the production image.

Conversion uses a visually conservative quality setting intended to remove the large lossless PNG overhead without introducing obvious artifacts. File counts and total byte size are measured before and after conversion.

Videos, SVG files, fonts, documentation images outside `apps/web/public`, and non-web project assets are outside this conversion scope.

## Validation

- A regression check protects the account dropdown positioning rule.
- Route and presentation tests cover the new How It Works screen and account management destination.
- The full repository lint, typecheck, test, and production build commands pass.
- Rendered browser validation covers the account menu interaction, the How It Works page, and a mobile viewport.
- Browser checks include page identity, meaningful content, absence of framework overlays, relevant console errors, screenshot evidence, and interaction proof.
- Production deployment follows only after the local checks pass and the user requests or confirms publication.

## Success criteria

- Opening the account menu does not move the RC Mania logo or page content.
- The menu exposes both plan management and sign-out actions.
- `/how-it-works` clearly describes the five-step customer journey and the no-wait path when the queue is empty.
- The website loads all converted raster assets without broken references.
- Raster asset byte size is materially lower than before conversion.
