# Dependency security remediation — 2026-07-25

Outcome: `fixed`.

## Vulnerable path and invariant

`pnpm audit --prod --audit-level high` found production-reachable vulnerable
versions through `@rc/database`, Next.js, Nest/Fastify, and Swagger. The
invariant is that a clean production lockfile contains no known high-or-higher
advisory while preserving the database, image, CSS, routing, and OpenAPI
behaviour used by the build.

## Narrow patch

- upgraded direct `drizzle-orm` to 0.45.2;
- pinned patched transitive boundaries: `sharp` 0.35.0, `postcss` 8.5.18,
  `find-my-way` 9.7.0, and `js-yaml` 5.2.2;
- regenerated `pnpm-lock.yaml`.

This is narrower than framework replacement and leaves application APIs
unchanged.

## Verification

- `pnpm -r why ...`: exactly one patched version of each package.
- `pnpm audit --prod --audit-level high`: PASS, no known vulnerabilities.
- `pnpm check`: PASS after remediation, including strict types, tests and
  Next/Nest/edge production builds.

The original vulnerable versions no longer occur in the resolved production
graph. Legitimate behaviour remains covered by all workspace tests and builds.
