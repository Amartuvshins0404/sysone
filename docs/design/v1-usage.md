# sysone

Define a model once, in TypeScript. The server gets REST endpoints with row-level access rules. The browser gets typed React hooks, and it imports only the model's **type**, so no schema code ships to the browser.

```
server/models.ts   defineModel(...)          Zod, access rules, relations
server/api.ts      sysone({ models }) ─────► GET/POST/PATCH/DELETE /api/{model}
                   export type Api ───┐
web/db.ts          createClient<Api>() ◄┘    import type only: 0 bytes of Zod
web/*.tsx          useList · useGet · useSelect       ~2.4 KB brotli total
```

## What ships to the browser

| | brotli | Notes |
|---|---|---|
| `sysonejs/client` | ~1.7 KB | fetch, query encoding, normalized cache, invalidation |
| `@sysonejs/react` | ~0.7 KB | three hooks |
| Zod | **0 B** | the browser never imports a model value, only `import type` |
| Your models, sources, DB drivers | **0 B** | importing `sysonejs` in a browser build fails right away (`browser` export condition) |
| React | already in your app | peer |

Measured by bundling a real frontend entry (`examples/web/src/main.tsx`) with only `react` marked as external. CI fails if any `zod` module shows up in the browser bundle.

## 1. Define (server only)

```ts
// server/models.ts
import { defineModel } from "sysonejs"
import { z } from "zod"
import type { Ctx } from "./auth"

export const category = defineModel({
  name: "category",
  schema: z.object({
    id: z.number().int(),
    name: z.string().min(1).max(80),
    parentId: z.number().int().nullable(),
    createdAt: z.date(),
  }),
  write: ["name", "parentId"],
  search: ["name"],
  filter: ["parentId"],
  sort: ["name", "createdAt"],
  relations: { parent: { model: "category", key: "parentId" } },
  access: (ctx: Ctx) => ({ read: true, create: ctx?.role === "admin", update: ctx?.role === "admin" }),
})
```

- `write` lists the fields a client may send. Create = those fields, validated by the schema. Update = the same fields, all optional.
- `sort` accepts only non-null fields (a type error otherwise), so keyset paging is always correct.
- `access` returns, for each action, `true` (all rows), `false` / missing (denied), or a row match (`{ tenantId: ctx.tenantId }`) that scopes reads and is stamped onto writes.
- No `access` means read-only for everyone.

## 2. Serve

```ts
// server/api.ts
import { sysone } from "sysonejs"
import { drizzle } from "@sysonejs/drizzle"
import { db, categories } from "./db"
import { category } from "./models"

export const api = sysone({ basePath: "/api", models: [category.from(drizzle(db, categories))] })
export type Api = typeof api
```

```ts
// Express + Node
import { expressHandler } from "@sysonejs/express"
app.use(expressHandler(api, { context: (req) => req.user ?? null }))

// Bun (also Hono, Elysia, anything with fetch)
import { fetchHandler } from "sysonejs"
Bun.serve({ fetch: fetchHandler(api, { context: (req) => auth(req.headers) }) })
```

`category.from(source)` checks at the type level that the source has a column for every model field. Fields not in the schema (password hashes, internal columns) are never selected and never sent.

## 3. Use

```ts
// web/db.ts
import { createClient } from "sysonejs/client"
import type { Api } from "../server/api"

export const db = createClient<Api>({ url: "/api" })
```

```tsx
import { useList } from "@sysonejs/react"
import { db } from "./db"

const { items, hasMore, loadMore } = useList(db.category, { sort: ["name"] })
```

| Hook | For |
|---|---|
| `useSelect(ref, { label, value })` | Select, combobox, relation picker |
| `useList(ref, { search, filter, sort, include, limit })` | Tables, feeds, infinite lists |
| `useGet(ref, id, { include })` | Detail pages |
| `ref.create / ref.update / ref.delete` | Writes. Rows update everywhere they are shown; lists of that model refetch every page you loaded. |

Writes are plain promises, so React's own `useTransition` / `useActionState` give you pending state. Server validation errors come back as `SysoneClientError` with `issues` keyed by field path.

## Sources

| Package | Works with |
|---|---|
| `@sysonejs/drizzle` | Drizzle on Postgres or MySQL |
| `@sysonejs/prisma` | Prisma on Postgres, MySQL, MongoDB |
| `@sysonejs/sql` | `pg(pool, table)` and `mysql(pool, table)` with no ORM |
| `@sysonejs/mongo` | MongoDB driver |
| `memory()` from `sysonejs` | prototypes, demos, tests |

All five pass the same conformance suite (`testSource` from `sysonejs/source`). Search, filters, keyset paging and access scoping are compiled once in the core into one small condition tree. A source only translates that tree into its query language.

---

## Call site 1: relation picker (product form, pick a category shown as "Parent / Child")

```tsx
import { useSelect } from "@sysonejs/react"
import { db } from "./db"

export function CategoryPicker(p: { value: number | null; onChange: (id: number | null) => void }) {
  const s = useSelect(db.category, {
    value: p.value,
    include: ["parent"],
    label: (c) => (c.parent ? `${c.parent.name} / ${c.name}` : c.name),
    sort: ["name"],
  })
  return (
    <Combobox
      options={s.options}
      value={s.selected}
      inputValue={s.search}
      onInputChange={s.onSearch}
      onScrollEnd={s.hasMore ? s.loadMore : undefined}
      loading={s.loading}
      onChange={(o) => p.onChange(o ? o.item.id : null)}
    />
  )
}
```

