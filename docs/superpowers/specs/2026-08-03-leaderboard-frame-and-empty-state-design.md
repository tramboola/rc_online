# Leaderboard Frame and Empty-State Design

## Goal

Fix clipped-frame hover artifacts, make the leaderboard honest in production mock mode, route the rules action to the existing How It Works page, and remove the premature Past Seasons action.

## Frame Rendering

`--frame-color` will be the single source of truth for every clipped frame covered by the shared frame system.

- The native `border-color` and diagonal `::before` corner strokes will both derive from `--frame-color`.
- Component and tone selectors will assign frame colors through `--frame-color` instead of maintaining a second direct border color.
- Hover states will animate only `--frame-color`; transforms and icon movement may keep their existing independent transitions.
- The How It Works hero will explicitly set `--frame-color: var(--cyan)` so its straight edges and diagonal corners match at rest and during hover.
- The fix applies to the shared clipped-frame system, preventing the same mismatch on other framed controls such as View Rules.
- Reduced-motion behavior will remain intact.

## View Rules Navigation

The View Rules control in the leaderboard season banner will be rendered as a semantic link using the existing action-button visual style.

- Destination: `/how-it-works`.
- It will retain the cyan frame treatment and arrow affordance.
- Browser QA will verify both keyboard-visible semantics and navigation.

## Mock Leaderboard State

When `MOCK_MODE=true`, the leaderboard will not show invented drivers, lap times, dates, rankings, or season activity.

- The season banner will show `COMING SOON` and `DATES TBA` instead of a live season and an end date.
- Prize information will display an em dash and a `PRIZE POOL TBA` label.
- The ranking table will keep its existing columns and render three placeholder rows containing em dashes.
- The table will include a clear `SEASON HASN'T STARTED YET` message.
- The Your Season panel will remain in the layout but show em dashes for rank, personal best, valid laps, and weekly change.
- The highlighted personal row will not render in mock mode.
- The Past Seasons action will not render at all.

Outside mock mode, the current populated leaderboard presentation will remain available until it is replaced by real backend data.

## Component Boundaries

Mock and non-mock leaderboard content will be selected through a small presentation helper rather than scattered conditional literals in JSX. The helper will expose the banner labels, table rows, empty-state label, personal metrics, and whether the personal row is visible.

`SimulationScreen` will pass its existing `mockMode` value into `LeaderboardScreen`. No new API calls or database changes are required.

## Testing

Automated tests will cover:

- mock mode contains no fabricated driver or lap data;
- mock mode exposes three placeholder rows and the pre-launch labels;
- non-mock mode retains the current populated presentation;
- View Rules points to `/how-it-works`;
- Past Seasons is absent;
- shared clipped frames derive their native border from `--frame-color` and hover does not maintain a separate border-color animation channel.

Rendered browser QA will cover desktop and mobile layouts, console health, the empty leaderboard, View Rules navigation, and hover behavior for the How It Works hero and View Rules control.

## Non-Goals

- Creating a separate rules page.
- Loading real leaderboard results from the backend.
- Implementing archived seasons.
- Changing authentication, balances, pricing, or race controls.
