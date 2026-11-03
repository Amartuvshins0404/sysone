# sysone

**Describe your data once. Get a safe REST API on the server and ready-to-use React hooks in the browser.**

```sh
npm i sysonejs @sysonejs/react zod
```

[![npm](https://img.shields.io/npm/v/sysonejs)](https://www.npmjs.com/package/sysonejs) [![CI](https://github.com/Amartuvshins0404/sysone/actions/workflows/ci.yml/badge.svg)](https://github.com/Amartuvshins0404/sysone/actions/workflows/ci.yml) ![browser size](https://img.shields.io/badge/browser-2.6%20KB-brightgreen) ![license](https://img.shields.io/npm/l/sysonejs)

## The problem

Almost every app shows lists of data: a category dropdown, a users table, a project picker, an infinite feed. Each one needs the same code, written again for every model:

| On the server | In the browser |
|---|---|
| An endpoint that reads search, filters, sort and paging from the URL | `fetch` calls, loading and error state |
| Checks on who may see or change which rows | Debounced search, "load more" |
| Validation of what a client sends | Keeping the selected item visible in a dropdown |
| Hiding columns that must never leave the server | Refreshing the right lists after an edit |

It is boring to write and easy to get wrong. Forget one tenant filter and one customer sees another customer's data.

## What sysone does

You write one model: its fields (a Zod schema), what clients may search, filter, sort and write, and who may access which rows. sysone turns it into everything in the table above.

```
          defineModel(category)
                   │
     ┌─────────────┴──────────────┐
     ▼                            ▼
  server                       browser
  GET    /api/category          useSelect(db.category)  → dropdowns, pickers
  GET    /api/category/:id      useList(db.category)    → tables, feeds
  POST   /api/category          useGet(db.category, id) → detail pages
  PATCH  /api/category/:id      db.category.create / update / delete
  DELETE /api/category/:id
```

- **Safe by default.** A model with no access rule is closed. Rules like `{ tenantId: user.tenantId }` are added to every database query, including updates and deletes.
- **Typed end to end.** The browser imports only the API's TypeScript type. Filtering by a field that isn't allowed is a compile error, not a runtime surprise.
- **Small.** The browser gets 2.6 KB of sysone. Zod, your models and database drivers never reach the browser.
- **Fast.** List endpoints serve more requests per second than a hand-written Express route ([numbers](#numbers)).
- **Your database.** Postgres, MySQL, MongoDB, Prisma or Drizzle. All of them pass one shared test suite.
- **Your server.** Express, plain Node, Bun, Hono or Elysia.

## Example

A category dropdown with search, paging and the parent's name, from database to screen.

**1. Define the model.** This file lives on the server.

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

Everyone can read. Only admins can create and edit. Clients can send `name` and `parentId`, nothing else.

**2. Serve it.**

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

`memory()` keeps rows in memory, which is handy for trying things out. For a real database, swap it for `drizzle(db, table)`, `prisma(db.category)`, `pg(pool, "categories")` or `mongo(collection)`. `context` is where you read the logged-in user from the request.

**3. Use it in React.**

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

That is the whole feature. Search waits until you stop typing, "More" loads the next page, and the selected category shows even when it is not on the loaded page. Works with any UI kit: pass `options`, `selected` and `onSearch` to your own Select or Combobox.

## Good fit, bad fit

| sysone is a good fit for | Look elsewhere if you need |
|---|---|
| Admin panels, dashboards, internal tools | Deeply nested queries in one request (GraphQL) |
| SaaS apps where each customer sees only their own rows | Reports with totals, grouping and page numbers |
| Forms with dropdowns and relation pickers | Realtime sync between users |
| Teams that want one typed source of truth for list endpoints | Server-side rendering of the hooks (not yet) |

The full list is in [Limitations](./docs/limitations.md).

## How it compares

| | You write per model | Row access rules | React hooks | Your own database and server |
|---|---|---|---|---|
| Hand-written routes + fetch | everything | by hand | by hand | yes |
| tRPC / oRPC | each procedure | by hand | via TanStack Query | yes |
| Refine | the backend | backend's job | yes | yes |
| PostgREST / Supabase | SQL policies | yes (Postgres RLS) | client SDK | Postgres only |
| **sysone** | **one model** | **built in** | **yes** | **yes** |

## Documentation

Start with [Getting started](./docs/getting-started.md), a five-minute tutorial. Then:

| Server | Browser | Reference |
|---|---|---|
| [Models](./docs/models.md) | [Querying lists](./docs/querying.md) | [Limitations](./docs/limitations.md) |
| [Access rules](./docs/access.md) | [Client](./docs/client.md) | [Wire spec](./SPEC.md) |
| [Servers](./docs/servers.md) | [React hooks](./docs/react.md) | [Changelog](./CHANGELOG.md) |
| [Sources](./docs/sources.md), [Writing a source](./docs/writing-a-source.md) | | [Contributing](./CONTRIBUTING.md) |

## Packages

| Package | What it is |
|---|---|
| `sysonejs` | Models, server, and the browser client (`sysonejs/client`) |
| `@sysonejs/react` | `useSelect`, `useList`, `useGet` |
| `@sysonejs/drizzle` | Drizzle on Postgres or MySQL |
| `@sysonejs/prisma` | Prisma on Postgres |
| `@sysonejs/sql` | node-postgres or mysql2, no ORM |
| `@sysonejs/mongo` | MongoDB driver |

## Numbers

Measured on an Apple M4 with Node 26. Every number can be reproduced with the command next to it.

| What | Result |
|---|---|
| sysone in a real React app's bundle (`pnpm --filter example-web size`) | **2.62 KB** brotli |
| Runtime dependencies | **0** |
| List requests per second, hand-written Express route (`pnpm bench:http`) | 33.9–40.7k |
| List requests per second, sysone | **47.6–49.9k** |

sysone wins on speed because it formats dates itself: `JSON.stringify` spends 11.4 µs on 20 rows with `Date` fields and 1.0 µs with ISO strings. The API is plain REST and JSON, written down in [SPEC.md](./SPEC.md) with 91 test cases, so servers and clients in other languages can follow it.

## Status

v0.1, early. The API may change before 1.0. Issues and pull requests are welcome, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
