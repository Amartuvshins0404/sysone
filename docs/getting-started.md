# Getting started

In this tutorial we build a small category browser. The server defines one model and serves it with Express. The React app shows a parent picker, a searchable list, and a form that adds a category. It takes about five minutes.

You need Node 22.18 or later, because we run the server's TypeScript files directly with `node`.

## Create the app

First, create a React app with Vite and install sysone:

```sh
npm create vite@latest shop -- --template react-ts
cd shop
npm install
npm install sysonejs @sysonejs/react zod express
npm install -D @types/express
```

The server needs `sysonejs`, `zod`, and `express`. The browser needs `sysonejs` and `@sysonejs/react`. Zod never reaches the browser, because the app imports only the API's type.

## Define a model

Create `server/model.ts`. A model is a Zod schema plus the lists that say what clients may do with it.

<!-- file: server/model.ts -->
```ts
import { defineModel } from "sysonejs"
import { z } from "zod"

export const category = defineModel({
  name: "category",
  schema: z.object({
    id: z.number().int(),
    name: z.string().min(1).max(80),
    parentId: z.number().int().nullable(),
  }),
  write: ["name", "parentId"],
  search: ["name"],
  filter: ["parentId"],
  sort: ["name"],
  relations: { parent: { model: "category", key: "parentId" } },
  access: () => ({ read: true, create: true }),
})
```

- `write` lists the fields a client may send. The server sets the `id`.
- `search`, `filter`, and `sort` list what a client may query by. Anything else is a compile error in the client and a `400` from the server.
- `relations` lets a client ask for each category's parent in the same request.
- `access` lets anyone read and create. Without it, every request gets `403`. [Access rules](./access.md) shows how to scope rows to a user or tenant.

## Serve it

Create `server/api.ts`. It binds the model to a data source and exports the API's type for the browser. We use the in-memory source here. [Sources](./sources.md) shows Postgres, MySQL, Drizzle, Prisma, and MongoDB.

<!-- file: server/api.ts -->
```ts
import { memory, sysone } from "sysonejs"
import { category } from "./model.ts"

const seed = [
  { id: 1, name: "Fruit", parentId: null },
  { id: 2, name: "Apple", parentId: 1 },
  { id: 3, name: "Banana", parentId: 1 },
  { id: 4, name: "Vegetables", parentId: null },
  { id: 5, name: "Carrot", parentId: 4 },
  { id: 6, name: "Leek", parentId: 4 },
]

export const api = sysone({ basePath: "/api", models: [category.from(memory(seed))] })
export type Api = typeof api
```

Create `server/main.ts` to mount the API in Express:

<!-- file: server/main.ts -->
```ts
import express from "express"
import { nodeHandler } from "sysonejs/node"
import { api } from "./api.ts"

const app = express()
app.use(express.json())
app.use(nodeHandler(api, { context: () => null }))
app.listen(3000, () => console.log("API on http://localhost:3000/api/category"))
```

Start the server:

```sh
node server/main.ts
```

In a second terminal, ask for the first two categories by name:

```sh
curl "http://localhost:3000/api/category?sort=name&limit=2"
```

You should see two items and a `next` cursor for the next page:

```json
{"items":[{"id":2,"name":"Apple","parentId":1},{"id":3,"name":"Banana","parentId":1}],"next":"WzEsIm5hbWUsaWQiLCJCYW5hbmEiLDNd","meta":{"category":{"id":"id","links":{"parent":["category","parentId"]}}}}
```

## Connect the browser

Vite serves the app on port 5173. Replace `vite.config.ts` so that Vite forwards `/api` to the server:

<!-- file: vite.config.ts -->
```ts
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:3000" } },
})
```

Create `src/db.ts`. The client is typed by `Api`, and `import type` makes sure no server code is bundled:

<!-- file: src/db.ts -->
```ts
import { createClient } from "sysonejs/client"
import type { Api } from "../server/api.ts"

export const db = createClient<Api>({ url: "/api" })
```

## Show a picker and a list

Replace `src/App.tsx`:

<!-- file: src/App.tsx -->
```tsx
import { useList, useSelect } from "@sysonejs/react"
import { useState } from "react"
import { db } from "./db.ts"

export default function App() {
  const [parentId, setParentId] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const parents = useSelect(db.category, { value: parentId, label: "name", filter: { parentId: null }, sort: ["name"] })
  const list = useList(db.category, { search, filter: { parentId }, sort: ["name"], include: ["parent"] }, { debounce: 250 })

  async function add(form: FormData) {
    await db.category.create({ name: String(form.get("name")), parentId })
  }

  return (
    <main>
      <select value={parentId ?? ""} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Top level</option>
        {parents.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" />
      <ul>
        {list.items.map((c) => (
          <li key={c.id}>{c.parent ? `${c.parent.name} / ${c.name}` : c.name}</li>
        ))}
      </ul>
      {list.hasMore && <button onClick={list.loadMore}>More</button>}
      <form action={add}>
        <input name="name" placeholder="New category" />
        <button>Add</button>
      </form>
    </main>
  )
}
```

Start the app:

```sh
npm run dev
```

Open http://localhost:5173. You should see "Fruit" and "Vegetables". Pick "Fruit" to see "Fruit / Apple" and "Fruit / Banana". Type "an" in the search box to keep only "Banana". Add a category, and the list reloads to show it in name order.

Try a mistake to see the types at work. Change `sort: ["name"]` to `sort: ["parentId"]` in `App.tsx`. Your editor marks it as an error, because `parentId` is not in the model's `sort` list.

## Next steps

- [Models](./models.md) lists every `defineModel` option and field type.
- [Access rules](./access.md) scopes rows per user or tenant.
- [Sources](./sources.md) replaces `memory()` with a real database.
- [React hooks](./react.md) has recipes for tables, infinite scroll, detail pages, and forms.
