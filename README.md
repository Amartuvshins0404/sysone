# sysone

Define a data model once. Get REST endpoints on the server and hooks on the client.

```
defineModel(category)
      │
      ├─ server → GET /api/category?search=&filter[x]=&sort=&cursor=
      └─ react  → useSelect(category) → <Select />
```

- **Tiny:** React hooks + client are 1.8 KB. Zero runtime dependencies.
- **Fast:** same HTTP throughput as a hand-written Express route.
- **Safe by default:** read-only unless you allow writes. Only model fields leave the server.
- **Any database:** Postgres, MySQL, MongoDB, Prisma, Drizzle.
- **Any runtime:** Node, Bun. Express, or anything that speaks `fetch` (Hono, Elysia, Bun.serve).
- **Open spec:** plain REST + JSON, written down in [SPEC.md](./SPEC.md) so other languages can follow it.

> Status: v0, not published yet.

## 1. Define the model (shared by server and client)

```ts
import { defineModel } from "sysonejs"
import { z } from "zod"

export const category = defineModel({
  name: "category",
  schema: z.object({
    id: z.number(),
    name: z.string(),
    parentId: z.number().nullable(),
    createdAt: z.date(),
  }),
  search: ["name"],
  filter: ["parentId"],
  sort: ["name", "createdAt"],
})
```

## 2. Serve it

```ts
import { sysone } from "@sysonejs/express"
import { drizzle } from "@sysonejs/drizzle"
import { expose } from "sysonejs/server"

app.use("/api", sysone([
  expose(category, {
    source: drizzle(db, categories),
    can: ({ action, ctx }) => action === "list" || action === "get" || ctx.user?.admin,
  }),
], { context: (req) => ({ user: req.user }) }))
```

No Express? Use `fetchHandler` from `sysonejs/server` with Bun.serve, Hono or Elysia.

## 3. Use it

```tsx
import { useSelect } from "@sysonejs/react"

function CategoryPicker({ value, onChange }) {
  const s = useSelect(category, { label: "name", value })
  return (
    <Combobox
      options={s.options}
      value={s.selected}
      inputValue={s.search}
      onInputChange={s.onSearch}
      onScrollEnd={s.hasMore ? s.loadMore : undefined}
      loading={s.loading}
      onChange={(o) => onChange(o.item.id)}
    />
  )
}
```

Search is debounced, pages load on scroll, and the selected item shows even if it isn't on page 1.

| Hook | For |
|---|---|
| `useSelect(model, { label, value })` | Select, combobox, autocomplete, relation picker |
| `useList(model, { search, filter, sort, limit })` | Tables, feeds, infinite lists |
| `useGet(model, id)` | Detail pages |
| `useClient().create / update / delete` | Writes. Lists of that model refresh automatically. |

## Sources

| Package | Works with |
|---|---|
| `@sysonejs/drizzle` | Drizzle on Postgres or MySQL |
| `@sysonejs/prisma` | Prisma on Postgres (MySQL: pass `{ insensitive: false }`, not tested yet) |
| `@sysonejs/sql` | `pg(pool, table)` for node-postgres, `mysql(pool, table)` for mysql2, no ORM |
| `@sysonejs/mongo` | MongoDB driver |
| `memory()` in `sysonejs/server` | prototypes and demos |

A source is 5 functions (`list`, `get`, `create`, `update`, `delete`). Writing your own is about 60 lines.

## Numbers

| | Size (brotli) |
|---|---|
| `defineModel` | 283 B |
| client | 1.13 KB |
| React hooks + client | 1.78 KB |
| server handler | 1.48 KB |

| HTTP, 50 connections, Apple M4, Node 26 | req/s |
|---|---|
| hand-written Express route | ~26k |
| sysone list | ~26–28k |

Reproduce: `pnpm size`, `pnpm bench`, `pnpm bench:http`.

## Develop

```sh
pnpm install
pnpm build
cd examples/express
docker compose up -d
pnpm prisma:generate
SOURCE=pg pnpm dev        # memory | pg | mysql | mongo | drizzle-pg | drizzle-mysql | prisma
```

## License

MIT
