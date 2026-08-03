# Mock Preview Viewer Counter Design

## Goal

Make the public simulation honest about its current availability. When
`MOCK_MODE=true`, the home page must present the experience as coming soon,
must not describe the prerecorded hero video as live, and must replace the
hard-coded audience number with a count derived from active browsers.

## User experience

In mock mode:

- Replace the `START DRIVING` link with a disabled `COMING SOON` control.
- Replace `LIVE / DIRECT` copy with preview-oriented copy.
- Do not render the red `LIVE` badge over the hero video.
- Show `N WATCHING NOW`, where `N` is the current active-browser count.
- Show `AUDIENCE UNAVAILABLE` if the counter endpoint cannot be reached. Never
  substitute a fabricated number.

Outside mock mode, keep the existing `START DRIVING`, live badge, and live copy.
The counter may still report the active browser audience, but this change does
not redefine production authentication or ride availability.

## Active viewer definition

An active viewer is a browser profile that has sent a heartbeat while the home
page was open within the previous 45 seconds. The browser sends a heartbeat
every 15 seconds and stores a randomly generated identifier in `localStorage`.
Multiple tabs in the same browser profile therefore count as one viewer.
Different browsers, private sessions, or devices count separately.

The identifier is opaque and is not combined with an IP address, user agent,
account, or other personal data.

## Architecture

The Next.js web service owns a small in-memory viewer registry. A focused
server module records `viewerId -> lastSeenAt`, removes expired entries, and
returns the number of active entries. A route handler under `/api/viewers`
accepts heartbeats and returns the resulting count.

The home screen owns a small client hook that:

1. Creates or reads the browser identifier.
2. Sends an immediate heartbeat after the page mounts.
3. Repeats the heartbeat every 15 seconds while the page remains mounted.
4. Updates the displayed count from the server response.
5. Switches to the unavailable state when requests fail.

The current deployment uses one Next.js process, so an in-memory registry is
sufficient. The count resets when the container restarts and is not shared
across multiple replicas. Redis is the intended upgrade if the web service is
scaled horizontally.

## API behavior

`POST /api/viewers` accepts JSON containing an opaque `viewerId` string.
Identifiers must be non-empty and bounded in length. A valid request refreshes
that viewer's timestamp and returns `{ "count": number }`. Invalid input
returns HTTP 400. Responses must not expose stored identifiers.

Expired entries are pruned whenever the registry is read or updated. This
avoids a background timer and keeps the implementation safe in the standalone
Next.js process.

## Failure behavior

Failure to count viewers must not block the page or video. The UI displays
`AUDIENCE UNAVAILABLE` and continues rendering the rest of the preview.
Heartbeat timers are cleaned up when the component unmounts.

## Testing

- Unit-test registry deduplication, heartbeat refresh, expiry, and invalid IDs
  with a controllable clock.
- Test the route's success and validation responses against the real registry.
- Test mock and non-mock presentation decisions so mock mode cannot regress to
  live or start-driving copy.
- Run the complete web test suite, TypeScript checks, and production build.
- Verify the home page manually in mock mode at desktop and mobile widths.

## Deployment scope

This change affects the Next.js web image only. It does not deploy the Nest API,
PostgreSQL, Redis, Google OAuth, or real vehicle control. Publishing the new
image to the VPS remains a separate explicit deployment action.
