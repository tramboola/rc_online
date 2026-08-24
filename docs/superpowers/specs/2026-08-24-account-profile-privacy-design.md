# Account, Profile, and Privacy Design

## Goal

Extend the deployed RC Mania web application with secure email-and-password
accounts while preserving Google sign-in and the existing database-backed
session model. Add private profile management, preset avatars, self-service
account deletion, public legal documents, an Instagram link, and a viewer count
that does not persist an identifier in the browser.

This work starts from the deployed stable revision `9e0f02f`. Existing Google
users, roles, balances, rides, and active vehicle integrations must continue to
work without migration by the user.

## Chosen approach

Keep Auth.js as the Google OAuth and session-reading boundary. Auth.js's built-in
Credentials provider requires JWT sessions and is therefore incompatible with
RC Mania's existing database-session strategy. A focused password sign-in route
will verify the PostgreSQL credential, create the same opaque database session,
and set the same explicitly configured host-only session cookie that Auth.js
reads. Focused application services will own registration, email verification,
password reset, profile updates, account deletion, and transactional email
delivery through Resend.

This is preferred over moving authentication to Clerk or Supabase because it
preserves existing users and sessions, avoids another identity processor, and
keeps authorization decisions in the current application. Switching Auth.js to
JWT sessions merely to use its Credentials provider is rejected because it
would replace the current revocable database sessions. A fully custom session
system is also rejected because it would duplicate the session-reading and
Google OAuth behavior Auth.js already provides.

## User experience

### Signed-out account entry

The existing header account control opens one RC Mania-styled authentication
dialog instead of immediately redirecting to Google. The dialog has `SIGN IN`
and `CREATE ACCOUNT` views and provides:

- a Google sign-in action;
- email and password fields;
- a `FORGOT PASSWORD?` action on sign-in;
- email, password, and password-confirmation fields on registration;
- links to the Terms of Service and Privacy Policy.

The registration form does not include an age gate or a mandatory consent
checkbox. It displays concise notice that continuing means agreeing to the
Terms of Service and acknowledging the Privacy Policy. Legal-document versions
shown at registration are recorded with the account event for auditability.

Authentication errors use generic wording so the UI does not disclose whether
an email address already has an account. Keyboard focus is trapped inside open
dialogs, Escape closes non-destructive dialogs, and all controls have visible
focus and accessible labels.

### Email registration and verification

1. The user submits a normalized email and password.
2. The server validates the request, applies rate limits, and creates a pending
   password credential plus a one-time verification token.
3. A database transaction creates the user when needed, assigns a generated
   public nickname such as `Driver-7K4M`, selects a default preset avatar, and
   creates a zero USD balance.
4. Resend sends a verification link from
   `RC Mania <accounts@updates.rcmania.live>`.
5. The link stores only a cryptographically random token in the URL; the
   database stores its hash and expiration.
6. Successful verification marks the email verified, consumes the token, and
   permits password sign-in.

Verification responses remain generic. Repeated registration or resend
requests do not reveal whether the address is already registered. Expired or
consumed links offer a safe resend path.

### Password sign-in and recovery

Password sign-in uses the same seven-day database session policy as Google
sign-in. Password reset always reports a generic success state, creates a
single-use short-lived token only for an eligible account, and emails the reset
link through Resend. Completing a reset replaces the password hash, consumes
all outstanding reset tokens, and revokes every existing session for that
user.

An existing verified Google user can add password access by registering the
same normalized email and completing email verification. A verified password
user signing in through Google with the same verified email is linked to the
same user only when there is no conflicting Google identity. This preserves
one balance, role, nickname, and ride history.

### Default public identity

Registration never requires onboarding before a first ride. Every new account
receives:

- a unique, non-identifying nickname in the form `Driver-XXXX`;
- a default preset RC Mania avatar identifier.

Google display names and email local-parts are not used as public fallbacks.
Existing accounts without a nickname receive the same generated identity
lazily or during the migration backfill before any public presentation uses
their profile.

### Profile dialog

The signed-in account menu adds `EDIT PROFILE` immediately above
`MANAGE BALANCE & PLANS`. It opens a modal that displays only the current
user's data and allows the user to:

- choose a unique nickname;
- select one avatar from a bundled set of RC Mania preset avatars;
- save changes;
- start account deletion.

Nickname normalization trims whitespace and applies Unicode normalization.
Nicknames are case-insensitively unique, have a bounded length, reject control
characters and impersonation of system/admin identities, and pass a small
reserved-name list. The UI provides an inline availability/error state without
exposing another account.

Preset avatar files are bundled immutable WebP assets. The database stores only
an allowlisted avatar key. Arbitrary URLs, uploads, SVG markup, and external
profile-image hotlinks are not accepted.

### Account deletion

