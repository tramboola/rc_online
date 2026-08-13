# Administrator Live Access Design

## Goal

Allow selected RC Mania users to access the real driving flow while the public
site remains in preview mode. The first administrator is
`greennmoto@gmail.com`.

## Existing Data Model

The `users` table already has a `role` column with `user` as its default. The
feature will use this existing field instead of adding a duplicate boolean.
Supported application roles for this change are `user` and `admin`. Unknown or
missing values must be treated as `user`.

## Authentication and Authorization

The authentication store will return the user's role with the existing user
record. The Auth.js session callback will copy the normalized role into
`session.user.role`, alongside the existing user ID and balance.

When `MOCK_MODE=true`, these routes are restricted to authenticated
administrators:

- `/preflight`
- `/queue`
- `/ride`
- `/results`
- `/operator`

Authorization is enforced during server rendering. A non-administrator who
opens a restricted URL directly is redirected to `/`; hiding the button alone
is not considered authorization. Public pages remain unchanged.

## Home Page Behavior

The public preview behavior remains unchanged for anonymous and regular users:

- eyebrow: `PREVIEW / COMING SOON`
- disabled CTA: `COMING SOON`
- preview video labeling
- mock operational metrics

An authenticated administrator receives an access override while the global
mock mode remains enabled:

- active CTA: `START DRIVING`
- CTA target: `/preflight`
- no public `COMING SOON` CTA
- car availability and active queue metrics are loaded from production data

The preview video is not relabeled as a live public broadcast merely because
an administrator is signed in.

## Real Operational Data

Administrator operational status is read on the server from PostgreSQL.

Available cars are rows in `cars` where:

- `state = 'AVAILABLE'`
- `admin_blocked = false`

The active queue contains unexpired entries whose status is `waiting`,
`offered`, or `accepted`.

There is no fallback to fictional cars or queue values. If the query succeeds
and no cars exist, the administrator sees `0 CARS AVAILABLE`. If operational
data cannot be loaded, the UI displays an unavailable state and does not
invent a number.

The queue car selector uses the same production car data. When no available
car exists, it renders an empty state and disables the connect action.

At the time this design was approved, production contains no rows in `cars`
and no active queue entries. The expected initial administrator result is
therefore zero available cars.

## Administrator Assignment

Deployment includes an idempotent production database update:

```sql
update users
set role = 'admin', updated_at = now()
where lower(email) = 'greennmoto@gmail.com';
```

The deployment must verify that exactly one user was updated and read the role
back after the change. No OAuth identity, balance, session, or user profile is
recreated.

## Component Boundaries

- The auth store owns role loading and normalization.
- Server pages own access checks and production-status loading.
- Presentation helpers decide which CTA and metrics to render from explicit
  `mockMode`, role, and operational-status inputs.
- Client components render supplied data and do not decide authorization.

This keeps database credentials and role enforcement out of browser code and
avoids a post-hydration access flash.

## Failure Handling

- Unauthenticated and regular users retain the public preview.
- Unknown roles fail closed as `user`.
- A failed production-status query shows unavailable operational data.
- A direct unauthorized request to a restricted route redirects to `/`.
- An empty car list is a valid production state, not an error.

## Verification

Automated tests will cover:

- role mapping and safe normalization;
- the role included in the Auth.js session;
- public users retaining the disabled `COMING SOON` CTA;
- administrators receiving `START DRIVING` linked to `/preflight`;
- administrator metrics using real values, including zero cars;
- restricted mock-mode routes rejecting non-administrators;
- queue rendering and action disabling when no real car is available.

Before deployment, run the web test suite, typecheck, and production build.
After deployment, verify the administrator role in PostgreSQL, container
health, the public preview behavior while signed out, and the administrator
flow while signed in.
