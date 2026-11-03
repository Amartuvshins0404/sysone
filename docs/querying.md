# Querying lists

A list request can search, filter, sort, include related rows, and page with a cursor. This page shows each one from the TypeScript client and as raw HTTP. The client builds the same query string you would write by hand.

The examples use this model:

<!-- file: api.ts -->
```ts
import { defineModel, memory, sysone } from "sysonejs"
import { z } from "zod"

const user = defineModel({
  name: "user",
  schema: z.object({ id: z.uuid(), name: z.string() }),
  access: () => ({ read: true }),
})

const ticket = defineModel({
  name: "ticket",
  schema: z.object({
    id: z.uuid(),
    title: z.string(),
    status: z.enum(["open", "pending", "closed"]),
    priority: z.number().int(),
    assigneeId: z.uuid().nullable(),
    createdAt: z.date(),
  }),
  search: ["title"],
  filter: ["status", "priority", "assigneeId", "createdAt"],
  sort: ["priority", "createdAt"],
  relations: { assignee: { model: "user", key: "assigneeId" } },
  access: () => ({ read: true }),
})

export const api = sysone({ basePath: "/api", models: [ticket.from(memory()), user.from(memory())] })
export type Api = typeof api
```

<!-- file: db.ts -->
```ts
import { createClient } from "sysonejs/client"
import type { Api } from "./api.ts"

export const db = createClient<Api>({ url: "/api" })
```

## One request with everything

<!-- file: everything.ts -->
```ts
import { db } from "./db.ts"

const tickets = db.ticket.watchList({
  search: "login",
  filter: {
    status: ["open", "pending"],
    assigneeId: null,
    createdAt: { gte: new Date("2026-10-01T00:00:00Z") },
  },
  sort: ["-priority", "createdAt"],
  include: ["assignee"],
  limit: 50,
})
```

The client sends this request:

```text
GET /api/ticket?search=login
  &filter[assigneeId]=null
  &filter[createdAt][gte]=2026-10-01T00:00:00.000Z
  &filter[status]=open&filter[status]=pending
  &sort=-priority,createdAt
  &include=assignee
  &limit=50
```

