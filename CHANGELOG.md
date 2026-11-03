# Changelog

## Unreleased

- Add documentation in `docs/`, checked in CI by `pnpm --filter docs-examples check`.
- Add `CONTRIBUTING.md`.

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
