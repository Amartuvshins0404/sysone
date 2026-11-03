# sysone wire spec v0

Any server in any language that follows this spec works with every sysone client (React hooks today, others later).

## Model

A model has a `name`, a set of fields, one `id` field, and three allowlists:

| Allowlist | Used by |
|---|---|
| `search` | fields matched by `?search=` (case-insensitive "contains") |
| `filter` | fields allowed in `?filter[field]=` |
| `sort` | fields allowed in `?sort=` (the id field is always allowed) |

Only model fields ever leave the server. Anything else on the row (passwords, internal columns) is dropped.

## Endpoints

Mounted under a prefix, e.g. `/api`.

| Method | Path | Action | Success |
|---|---|---|---|
| GET | `/{name}` | list | `200 { items, next }` |
| GET | `/{name}/{id}` | get | `200 item` |
| POST | `/{name}` | create | `201 item` |
| PATCH | `/{name}/{id}` | update | `200 item` |
| DELETE | `/{name}/{id}` | delete | `204` |

Paths with no matching model fall through (the next handler runs).

## List query

| Param | Example | Rule |
|---|---|---|
| `search` | `search=red` | Case-insensitive contains, OR across `search` fields. `%` and `_` are literal. |
| `filter[f]` | `filter[status]=open` | Repeat for "any of": `filter[status]=open&filter[status]=done`. `null` means empty. |
| `sort` | `sort=-createdAt` | One field. `-` means descending. Ties broken by id in the same direction. |
| `limit` | `limit=50` | Integer ≥ 1. Server default 20, capped at the model's max (default 100). |
| `cursor` | `cursor=…` | Value of `next` from the previous page. Only valid with the same `sort`. |

Values are sent as strings and coerced to the field type: numbers, `true`/`false`, ISO dates, bigint.

Paging is keyset (cursor) based, never offset. Sort fields should be non-null.

`next` is an opaque string, or `null` on the last page. Clients must not build or read it.

## Values on the wire

JSON. Dates are ISO 8601 strings. Clients turn date fields back into native dates.

## Errors

```json
{ "error": { "code": "invalid_filter", "message": "Cannot filter by \"x\"", "issues": [] } }
```

| Status | Codes |
|---|---|
| 400 | `invalid_limit` `invalid_sort` `invalid_filter` `invalid_search` `invalid_cursor` `invalid_value` |
| 403 | `forbidden` |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
| 422 | `invalid_body` (with `issues`) |

## Access

Every request passes one check: `can({ action, ctx, model, id?, data? })`.
Default: `list` and `get` allowed, writes denied.

## Efficiency spec

Sizes are enforced in CI (`pnpm size`). Speed is measured with `pnpm bench` and `pnpm bench:http`.

| Metric | Budget |
|---|---|
| `defineModel` (browser) | ≤ 400 B brotli |
| Client (browser) | ≤ 1.3 KB brotli |
| React hooks + client (browser) | ≤ 2 KB brotli |
| Server handler | ≤ 2 KB brotli |
| Runtime dependencies | 0 (zod, react, db drivers are peers) |
| HTTP throughput vs hand-written Express route | within 5% |
