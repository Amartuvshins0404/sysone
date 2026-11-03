# Client

`createClient` from `sysonejs/client` is the browser side of sysone. It sends requests, turns dates and bigints back into `Date` and `bigint` values, and keeps one cache of rows that every list and detail view reads from. It has no runtime dependencies, and it works without React.

The examples use this API:

<!-- file: api.ts -->
```ts
import { defineModel, memory, sysone } from "sysonejs"
import { z } from "zod"

const task = defineModel({
  name: "task",
  schema: z.object({
    id: z.number().int(),
    title: z.string().min(1),
    done: z.boolean().default(false),
    dueAt: z.date().nullable(),
  }),
  write: ["title", "done", "dueAt"],
  search: ["title"],
  filter: ["done"],
  sort: ["title"],
  access: () => ({ read: true, create: true, update: true, delete: true }),
})

export const api = sysone({ basePath: "/api", models: [task.from(memory())] })
export type Api = typeof api
```

## Create a client

<!-- file: db.ts -->
```ts
import { createClient } from "sysonejs/client"
import type { Api } from "./api.ts"

export const db = createClient<Api>({
  url: "http://localhost:3000/api",
  headers: () => ({ authorization: `Bearer ${localStorage.getItem("token") ?? ""}` }),
})
```

| Option | Type | Meaning |
|---|---|---|
| `url` | `string` | The API's base URL, including the server's `basePath`, such as `"/api"` or `"https://example.com/api"`. |
| `headers` | `() => Record<string, string>` or a promise of one | Extra headers, read before each request. Use it for auth tokens. |
| `fetch` | `typeof fetch` | The `fetch` to use. Pass a wrapper to add options such as `credentials: "include"`, or to log requests. |

Every request sends `content-type: application/json`. Import `Api` with `import type`, so that no server code and no Zod reach the browser bundle. If browser code imports a value from `sysonejs` by mistake, bundlers that use the `browser` export condition, such as Vite, load a module that throws and tells you to use `import type`.

## Refs

`db.task` is a ref for the `task` model. A ref has five methods:

