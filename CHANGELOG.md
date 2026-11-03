# Changelog

## 0.1.1 (2026-11-03)

Fixes:

- `@sysonejs/mongo`: `objectIds` now takes model field names. Passing `_id` maps to the id field instead of breaking gets by id.
- Included relations are typed as `row | null` for every relation. A row the caller may not read is `null` even when its key is not nullable.
- A create rule with a list of values is now a compile error. Before, it compiled and then failed on every create request.
- `cursor` is no longer accepted by `useList`, `useSelect` and `watchList`, where it was ignored. Use `loadMore()`.

Other:

- Documentation in `docs/`, with every code sample compiled in CI.
- A rewritten README, `CONTRIBUTING.md`, and automatic npm publishing from CI with provenance.

## 0.1.0 (2026-11-03)

First public release.

Packages: `sysonejs`, `@sysonejs/react`, `@sysonejs/sql`, `@sysonejs/drizzle`, `@sysonejs/prisma`, and `@sysonejs/mongo`.

- `defineModel` with a Zod object schema and the `write`, `search`, `filter`, `sort`, `defaultSort`, `limit`, `maxLimit`, `relations`, `id`, and `access` options.
- `sysone()` serves models as REST endpoints: list, get, create, update, and delete.
- `nodeHandler` for Express and `node:http`, and `fetchHandler` for Bun, Hono, Elysia, and other fetch runtimes.
- Access rules per action, closed by default. Reads, updates, and deletes carry the rule in the same database statement. Creates stamp the rule's values.
- Lists with search, filters with any-of, `null`, and ranges, up to 3 sort fields, belongs-to includes, and keyset paging.
- `createClient` with one row cache shared by all lists and gets, and list reloads limited to lists that a write affects.
- React hooks `useList`, `useGet`, and `useSelect`.
- Sources for memory, Postgres and MySQL without an ORM, Drizzle, Prisma, and MongoDB, all checked by `testSource`.
- The wire spec in `SPEC.md`, with 91 JSON test cases.