Deletion is a destructive action behind a separate confirmation step. The
confirmation clearly describes loss of access and signs the user out when it
completes.

Deletion immediately:

- revokes all sessions;
- removes password credentials, verification/reset tokens, and OAuth
  identities;
- removes nickname, avatar selection, and consent/audit evidence that is not
  required for a legal claim;
- replaces email and display fields with non-reversible deleted-account
  placeholders;
- disables the user record so it cannot authenticate again.

Financial ledger, payment, abuse-prevention, and ride-integrity records may be
retained only where contract, tax, accounting, fraud, or legal-claim duties
require it. Retained records use the internal random user ID and contain no
email, nickname, OAuth subject, password material, or avatar. The Privacy Policy
describes these limited retention purposes and periods. Re-registering later
creates a new account and does not restore deleted history.

## Password and token security

- Passwords are never logged, emailed, returned by an API, or stored in plain
  text.
- Passwords are hashed with Argon2id and a per-password random salt. The
  initial parameters are at least 19 MiB memory, two iterations, and one degree
  of parallelism; the encoded hash versions its algorithm and parameters so a
  successful future login can safely rehash stronger settings.
- Registration accepts 12 to 128 Unicode characters, never silently truncates,
  and permits password-manager-generated passphrases without restrictive
  composition rules.
- Password comparisons and token comparisons use constant-time primitives
  where applicable.
- Verification and reset tokens are generated from a cryptographically secure
  source. Only token hashes are stored.
- Tokens have short explicit lifetimes, are single-use, and are invalidated by
  relevant password/account changes.
- Registration, sign-in, resend, reset, nickname, and deletion endpoints have
  bounded per-IP and per-account rate limits. A short-lived PostgreSQL limiter
  stores only keyed HMAC digests of the IP/account keys, not raw IP addresses
  or emails. Rate-limit keys do not appear in client responses.
- State-changing requests require an authenticated same-origin session and
  CSRF-safe request handling. Client-provided user IDs are never trusted.

The Resend API key remains server-only in the protected VPS environment file.
It is never exposed through a `NEXT_PUBLIC_` variable, Docker image layer,
application log, test fixture, or Git commit.

## Data model

### Existing records

- `users` remains the durable internal account and role record.
- `oauth_identities` continues to map Google subjects to users.
- `auth_sessions` remains the source of truth for browser sessions.
- `account_balances` remains the money-balance projection.
- `nicknames` becomes the source of truth for public display names.
- `consents` records the legal-document versions presented for account actions
  without treating the notice as an optional marketing consent.

### User profile additions

Add a required allowlisted `avatar_key` column to `nicknames`, with a safe
default key for migration. Every active user has exactly one nickname row and
one valid avatar key after backfill.

### Password credentials

A password-credential table stores one credential per user:

- user ID;
- versioned password hash;
- password change timestamp;
- creation and update timestamps.

It does not store password hints, plaintext, recoverable encryption, or a
second copy of the email.

### Account-action tokens

A single-purpose token table stores hashed verification and password-reset
tokens with:

- token kind;
- user ID;
- token hash;
- expiration and consumed timestamps;
- creation timestamp.

Constraints prevent token reuse and indexes support token lookup and expired
token cleanup. Email-verification tokens expire after 24 hours, password-reset
tokens expire after 30 minutes, and unverified accounts with no other identity
are cleaned up after seven days. Token rows cascade when an account is erased.

## Private data boundary

There is no public user-list or arbitrary-user profile endpoint in this scope.
Account endpoints derive the subject from the server session and return an
explicit allowlist of fields. They never return password hashes, token hashes,
OAuth subjects, session tokens, role-management data, another user's email,
balance, or internal audit metadata.

Future leaderboard/public-driver responses may expose only nickname, selected
preset avatar, and public racing results. Email, legal name, balance, account
role, internal user ID, sign-in provider, and session activity remain private.

Authorization tests cover unauthenticated access and attempts to address a
different user. Application logs continue to redact cookies, authorization
headers, secrets, emails in authentication payloads, and token-bearing URLs.

## Viewer count without browser tracking

Remove `rcmania_viewer_id` and all localStorage-based viewer identity code. The
home page opens a dedicated anonymous WebSocket connection to the existing
gateway viewer endpoint. The gateway counts currently open viewer sockets and
broadcasts the current count when sockets open or close.

The production topology has one gateway instance, so its in-memory connection
set is the authoritative live count. A future multi-gateway rollout will need a
shared presence backend and is outside this iteration.

The viewer socket:

- does not set a cookie or use localStorage/sessionStorage;
- does not require or accept an account identifier;
- does not persist an IP address or user agent;
- has bounded connection, payload, and idle behavior;
- accepts no control, device, authentication, or signaling messages;
- reports only the aggregate active count.

