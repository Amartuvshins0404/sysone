# sysone

Define a data model once. Get scoped REST endpoints on the server and typed hooks in the browser.

```
server   defineModel(category)  →  GET/POST/PATCH/DELETE /api/category
         export type Api
browser  createClient<Api>()    →  useSelect(db.category) → <Select />
         (import type only: no Zod, no models in the bundle)
```

- **Tiny where it counts:** a real React app ships 2.62 KB brotli of sysone. No Zod, no models, no drivers reach the browser.
- **Fast:** list endpoints serve more requests per second than a hand-written Express route (47–50k vs 34–41k req/s, see Numbers).
- **Safe by default:** a model with no `access` rule is closed. Rules scope rows per tenant or owner, and writes carry the scope in the same database statement.
- **Any database:** Postgres, MySQL, MongoDB, Prisma, Drizzle. All pass one shared test suite.
- **Any runtime:** Node and Bun. Express, plain `node:http`, or anything that speaks `fetch` (Bun.serve, Hono, Elysia).
- **Open spec:** plain REST + JSON in [SPEC.md](https://github.com/Amartuvshins0404/sysone/blob/main/SPEC.md), with 91 JSON test cases any server in any language can run.

```sh
npm i sysonejs @sysonejs/react zod
```

> Status: v0.1, early.

## Documentation

Start with [Getting started](https://github.com/Amartuvshins0404/sysone/blob/main/docs/getting-started.md), a five-minute tutorial. The [docs index](https://github.com/Amartuvshins0404/sysone/blob/main/docs/README.md) lists every page:

| Server | Browser | Reference |
|---|---|---|
| [Models](https://github.com/Amartuvshins0404/sysone/blob/main/docs/models.md) | [Querying lists](https://github.com/Amartuvshins0404/sysone/blob/main/docs/querying.md) | [Limitations](https://github.com/Amartuvshins0404/sysone/blob/main/docs/limitations.md) |
| [Access rules](https://github.com/Amartuvshins0404/sysone/blob/main/docs/access.md) | [Client](https://github.com/Amartuvshins0404/sysone/blob/main/docs/client.md) | [Wire spec](https://github.com/Amartuvshins0404/sysone/blob/main/SPEC.md) |
| [Servers](https://github.com/Amartuvshins0404/sysone/blob/main/docs/servers.md) | [React hooks](https://github.com/Amartuvshins0404/sysone/blob/main/docs/react.md) | [Changelog](https://github.com/Amartuvshins0404/sysone/blob/main/CHANGELOG.md) |
| [Sources](https://github.com/Amartuvshins0404/sysone/blob/main/docs/sources.md), [Writing a source](https://github.com/Amartuvshins0404/sysone/blob/main/docs/writing-a-source.md) | | [Contributing](https://github.com/Amartuvshins0404/sysone/blob/main/CONTRIBUTING.md) |

## 1. Define (server)

<!-- file: model.ts -->
```ts
import { defineModel } from "sysonejs"
import { z } from "zod"

export type Ctx = { admin: boolean } | null

export const category = defineModel({
  name: "category",
  schema: z.object({
    id: z.number().int(),
    name: z.string().min(1),
    parentId: z.number().int().nullable(),
    createdAt: z.date(),
  }),
  write: ["name", "parentId"],
  search: ["name"],
  filter: ["parentId", "createdAt"],
  sort: ["name", "createdAt"],
  relations: { parent: { model: "category", key: "parentId" } },
  access: (ctx: Ctx) => ({ read: true, create: ctx?.admin, update: ctx?.admin }),
})
```

- `write` is what a client may send. Everything else is set by the server.
- `access(ctx)` returns, per action, `true`, `false`, or a row match like `{ tenantId: ctx.tenantId }`.
- Sorting on a nullable field, or filtering outside `filter`, is a compile error.

## 2. Serve

<!-- file: server.ts -->
```ts
import express from "express"
import { memory, sysone } from "sysonejs"
import { nodeHandler } from "sysonejs/node"
import { category } from "./model.ts"

export const api = sysone({ basePath: "/api", models: [category.from(memory())] })
export type Api = typeof api

const app = express()
app.use(express.json())
app.use(nodeHandler(api, { context: () => null }))
app.listen(3000)
```

`context` turns each request into the `ctx` that access rules see. Read your session there. Swap `memory()` for `drizzle(db, table)`, `prisma(db.category)`, `pg(pool, "categories")`, or `mongo(collection)` to use a database.

Bun, Hono, Elysia: `fetchHandler(api, { context })` from `sysonejs`.

With Drizzle, Prisma, and MongoDB, `.from(source)` checks at compile time that the table has a column for every model field. Columns outside the schema are never selected or sent.

## 3. Use (browser)

<!-- file: picker.tsx -->
```tsx
import { useSelect } from "@sysonejs/react"
import { createClient } from "sysonejs/client"
import type { Api } from "./server.ts"

const db = createClient<Api>({ url: "/api" })

export function CategoryPicker(props: { value: number | null; onChange: (id: number) => void }) {
  const s = useSelect(db.category, {
    value: props.value,
    include: ["parent"],
    label: (c) => (c.parent ? `${c.parent.name} / ${c.name}` : c.name),
  })
  return (
    <div>
      <input value={s.search} onChange={(e) => s.onSearch(e.target.value)} placeholder={s.selected?.label} />
      {s.options.map((o) => (
        <button key={o.value} onClick={() => props.onChange(o.item.id)}>
          {o.label}
        </button>
      ))}
      {s.hasMore && <button onClick={s.loadMore}>More</button>}
    </div>
  )
}
```

| Hook | For |
|---|---|
| `useSelect(ref, { label, value })` | Select, combobox, relation picker. Shows the selected item even when it is not on the loaded page. |
| `useList(ref, { search, filter, sort, include, limit })` | Tables, feeds, infinite lists |
| `useGet(ref, id, { include })` | Detail pages |
| `ref.create / update / delete` | Writes. Each row is cached once, so an edit shows everywhere. Lists reload only when the edit affects them. |

## Sources

| Package | Works with |
|---|---|
| `@sysonejs/drizzle` | Drizzle on Postgres or MySQL |
| `@sysonejs/prisma` | Prisma on Postgres (MySQL option exists, untested) |
| `@sysonejs/sql` | `pg(pool, table)` for node-postgres, `mysql(pool, table)` for mysql2 |
| `@sysonejs/mongo` | MongoDB driver |
| `memory()` from `sysonejs` | prototypes, tests |

The core turns paging, filters, search and access rules into one small condition tree. A source only translates that tree, so a new one is about 60–120 lines. `testSource` from `sysonejs/source` checks it. See [Writing a source](https://github.com/Amartuvshins0404/sysone/blob/main/docs/writing-a-source.md).

## Numbers

Apple M4, Node 26. Reproduce with the commands shown.

| Browser (`pnpm --filter example-web size`, a real React entry, only React external) | brotli |
|---|---|
| sysone v1 | **2.62 KB** |
| sysone v0, for comparison (shared Zod model) | 76.62 KB |

| Server (`pnpm size`) | brotli |
|---|---|
| sysonejs core, Zod excluded (server peer) | 5.18 KB |

| HTTP list, 50 connections, 3 runs (`pnpm bench:http`) | req/s |
|---|---|
| hand-written Express route | 33.9–40.7k |
| sysone, no params | 47.6–49.9k |
| sysone, search + 3 filters + sort | 43.5–45.6k |

sysone is faster than the hand-written route because it formats dates itself. `JSON.stringify` on 20 rows with `Date` fields takes 11.4 µs; with ISO strings it takes 1.0 µs.

## Develop

See [CONTRIBUTING.md](https://github.com/Amartuvshins0404/sysone/blob/main/CONTRIBUTING.md) for setup, the local databases, and the checks CI runs.

## License

MIT
