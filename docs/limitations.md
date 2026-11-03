# Limitations

sysone 0.1.0 is an early release. This page lists what it does not do yet, so you can decide before you build on it.

## Lists and paging

- There is no total count. A list response has `items` and `next`, not the number of matching rows.
- There are no page numbers and no offset paging. Paging is keyset only. You can go forward from a cursor, but you cannot jump to page 7.
- Filters on different fields are ANDed. There is no OR across fields, no "not equal", and no "contains" on one chosen field. `search` covers the model's `search` fields together.
- JSON fields cannot be filtered, sorted, or searched.
- Sorting takes up to 3 fields, only non-null ones, and never fields of a related model.

## Relations

- Only belongs-to relations exist. A user cannot include their tickets, and there is no many-to-many. List the other model with a filter instead.
- `include` goes one level deep. An included row cannot include its own relations.

## Access rules

- Rules compare fields for equality, any-of, and empty. There are no ranges, no "not equal", and no rules that look at another model.
- `access` is synchronous. Do lookups in the server's async `context` function.
- There are no field-level rules. Anyone who may read a row gets every model field. Use a second model with a smaller schema to hide fields.
- A create rule takes one value per field. A list of values is a compile error.

## Writes

- Each request writes one row. There are no bulk writes, no upserts, and no transactions across requests or models.
- Updates use `PATCH` with the changed fields. `PUT` returns `405`.
- The client does not update the cache before the server answers. There are no optimistic updates.

## Client and React

- There is no server rendering. The hooks throw `Missing getServerSnapshot` when rendered on the server. See [Server rendering](./react.md#server-rendering).
- There is no push or realtime sync. Changes made by other users or tabs appear after a reload or `refetch()`.
- The client does not retry failed requests, reload on window focus, or persist its cache.
- Only React has hooks. Other UI libraries can use `watchList` and `watchGet`. See [Watch without React](./client.md#watch-without-react).

## Platforms and sources

- The README lists Node and Bun as runtimes. `fetchHandler` uses only the web `Request` and `Response`, but other runtimes, such as Deno or Cloudflare Workers, are untested.
- The Prisma source's MySQL option is untested.
- There is no OpenAPI output.