| Method | Returns |
|---|---|
| `create(data)` | `Promise<Row>`, the stored row |
| `update(id, patch)` | `Promise<Row>`, the updated row |
| `delete(id)` | `Promise<void>` |
| `watchList(params?)` | a live list. See [Watch without React](#watch-without-react). |
| `watchGet(id, { include? })` | a live single row |

The types come from the model. `create` accepts only `write` fields, with each one required unless it is optional or has a default. `update` accepts any subset of `write` fields. A model that is not served is not a property of `db`.

<!-- file: writes.ts -->
```ts
import { db } from "./db.ts"

const task = await db.task.create({ title: "Write docs", dueAt: new Date("2026-12-01T00:00:00Z") })
await db.task.update(task.id, { done: true })
await db.task.delete(task.id)
```

- `Date` and `bigint` values are sent as ISO strings and decimal strings, and come back as `Date` and `bigint`.
- `delete` treats a `404` as success, so deleting twice is safe.
- Writes are not optimistic. The cache changes when the server answers.

## Errors

A failed request rejects with a `SysoneClientError`:

| Field | Meaning |
|---|---|
| `status` | The HTTP status, such as `403` or `422`. |
| `code` | The error code from the server, such as `"invalid_body"` or `"forbidden"`. `"http_error"` when the response has no sysone error body. |
| `message` | The server's message, or the HTTP status text. |
| `issues` | For `invalid_body`, the problems keyed by field path, such as `{ title: "Too small: expected string to have >=1 characters" }`. Nested paths are joined with `.`. Empty otherwise. |

<!-- file: errors.ts -->
```ts
import { SysoneClientError } from "sysonejs/client"
import { db } from "./db.ts"

try {
  await db.task.create({ title: "", dueAt: null })
} catch (e) {
  if (e instanceof SysoneClientError && e.code === "invalid_body") console.log(e.issues.title)
  else throw e
}
```

A network failure rejects with the error from `fetch`, not with a `SysoneClientError`. The full list of codes is in [SPEC.md](../SPEC.md#errors).

## How the cache works

The client keeps every row it has received in one table per model, keyed by id. Lists store only ids. Lists and single rows read from that table, so a row changed in one place shows the change everywhere it appears.

- Two lists or gets with the same parameters share one request and one result.
- A get for a row that is already cached, with its includes, makes no request.
- A list or get that nothing watches is dropped 30 seconds after its last watcher leaves.

After a write, the client decides which lists to reload:

| Write | Effect |
|---|---|
| `create` | Every watched list of that model reloads. Lists that nothing watches are dropped. |
| `update` | The row changes in place. A list reloads only if a field that changed is one it filters by, sorts by, or uses as an include key. A list with a search term or with no `sort` reloads when any field changes, because the client cannot tell whether the row still matches or where it goes. |
| `delete` | The row disappears from every list and get. No list reloads. |

A reload keeps the rows already loaded. A list that showed three pages reloads three pages' worth of rows, in one request when `maxLimit` allows it, so the user's scroll position stays valid.

Responses can arrive out of order. Each request is stamped when it starts, and a row is replaced only by data from a newer request. A slow list response that started before a write cannot undo that write. If a list reloads while an older load of the same list is still running, the older result is thrown away.

The cache knows only about writes made through this client. Changes by other users or other tabs appear after a reload. Call `refetch()` on a list or get to reload it yourself.

## Watch without React

`watchList` and `watchGet` return a live object with `subscribe` and `getSnapshot`. The first subscriber starts the request. Use them with any UI library, or in a script:

<!-- file: watch.ts -->
```ts
import { db } from "./db.ts"

const list = document.querySelector("ul")!
const open = db.task.watchList({ filter: { done: false }, sort: ["title"] })

export const stop = open.subscribe(() => {
  const s = open.getSnapshot()
  list.replaceChildren(...s.items.map((t) => Object.assign(document.createElement("li"), { textContent: t.title })))
})
```

The list re-renders after every change, including the reload that follows `db.task.create(...)`. Call `stop()` when the view goes away.

A list snapshot has these fields:

| Field | Meaning |
|---|---|
| `items` | The rows, with included relations joined in. |
| `ids` | The rows' ids as strings, in the same order. |
| `loading` | `true` before the first response and during any load, reload, or `loadMore`. |
| `error` | The last error, or `undefined`. Cleared by the next successful load. |
| `hasMore` | `true` when the server returned a `next` cursor. |
| `loadMore()` | Loads the next page and appends it. Does nothing while a load runs or when there is no next page. |
| `refetch()` | Reloads every page loaded so far. |

A get snapshot has `data`, `loading`, `error`, and `refetch()`. `data` is `undefined` before the first response. It is `null` when the row does not exist or the caller may not read it, and after the row is deleted.

`getSnapshot()` returns the same object until something changes, so it works with `useSyncExternalStore` and similar APIs.

## Share the Api type

The browser needs only the type of the server's `api`. How you share it depends on where the code lives.

**One repository.** Import the type across folders or workspace packages with `import type { Api } from "../server/api.ts"`, as in [Getting started](./getting-started.md).

TypeScript in the browser project must resolve the server file's imports, `sysonejs` and `zod`, for types. In a monorepo they resolve from the server package's own `node_modules`. If the browser project has no Node types, keep Node globals such as `process` out of the API file. Getting started keeps them in `server/main.ts`.

**Separate repositories.** Emit declaration files for the server's API module, then publish them as a types-only package or copy them into the frontend. Add a `tsconfig.types.json` to the server project:

```json
{
  "compilerOptions": {
    "declaration": true,
    "emitDeclarationOnly": true,
    "outDir": "types",
    "rootDir": "server",
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "es2022",
    "strict": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true
  },
  "files": ["server/api.ts"]
}
```

Run `npx tsc -p tsconfig.types.json`. It writes `types/api.d.ts` and a `.d.ts` file for each module the API imports. The emitted files import types from `sysonejs` and `zod`, so install both in the frontend. Zod can be a dev dependency there, because `import type` adds nothing to the bundle. Republish the types when the models change.
