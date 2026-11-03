# sysone documentation

sysone turns Zod models on the server into scoped REST endpoints, and gives the browser typed React hooks that import only the API's type.

## Reading order

If you are new, read the first three pages in order. Then read the pages for what you are building.

1. [Getting started](./getting-started.md): build a server and a React picker and list in about five minutes.
2. [Models](./models.md): every `defineModel` option, the supported Zod field types, and the compile errors for misuse.
3. [Access rules](./access.md): who may read and write which rows, with recipes for public, multi-tenant, owner-only, and role-based models.

## Server

- [Servers](./servers.md): `sysone()`, Express and `node:http` with `nodeHandler`, Bun, Hono, and Elysia with `fetchHandler`, context, and several APIs in one server.
- [Sources](./sources.md): memory, Postgres and MySQL without an ORM, Drizzle, Prisma, and MongoDB, with setup code and caveats for each.
- [Writing a source](./writing-a-source.md): the source contract, the condition tree, and how to test a new source with `testSource`.

## Browser

- [Querying lists](./querying.md): search, filters, sorting, includes, cursors, and limits, from the client and as raw HTTP.
- [Client](./client.md): `createClient`, writes, errors, how the cache reloads lists, use without React, and sharing the `Api` type.
- [React hooks](./react.md): `useList`, `useGet`, and `useSelect`, with recipes for comboboxes, tables, infinite scroll, detail pages, and forms.

## Reference

- [Limitations](./limitations.md): what 0.1.0 does not do yet, and its known issues.
- [Wire spec](../SPEC.md): the HTTP format that every sysone server and client follows, with the JSON test cases.
- [Contributing](../CONTRIBUTING.md): set up the repository and run the checks.

Every TypeScript example in these pages is compiled against the real packages in CI by `pnpm --filter docs-examples check`.