- `c.parent` is typed `Category | null` because `include: ["parent"]` was passed; without it, `c.parent` does not exist.
- The server loads parents in one batched query per page (no N+1), and parents go through `category`'s own `read` rule.
- If `p.value` is not on the current page, the picker reads it from the cache or fetches it once.

## Call site 2: ticket table with filters

```ts
// server/models.ts
export const ticket = defineModel({
  name: "ticket",
  schema: z.object({
    id: z.uuid(),
    title: z.string().min(1),
    status: z.enum(["open", "pending", "closed"]),
    priority: z.number().int().min(0).max(3),
    assigneeId: z.uuid().nullable(),
    createdAt: z.date(),
  }),
  write: ["title", "status", "priority", "assigneeId"],
  search: ["title"],
  filter: ["status", "priority", "assigneeId", "createdAt"],
  sort: ["priority", "createdAt"],
  defaultSort: ["-createdAt"],
  relations: { assignee: { model: "user", key: "assigneeId" } },
  access: (ctx: Ctx) => (ctx ? { read: true, update: true } : {}),
})
```

```tsx
import { useList } from "@sysonejs/react"
import { db } from "./db"

export function TicketTable(f: { search: string; status: Status[]; me?: string; since?: Date }) {
  const t = useList(
    db.ticket,
    {
      search: f.search,
      filter: {
        status: f.status,
        assigneeId: f.me,
        createdAt: f.since ? { gte: f.since } : undefined,
      },
      sort: ["-priority", "createdAt"],
      include: ["assignee"],
      limit: 50,
    },
    { debounce: 250 },
  )

  return (
    <Table loading={t.loading} error={t.error} onEndReached={t.hasMore ? t.loadMore : undefined}>
      {t.items.map((row) => (
        <Row key={row.id}>
          <Cell>{row.title}</Cell>
          <Cell>{row.assignee?.name ?? "Unassigned"}</Cell>
          <Cell>{row.createdAt.toLocaleDateString()}</Cell>
          <Cell>
            <StatusMenu value={row.status} onChange={(status) => db.ticket.update(row.id, { status })} />
          </Cell>
        </Row>
      ))}
    </Table>
  )
}
```

- Wire: `GET /api/ticket?search=…&filter[status]=open&filter[status]=pending&filter[createdAt][gte]=2026-10-01T00:00:00.000Z&sort=-priority,createdAt&include=assignee&limit=50`.
- `filter.createdAt` accepts `{ gte, gt, lte, lt }` because it is a date. `filter.status` accepts a value or a list. A field missing from `filter` is a type error.
- `row.createdAt` is a real `Date`.
- Changing a status patches the row in place. The table then refetches the pages already loaded (50, 100, …) in the background, because the row may no longer match the filter.

## Call site 3: multi-tenant project list with writes

```ts
// server/auth.ts
export type Ctx = { tenantId: string; userId: string; role: "admin" | "member" | "viewer" } | null

// server/models.ts
export const project = defineModel({
  name: "project",
  schema: z.object({
    id: z.uuid(),
    tenantId: z.uuid(),
    ownerId: z.uuid(),
    name: z.string().min(1).max(120),
    archived: z.boolean().default(false),
    createdAt: z.date(),
  }),
  write: ["name", "archived"],
  search: ["name"],
  filter: ["archived", "ownerId"],
  sort: ["name", "createdAt"],
  access: (ctx: Ctx) =>
    !ctx
      ? {}
      : {
          read: { tenantId: ctx.tenantId },
          create: ctx.role !== "viewer" && { tenantId: ctx.tenantId, ownerId: ctx.userId },
          update: ctx.role === "admin" ? { tenantId: ctx.tenantId } : { tenantId: ctx.tenantId, ownerId: ctx.userId },
          delete: ctx.role === "admin" && { tenantId: ctx.tenantId },
        },
})
```

What the server guarantees, with no other code:

| Request | Result |
|---|---|
| list / get | only rows with `tenantId = ctx.tenantId`; another tenant's id returns `404`, never `403` |
| create `{ name }` | stored with `tenantId` and `ownerId` taken from the rule; the client cannot send them (not in `write`) |
| update / delete | one SQL statement with `WHERE id = $1 AND tenant_id = $2 [AND owner_id = $3]`; out of scope means `404` |
| viewer creates | `403 forbidden` |

```tsx
import { useList } from "@sysonejs/react"
import { SysoneClientError } from "sysonejs/client"
import { useActionState, useState } from "react"
import { db } from "./db"

export function Projects() {
  const [showArchived, setShowArchived] = useState(false)
  const list = useList(db.project, { filter: { archived: showArchived }, sort: ["-createdAt"] })

  const [error, create, creating] = useActionState(async (_: string | null, form: FormData) => {
    try {
      await db.project.create({ name: String(form.get("name")) })
      return null
    } catch (e) {
      if (e instanceof SysoneClientError && e.code === "invalid_body") return e.issues.name ?? e.message
      throw e
    }
  }, null)

  return (
    <>
      <form action={create}>
        <input name="name" />
        <button disabled={creating}>Add</button>
        {error && <p>{error}</p>}
      </form>
      {list.items.map((p) => (
        <ProjectRow
          key={p.id}
          project={p}
          onRename={(name) => db.project.update(p.id, { name })}
          onArchive={() => db.project.update(p.id, { archived: true })}
          onDelete={() => db.project.delete(p.id)}
        />
      ))}
      {list.hasMore && <button onClick={list.loadMore}>More</button>}
    </>
  )
}
```

- `db.project.create` accepts `{ name: string; archived?: boolean }` and nothing else. `tenantId` does not appear in the type.
- After create or delete, every mounted `project` list refetches the pages it had loaded. A list that is not mounted is dropped.
- Calling `delete` twice is safe: a `404` on delete counts as done.