This path is isolated from authenticated vehicle/device sockets. Nginx proxies
it using the existing WebSocket upgrade configuration. The UI shows an honest
unavailable state if the connection fails and reconnects with bounded backoff.

## Legal pages

Add public `/privacy` and `/terms` pages in English using the existing RC Mania
visual system. Both pages include an effective date, revision identifier, and:

- operator: Aspect Estates s.r.o.;
- IČO: 28355920;
- DIČ: CZ28355920;
- registered office: Gorazdova 355/5, Nové Město, 120 00 Praha 2,
  Czech Republic;
- Commercial Register reference: C 215134/MSPH;
- contact: `support@rcmania.live`.

The Privacy Policy describes account, authentication, session, operational,
ride, payment, support, and security data; purposes and lawful bases; service
providers; international transfers; retention; user rights; deletion; security
contact; necessary browser storage; and the absence of advertising analytics
and behavioral tracking. Resend, Google, infrastructure providers, and future
payment processors are identified by role rather than implied to receive every
category of data.

The Terms describe account use, remote control of physical vehicles, session
limits, acceptable behavior, service availability, pricing and payment rules,
refund handling, intellectual property, suspension, account deletion,
liability limitations subject to mandatory consumer law, governing law, and
contact details. The service does not show an age gate; the Terms state that it
is not directed to children under 13 and that RC Mania does not knowingly
collect their account data.

The documents are implementation-ready product drafts, not a substitute for
final review by Czech counsel before taking consumer payments internationally.

## Navigation and Instagram

Add persistent `PRIVACY`, `TERMS`, and an Instagram icon/link to a compact legal
footer available on all non-driving public pages. The Instagram link opens
`https://www.instagram.com/rcmania.live/` in a new tab with safe external-link
attributes and an accessible name. Legal links are also present in the
authentication and account-deletion flows.

The live ride view remains visually unobstructed; it may expose legal links
through the existing menu rather than a new overlay.

## Email delivery

Resend sends only transactional account messages in this scope:

- verify email;
- reset password;
- password changed;
- account deleted.

No audience, newsletter, marketing automation, analytics pixel, or promotional
campaign is created. Messages contain no password, balance, private ride data,
or unnecessary profile data. Links use the canonical HTTPS origin and expire
as described above. Delivery failure is recorded without logging message bodies
or API credentials, and the UI provides a retry path where safe.

## Testing

- Migration tests cover constraints, unique indexes, cascades, and backfill of
  existing users.
- Password tests cover hashing, verification, wrong passwords, parameter
  upgrades, and malformed stored hashes.
- Registration tests cover normalization, generic duplicate behavior, generated
  nickname/avatar identity, zero balance, rate limits, and transaction rollback.
- Verification/reset tests cover valid, expired, consumed, replayed, and
  cross-purpose tokens plus session revocation after reset.
- Linking tests cover Google-first, password-first, verified-email linking, and
  conflicting identities.
- Profile tests cover self-only access, nickname uniqueness/normalization,
  reserved names, avatar allowlisting, and forbidden cross-user updates.
- Deletion tests cover confirmation, complete credential/session revocation,
  personal-data scrubbing, retained-record anonymization, and failed re-login.
- UI tests cover dialog focus, keyboard use, loading/errors, account-menu order,
  preset avatar selection, destructive confirmation, legal links, and responsive
  layout.
- Viewer tests cover aggregate open/close counts, isolation from drive sockets,
  invalid payload rejection, reconnect behavior, and absence of browser storage.
- Security tests assert that public/API responses contain no private account
  fields and that logs/config never expose secrets or token-bearing URLs.
- Type checks, complete test suites, production build, and desktop/mobile browser
  verification pass before deployment.

## Deployment and rollback

The deployment is additive and begins with a PostgreSQL backup. Database
migrations run before the web/gateway containers are replaced. The protected
VPS environment receives the Resend API key and sender configuration without
printing the key or storing it in source control.

Rollout verification covers existing Google login, email registration,
verification delivery, password sign-in/reset, generated public identity,
profile edits, deletion, private API boundaries, viewer counting, Instagram and
legal links, and unchanged admin/drive access. Existing Google users retain
their role and balance.

If verification fails, restore the prior web and gateway images tagged from
`9e0f02f`. Additive database columns/tables may remain unused; destructive data
migration is not part of rollback.

## Non-goals

- Uploaded or externally hosted user avatars.
- Mandatory profile onboarding before driving.
- An age gate or mandatory terms checkbox.
- Marketing email, newsletters, advertising pixels, product analytics, or
  behavioral tracking.
- Public email addresses, balances, account roles, OAuth identities, or user
  directories.
- Social login providers other than Google.
- Multi-factor authentication in this iteration.
- A full support mailbox or inbound-email webhook.
- Changes to pricing, payment execution, vehicle control, session duration, or
  TURN behavior.
