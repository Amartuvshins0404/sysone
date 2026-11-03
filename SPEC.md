# sysone wire spec v1

Any server in any language that follows this spec works with every sysone client. The JSON cases in `spec/cases/*.json` are the executable form of this document: `node spec/run.ts <baseUrl>` checks a running server against all of them.

## Model

A model has a `name`, typed fields, one `id` field, and these lists:

| List | Meaning |
|---|---|
| `write` | Fields a client may send on create and update. Everything else is set by the server. |
| `search` | String fields matched by `?search=` (case-insensitive "contains"). |
| `filter` | Fields allowed in `?filter[field]=`. |
| `sort` | Non-null fields allowed in `?sort=`. The id is always allowed. |
| `relations` | Belongs-to links (`name → { model, key }`) usable in `?include=`. |

Only model fields leave the server. Other columns (password hashes, internal fields) are never selected or sent.

## Endpoints

Mounted under a base path, e.g. `/api`.

| Method | Path | Action | Success |
|---|---|---|---|
| GET | `/{name}` | list | `200 { items, next, meta, included? }` |
| GET | `/{name}/{id}` | get | `200 { item, meta, included? }` |
| POST | `/{name}` | create | `201 { item, meta }` |
| PATCH | `/{name}/{id}` | update | `200 { item, meta }` |
| DELETE | `/{name}/{id}` | delete | `204` |

Paths with no matching model fall through to the next handler. A client treats `404` on delete as done, so delete is idempotent.

## List query

| Param | Example | Rule |
|---|---|---|
| `search` | `search=red` | Case-insensitive contains, OR across `search` fields. `%` and `_` are literal. |
| `filter[f]` | `filter[status]=open` | Repeat for "any of". `null` matches empty. |
| `filter[f][op]` | `filter[createdAt][gte]=2026-10-01T00:00:00.000Z` | `gt`, `gte`, `lt`, `lte` on string, number, date and bigint fields. |
| `sort` | `sort=-priority,createdAt` | Up to 3 fields. `-` is descending. The id is appended as a tiebreak. |
| `include` | `include=parent` | Comma-separated relation names. |
| `limit` | `limit=50` | Integer ≥ 1. Default 20, capped at the model's max (default 100). |
| `cursor` | `cursor=…` | The `next` value from the previous page. Only valid with the same `sort`. |

Paging is keyset (cursor) based, never offset. `next` is opaque, or `null` on the last page.

## Values on the wire

JSON. Dates are ISO 8601 strings. Bigints are decimal strings. Booleans are `true`/`false` on every database.

`meta` tells the client how to read rows, per model: `{ id, types?: { field: "date" | "bigint" }, links?: { relation: [model, key] } }`. Clients use it to turn strings back into native dates and bigints and to join included rows. They need no schema.

`included` holds related rows by model name, loaded in one batch per page. Each related row passed its own model's read rule. A related row the caller may not read is left out, and the relation resolves to `null`.

On create and update, writable date and bigint fields are accepted as ISO strings and decimal strings.

## Access

Each request calls the model's `access(ctx)` once. It returns a rule per action:

| Rule | Effect |
|---|---|
| missing or `false` | `403 forbidden` |
| `true` | All rows |
| `{ field: value }` or `{ field: [values] }` | Only matching rows. Several matches in an array means OR. |

- A model with no `access` denies every action.
- Reads, updates and deletes carry the match in the same database statement. A row outside the match looks exactly like a missing row: `404`, never `403`.
- On create, match values are written into the row. A body that sets a different value gets `403`.
- An update that would move a row outside its match gets `403`.

## Errors

```json
{ "error": { "code": "invalid_filter", "message": "Cannot filter by \"x\"", "issues": [] } }
```

| Status | Codes |
|---|---|
| 400 | `invalid_limit` `invalid_sort` `invalid_filter` `invalid_search` `invalid_include` `invalid_cursor` `invalid_value` |
| 403 | `forbidden` |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
| 422 | `invalid_body`, with `issues: [{ path, message }]` |

## Efficiency spec

Checked in CI: `pnpm size`, `pnpm --filter example-web size`. Speed: `pnpm bench`, `pnpm bench:http`.

| Metric | Budget | Measured (Apple M4, Node 26) |
|---|---|---|
| Browser bundle of a real React app, all deps except React | ≤ 2.75 KB brotli | 2.62 KB |
| Zod, models or drivers in the browser bundle | 0 bytes (CI fails otherwise) | 0 |
| `sysonejs/client` | ≤ 1.8 KB brotli | 1.77 KB |
| `@sysonejs/react` | ≤ 650 B brotli | 580 B |
| Server core, Zod excluded | ≤ 5.5 KB brotli | 5.18 KB |
| Runtime dependencies, every package | 0 | 0 |
| HTTP list throughput vs a hand-written Express route | not slower | 11–40% faster across 3 runs |
