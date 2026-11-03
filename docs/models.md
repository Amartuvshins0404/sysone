# Models

A model is a name, a Zod object schema, and the lists that say what clients may do with each field. You define it with `defineModel` on the server, bind it to a data source with `.from(source)`, and serve it with `sysone()`.

<!-- file: model.ts -->
```ts
import { defineModel } from "sysonejs"
import { z } from "zod"

export type Ctx = { userId: string; role: "admin" | "member" } | null

export const user = defineModel({
  name: "user",
  schema: z.object({ id: z.uuid(), name: z.string() }),
  search: ["name"],
  sort: ["name"],
  access: (ctx: Ctx) => ({ read: !!ctx }),
})

export const ticket = defineModel({
  name: "ticket",
  schema: z.object({
    id: z.uuid(),
    title: z.string().min(1).max(200),
    status: z.enum(["open", "pending", "closed"]),
    priority: z.number().int().min(0).max(3).default(1),
    assigneeId: z.uuid().nullable(),
    estimate: z.bigint().optional(),
    labels: z.array(z.string()).default([]),
    createdAt: z.date(),
  }),
  write: ["title", "status", "priority", "assigneeId", "estimate", "labels"],
  search: ["title"],
  filter: ["status", "priority", "assigneeId", "createdAt"],
  sort: ["priority", "createdAt"],
  defaultSort: ["-createdAt"],
  limit: 50,
  maxLimit: 200,
  relations: { assignee: { model: "user", key: "assigneeId" } },
  access: (ctx: Ctx) => (ctx ? { read: true, create: true, update: true, delete: ctx.role === "admin" } : {}),
})
```

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | required | The URL segment (`/api/ticket`), the client key (`db.ticket`), and the name relations point to. Must be unique in one `sysone()` call. |
| `schema` | `z.object({...})` | required | The fields. Only these fields are read from the source and sent to clients. |
| `id` | field name | `"id"` | The primary key. Must be a non-null string, number, or bigint field. |
| `write` | field names | `[]` | Fields a client may send on create and update. Other fields in a body are dropped. |
| `search` | string field names | `[]` | Fields matched by `?search=`. With an empty list, a non-blank search returns `400 invalid_search`. |
| `filter` | field names | `[]` | Fields allowed in `?filter[field]=`. Any field type except JSON. |
| `sort` | field names | `[]` | Fields allowed in `?sort=`. Non-null string, number, date, and bigint fields only. The id is always allowed. |
| `defaultSort` | sort specs | id ascending | The order when a request sends no `sort`. Up to 3 entries such as `"-createdAt"`. Each field must be in `sort` or be the id. |
| `limit` | number | `20` | Page size when a request sends no `limit`. |
| `maxLimit` | number | `100` | The largest `limit` a request may ask for. A larger value is lowered to this. |
| `relations` | `{ name: { model, key } }` | `{}` | Belongs-to links that clients can `include`. See [Relations](#relations). |
| `access` | `(ctx) => rules` | deny all | Who may read, create, update, and delete which rows. See [Access rules](./access.md). |

`defineModel` keeps the literal types of every option. The client uses them, so `db.ticket` only accepts the filters, sorts, and includes you listed here.

## Field types

sysone reads the Zod type of each field to decide how to store, filter, sort, and send it. `.nullable()`, `.optional()`, `.default()`, and other wrappers are looked through, so `z.date().nullable()` is a date field.

| Zod type | Kind | On the wire | Filter | Sort | Search | Id |
|---|---|---|---|---|---|---|
| `z.string()`, `z.uuid()`, `z.email()`, other string formats | string | string | equals, any-of, ranges | yes | yes | yes |
| `z.enum(["a", "b"])`, `z.literal("a")` | string | string | equals, any-of, ranges | yes | yes | yes |
| `z.number()`, `z.number().int()` | number | number | equals, any-of, ranges | yes | no | yes |
| `z.boolean()` | boolean | `true` or `false` | equals, any-of | no | no | no |
| `z.date()` | date | ISO 8601 string | equals, any-of, ranges | yes | no | no |
| `z.bigint()` | bigint | decimal string | equals, any-of, ranges | yes | no | yes |
| anything else: `z.object()`, `z.array()`, `z.record()`, `z.union()`, `z.unknown()` | json | as is | no | no | no | no |

- Ranges on string fields compare the text, so `{ gte: "m" }` matches "mango" and "zebra".
- The client turns date and bigint strings back into `Date` and `bigint` values, so `row.createdAt` is a `Date` in the browser.
- Booleans are `true` or `false` on every database. A source that returns `0` or `1` is converted.
- A JSON field is sent and stored as the source returns and accepts it. The shared source tests do not cover JSON fields.
- Use `z.enum` for a fixed set of strings. A `z.union` of literals is a JSON field, so it cannot be filtered or sorted.

## Nullable, optional, and default fields

A field is nullable when its schema accepts `null` or a missing value. `.nullable()`, `.optional()`, and `.nullish()` all make a field nullable.

- A nullable field cannot be sorted on and cannot be the id. Keyset paging needs a value in every row.
- `filter[field]=null` matches rows where a nullable field is empty. The client accepts `null` as a filter value for `.nullable()` fields.
- A relation whose key is nullable has the type `Target | null` on the client.

The create body follows the schema. For each field in `write`:

| Schema | On create |
|---|---|
| `z.string()` | Required. |
| `z.string().nullable()` | Required. Send `null` for no value. |
| `z.string().optional()` | May be left out. |
| `z.string().default("x")` | May be left out. The server stores the default. |

On update, every `write` field is optional, and defaults are not applied again. A field you leave out keeps its stored value.

Fields outside `write` get their values from the database, such as an identity column or a column default, or from a [create rule](./access.md#create-stamps-the-scope-into-the-row). The `memory()` source fills in only the id. Any other field that the client does not send and that has no Zod default stays empty.

## What the server sends

Every response carries the model's fields and nothing else. A column that is not in the schema, such as a password hash, is never selected from a SQL source and is removed from any row a source returns.

Responses also carry `meta`, which tells the client the id field, which fields are dates or bigints, and how relations join. The client needs no schema. [SPEC.md](../SPEC.md) describes the full wire format.

## Relations

A relation is a belongs-to link. A field on this model holds the id of a row in another model. In the ticket model above, `assignee: { model: "user", key: "assigneeId" }` links each ticket to a user.

- `model` is the target model's `name`. The target must be served by the same `sysone()` call.
- `key` is a field on this model. It must be a string, number, bigint, date, or boolean field.
- A client asks for related rows with `include: ["assignee"]`. The server loads them in one query per target model per page.
- Each related row passes the target model's own `read` rule. A row the caller may not read is left out, and the relation is `null`.
- A model can point to itself, such as `parent: { model: "category", key: "parentId" }`.

Only belongs-to is supported. A ticket can include its assignee, but a user cannot include their tickets. To show a user's tickets, list tickets with `filter: { assigneeId: user.id }`.

## Bind a model to a source

`model.from(source)` pairs the model with a data source. You pass the result to `sysone()`:

<!-- file: api.ts -->
```ts
import { memory, sysone } from "sysonejs"
import { ticket, user } from "./model.ts"

export const api = sysone({ basePath: "/api", models: [ticket.from(memory()), user.from(memory())] })
export type Api = typeof api
```

When the source knows its row type, `.from()` checks at compile time that it has a column for every model field. The Drizzle, Prisma, MongoDB, and typed `memory<Row>()` sources know it. The plain SQL source does not. Extra columns in the source are fine. See [Sources](./sources.md).

## Compile errors

Most mistakes in a model fail the build. The error names the type that rejected the value.

| Mistake | Error mentions |
|---|---|
| A name in `write`, `filter`, or another list that is not a field | the list of field names |
| A nullable or boolean field in `sort` or `defaultSort` | `OrderedField` or `SortSpec` |
| A non-string field in `search` | `TextField` |
| A JSON field in `filter` or as a relation key | `ScalarField` |
| A nullable, boolean, date, or JSON field as `id` | `IdField` |
| An `access` rule that matches a field that does not exist, or with a value of the wrong type | `Grants` |
| An `access` function whose `ctx` has no type | `never` |
| A source that lacks a column for a field | `~missing columns` |
| A relation to a model that is not served | `~relation targets not served` |

A nullable field in `sort`:

<!-- fails: OrderedField -->
```ts
import { defineModel } from "sysonejs"
import { z } from "zod"

defineModel({
  name: "category",
  schema: z.object({ id: z.number(), name: z.string(), parentId: z.number().nullable() }),
  sort: ["parentId"],
})
```

An `access` function without a type on `ctx`. The parameter becomes `never`, so any use of it fails. Always write the type of `ctx`:

<!-- fails: on type 'never' -->
```ts
import { defineModel } from "sysonejs"
import { z } from "zod"

defineModel({
  name: "note",
  schema: z.object({ id: z.number(), ownerId: z.string() }),
  access: (ctx) => ({ read: { ownerId: ctx.userId } }),
})
```

A source without a column for every field:

<!-- fails: ~missing columns -->
```ts
import { memory } from "sysonejs"
import { ticket } from "./model.ts"

ticket.from(memory<{ id: string; title: string }>())
```

A relation to a model that is not served:

<!-- fails: ~relation targets not served -->
```ts
import { memory, sysone } from "sysonejs"
import { ticket } from "./model.ts"

sysone({ models: [ticket.from(memory())] })
```

## Startup errors

A few mistakes pass the compiler and throw when `sysone()` runs, so the server fails to start.

| Message | Cause |
|---|---|
| `sysonejs: model "x" cannot use "f" as a sort field` | The field cannot be sorted. The same message names `its id`, `a write field`, `a search field`, `a filter field`, or `the key of "r"`. |
| `sysonejs: model "x" has an invalid defaultSort` | `defaultSort` has more than 3 entries or names a field that is not in `sort`. |
| `sysonejs: model "x" is served twice` | Two models in one `sysone()` call have the same name. |
| `sysonejs: relation "x.r" targets "y", which is not served` | The relation's target model is missing from `models`. |
| `@sysonejs/drizzle: model "x" has no column for field "f"` | The Drizzle table lacks a column. |

The compiler misses a `defaultSort` field that is not in `sort`, and a `z.union` of literals in `filter`, because both are valid at the type level.