In React, pass the same object to `useList`. See [React hooks](./react.md). Outside React, `watchList` returns a live list. See [Client](./client.md#watch-without-react).

## Query parameters

| Parameter | Client option | Example | Rule |
|---|---|---|---|
| `search` | `search` | `search=red` | Case-insensitive "contains", ORed across the model's `search` fields. |
| `filter[f]` | `filter: { f: value }` | `filter[status]=open` | Equals. Repeat the parameter for any-of. |
| `filter[f][op]` | `filter: { f: { op: value } }` | `filter[priority][gte]=2` | `gt`, `gte`, `lt`, `lte`. |
| `sort` | `sort` | `sort=-priority,createdAt` | Up to 3 fields. `-` means descending. |
| `include` | `include` | `include=assignee` | Comma-separated relation names. |
| `limit` | `limit` | `limit=50` | Rows per page. |
| `cursor` | `cursor` | `cursor=WzEs...` | The `next` value of the previous page. |

The server ignores parameters it does not know. When you try these with `curl`, add `-g` so that curl does not treat the brackets as a pattern:

```sh
curl -g "http://localhost:3000/api/category?filter[parentId]=1&filter[parentId]=2"
```

## Search

`search` matches rows where any of the model's `search` fields contains the term, ignoring case.

- The server trims the term. A blank term is ignored.
- `%` and `_` match themselves, so `search=100%` finds "Date 100%".
- A non-blank search on a model with no `search` fields returns `400 invalid_search`. On the client, `search` is a type error for that model.

With the example server, `search=an` returns "Banana" and "Mango".

## Filters

Each key in `filter` is a field from the model's `filter` list. Several keys must all match.

| Client value | Query string | Matches |
|---|---|---|
| `{ status: "open" }` | `filter[status]=open` | `status` equals `open` |
| `{ status: ["open", "pending"] }` | `filter[status]=open&filter[status]=pending` | either value |
| `{ assigneeId: null }` | `filter[assigneeId]=null` | rows with no assignee |
| `{ priority: { gte: 2, lt: 4 } }` | `filter[priority][gte]=2&filter[priority][lt]=4` | the range |
| `{ status: undefined }` or `{ status: [] }` | nothing | every row |

- An empty list sends no filter, so it matches every row, not none. If "no values selected" should show no rows, do not run the query. In React, pass `{ enabled: false }`.
- You can mix `null` and values. `filter[parentId]=null&filter[parentId]=1` matches rows with no parent or parent 1.
- `null` means empty only on nullable fields. On a non-null string field, `filter[name]=null` matches the text "null".
- Ranges work on string, number, date, and bigint fields. Boolean fields take only equals and any-of.
- The server checks each value against the field's Zod schema. A value that fails, such as `filter[status]=archived` for an enum without "archived", returns `400 invalid_value`.
- Send dates as ISO 8601 strings and bigints as decimal strings. The client does this for `Date` and `bigint` values.

The client types follow the model. A filter on a field outside `filter`, a value outside an enum, or a range on a boolean field is a compile error.

<!-- fails: 'title' does not exist -->
```ts
import { db } from "./db.ts"

db.ticket.watchList({ filter: { title: "x" } })
```

## Sort

`sort` is a list of up to 3 fields from the model's `sort` list, or the id. Put `-` in front of a field to sort it in descending order.

- The server appends the id as the last key, in the direction of the last field. Rows with equal values always come back in the same order, so paging never skips or repeats a row.
- The id ends the sort. Fields after the id are ignored.
- Without `sort`, the server uses the model's `defaultSort`, or the id in ascending order.
- Nullable fields cannot be sorted. Neither can boolean and JSON fields.

## Include related rows

`include` names relations from the model's `relations`. The server loads each target model's rows in one query per page and returns them in `included`, keyed by model name. The client joins them back, so `item.assignee` is the user row, or `null`.

```sh
curl -g "http://localhost:3000/api/category/4?include=parent"
```

```json
{
  "item": { "id": 4, "name": "Date 100%", "parentId": 2, "active": true, "size": "40", "createdAt": "2026-01-03T00:00:00.000Z" },
  "included": { "category": [{ "id": 2, "name": "Banana", "parentId": 1, "active": true, "size": "20", "createdAt": "2026-01-02T00:00:00.000Z" }] },
  "meta": { "category": { "id": "id", "types": { "size": "bigint", "createdAt": "date" }, "links": { "parent": ["category", "parentId"] } } }
}
```

Included rows pass the target model's `read` rule. See [Access rules](./access.md#included-rows-follow-their-own-rules). Includes go one level deep. You cannot include a relation of an included row.

## Pages and cursors

Lists use keyset paging. Each page ends with `next`, an opaque cursor, or `null` on the last page. To get the next page, send the same query with `cursor` set to `next`.

```sh
curl -g "http://localhost:3000/api/category?sort=-createdAt,name&limit=3"
```

```json
{
  "items": [{ "id": 4, "name": "Date 100%" }, { "id": 6, "name": "Fig" }, { "id": 9, "name": "Kiwi" }],
  "next": "WzEsIi1jcmVhdGVkQXQsbmFtZSxpZCIsIjIwMjYtMDEtMDNUMDA6MDA6MDAuMDAwWiIsIktpd2kiLDld"
}
```

The rows above are shortened. The next page starts after "Kiwi":

```sh
curl -g "http://localhost:3000/api/category?sort=-createdAt,name&limit=3&cursor=WzEsIi1jcmVhdGVkQXQsbmFtZSxpZCIsIjIwMjYtMDEtMDNUMDA6MDA6MDAuMDAwWiIsIktpd2kiLDld"
```

- A cursor holds the sort and the last row's sort values. A cursor sent with a different `sort` returns `400 invalid_cursor`.
- Keep `search` and `filter` the same as on the first page. The server does not check them, so a cursor with other filters continues from the same position in a different set.
- Rows added or deleted between pages do not shift the next page, because the cursor holds values, not an offset.
- There is no total count and no page numbers. See [Limitations](./limitations.md).

In React, `loadMore()` sends the cursor for you. See [Infinite scroll](./react.md#infinite-scroll).

## Limits

- Without `limit`, a page has the model's `limit` rows, 20 by default.
- A `limit` above the model's `maxLimit`, 100 by default, is lowered to `maxLimit`.
- A `limit` that is not a whole number of at least 1 returns `400 invalid_limit`.

## Errors

A bad query returns `400` with a code and a message:

```json
{ "error": { "code": "invalid_sort", "message": "Cannot sort by \"parentId\"" } }
```

| Code | Example cause |
|---|---|
| `invalid_limit` | `limit=0`, `limit=abc` |
| `invalid_sort` | a field outside `sort`, a nullable field, more than 3 fields |
| `invalid_filter` | a field outside `filter`, `filter[active][gt]=true` on a boolean, an unknown operator |
| `invalid_value` | a filter value or an id that does not fit the field's schema |
| `invalid_search` | a search on a model without `search` fields |
| `invalid_include` | a relation name the model does not have |
| `invalid_cursor` | a cursor from another sort, or one that is not a cursor |

On the client these arrive as a `SysoneClientError`. See [Client errors](./client.md#errors).
