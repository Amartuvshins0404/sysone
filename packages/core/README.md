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
- **Open spec:** plain REST + JSON in [SPEC.md](./SPEC.md), with 91 JSON test cases any server in any language can run.

> Status: v0.1, early. Install: `npm i sysonejs zod` on the server, `npm i sysonejs @sysonejs/react` in the app.

## 1. Define (server)

```ts
import { defineModel } from "sysonejs"
import { z } from "zod"

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

```ts
import { sysone } from "sysonejs"
import { nodeHandler } from "sysonejs/node"
import { drizzle } from "@sysonejs/drizzle"

export const api = sysone({ basePath: "/api", models: [category.from(drizzle(db, categories))] })
export type Api = typeof api

app.use(express.json())
app.use(nodeHandler(api, { context: (req) => req.user ?? null }))
```

Bun, Hono, Elysia: `fetchHandler(api, { context })` from `sysonejs`.

With Drizzle and Prisma, `.from(source)` checks at compile time that the table has a column for every model field. Columns outside the schema are never selected or sent.

## 3. Use (browser)

```tsx
import { createClient } from "sysonejs/client"
import { useSelect } from "@sysonejs/react"
import type { Api } from "../server/api"

const db = createClient<Api>({ url: "/api" })

function CategoryPicker({ value, onChange }) {
  const s = useSelect(db.category, {
    value,
    include: ["parent"],
    label: (c) => (c.parent ? `${c.parent.name} / ${c.name}` : c.name),
  })
  return <Combobox options={s.options} value={s.selected} inputValue={s.search} onInputChange={s.onSearch} onScrollEnd={s.loadMore} />
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

The core turns paging, filters, search and access rules into one small condition tree. A source only translates that tree, so a new one is about 60–120 lines. `testSource` from `sysonejs/source` checks it.

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

```sh
pnpm install && pnpm build
cd examples/express && docker compose up -d
SOURCE=pg PG_URL=postgres://postgres@localhost:54329/sysone pnpm dev        # memory | pg | mysql | drizzle-pg | drizzle-mysql | prisma | mongo
node ../../spec/run.ts http://localhost:3000
```

## License

MIT
