# Servers

`sysone()` turns your models into one API object. A handler then connects that object to a web server: `nodeHandler` for Express and `node:http`, and `fetchHandler` for Bun, Hono, Elysia, and anything else that uses the web `Request` and `Response`.

## Create the API

<!-- file: api.ts -->
```ts
import { defineModel, memory, sysone } from "sysonejs"
import { z } from "zod"

export type Ctx = { userId: string } | null

export function ctxFrom(userId: string | null | undefined): Ctx {
  return userId ? { userId } : null
}

const note = defineModel({
  name: "note",
  schema: z.object({ id: z.number().int(), ownerId: z.string(), text: z.string().min(1) }),
  write: ["text"],
  access: (ctx: Ctx) => {
    if (!ctx) return {}
    const own = { ownerId: ctx.userId }
    return { read: own, create: own, update: own, delete: own }
  },
})

export const api = sysone({ basePath: "/api", models: [note.from(memory())] })
export type Api = typeof api
```

`ctxFrom` trusts an `x-user` header in the examples below. That is for local testing only. In a real server, read your session cookie or verify a token there.

| Option | Default | Meaning |
|---|---|---|
| `basePath` | `""` | The path prefix for every model, such as `"/api"`. A trailing `/` is removed. |
| `models` | required | Models bound to sources with `model.from(source)`. Each name may appear once. |

`sysone()` checks the models when it runs and throws if one is invalid. See [Startup errors](./models.md#startup-errors). Export `typeof api` as a type for the browser client. See [Share the Api type](./client.md#share-the-api-type).

## Routes

For each model, the API answers these routes under `basePath`:

| Method | Path | Action | Success |
|---|---|---|---|
| GET | `/note` | list | `200 { items, next, meta, included? }` |
| GET | `/note/:id` | get | `200 { item, meta, included? }` |
| POST | `/note` | create | `201 { item, meta }` |
| PATCH | `/note/:id` | update | `200 { item, meta }` |
| DELETE | `/note/:id` | delete | `204` with no body |

- Another method on a model path, such as `PUT /api/note/1`, returns `405 method_not_allowed`.
- A path that names no model, or that goes deeper than `/:id`, does not match. `nodeHandler` passes it on, and `fetchHandler` returns `404 not_found`.
- An id in the path is URL-decoded and checked against the id field's schema. A bad id returns `400 invalid_value`.

## Express

`nodeHandler` from `sysonejs/node` returns Express middleware:

<!-- file: express.ts -->
```ts
import express from "express"
import { nodeHandler } from "sysonejs/node"
import { api, ctxFrom } from "./api.ts"

const app = express()
app.use(express.json())
app.use(nodeHandler(api, { context: (req: express.Request) => ctxFrom(req.get("x-user")) }))
app.get("/", (_req, res) => {
  res.send("home")
})
app.listen(3000)
```

- Requests that do not match a model go to the next middleware, so routes after the handler still work.
- The handler reads `req.originalUrl`. If you mount it under a path, such as `app.use("/api", handler)`, keep `basePath: "/api"`.
- `express.json()` is optional. Without it, the handler reads and parses the body itself.
- An error from a source, such as a lost database connection, goes to `next(err)`, so your Express error handler sees it.

Write the type of `req` in `context`, as above. Without it, `req` has only the few fields the handler needs.

## Plain node:http

The handler also works as a `node:http` request listener:

<!-- file: node-http.ts -->
```ts
import { createServer, type IncomingMessage } from "node:http"
import { nodeHandler } from "sysonejs/node"
import { api, ctxFrom } from "./api.ts"

const handler = nodeHandler(api, { context: (req: IncomingMessage) => ctxFrom(req.headers["x-user"]?.toString()) })
createServer(handler).listen(3000)
```

With no next middleware, a path that does not match gets `404` with a JSON `not_found` body, and an unexpected error gets `500` with no body.

## Bun

`fetchHandler` from `sysonejs` takes a `Request` and returns a `Promise<Response>`:

<!-- file: bun.ts -->
```ts
import { fetchHandler } from "sysonejs"
import { api, ctxFrom } from "./api.ts"

Bun.serve({ port: 3000, fetch: fetchHandler(api, { context: (req) => ctxFrom(req.headers.get("x-user")) }) })
```

Run it with `bun bun.ts`. `fetchHandler` answers every request it gets, so a path that does not match a model returns `404 not_found`. To serve other routes too, send only API paths to it, as the Hono and Elysia examples do.

## Hono

<!-- file: hono.ts -->
```ts
import { Hono } from "hono"
import { fetchHandler } from "sysonejs"
import { api, ctxFrom } from "./api.ts"

const handler = fetchHandler(api, { context: (req) => ctxFrom(req.headers.get("x-user")) })

const app = new Hono()
app.get("/", (c) => c.text("home"))
app.all("/api/*", (c) => handler(c.req.raw))

export default app
```

Run it with `bun hono.ts`. On Node, serve `app.fetch` with `@hono/node-server`.

## Elysia

<!-- file: elysia.ts -->
```ts
import { Elysia } from "elysia"
import { fetchHandler } from "sysonejs"
import { api, ctxFrom } from "./api.ts"

const handler = fetchHandler(api, { context: (req) => ctxFrom(req.headers.get("x-user")) })

new Elysia()
  .get("/", () => "home")
  .all("/api/*", ({ request }) => handler(request))
  .listen(3000)
```

Run it with `bun elysia.ts`.

## Context

The `context` option is a function that gets the request and returns the value that `access(ctx)` receives.

- It gets the Node request in `nodeHandler` and the web `Request` in `fetchHandler`.
- It may be async, so it can load a session or check a token.
- The handler calls it once per request that matches a model, before the access rules run. It does not run for requests that fall through.
- Its return type must match the `ctx` type of the models' `access` functions. If models declare different types, it must satisfy all of them.
- To deny everything for a request, return a value your rules treat as "no user", such as `null`. If the function throws, the request fails with that error, as described for each handler above.

## Request bodies

POST and PATCH bodies are JSON. A body that is not JSON, or that does not match the model, returns `422 invalid_body` with `issues`:

```json
{ "error": { "code": "invalid_body", "message": "Invalid body", "issues": [{ "path": ["text"], "message": "Too small: expected string to have >=1 characters" }] } }
```

With `express.json()` in front, Express itself rejects a body that is not JSON with `400` before the sysone handler runs.

Fields outside the model's `write` list are dropped before validation. Date and bigint fields in `write` accept ISO strings and decimal strings.

## Several APIs in one server

Each `sysone()` call is one API with its own base path, models, and context. Mount two when they need different rules, such as a public API and an admin API:

<!-- file: two-apis.ts -->
```ts
import express from "express"
import { defineModel, memory, sysone } from "sysonejs"
import { nodeHandler } from "sysonejs/node"
import { z } from "zod"

type Admin = { adminId: string } | null

const product = defineModel({
  name: "product",
  schema: z.object({ id: z.number().int(), name: z.string(), price: z.number() }),
  write: ["name", "price"],
  sort: ["name"],
  access: () => ({ read: true }),
})

const productAdmin = defineModel({
  name: "product",
  schema: product.schema,
  write: ["name", "price"],
  sort: ["name"],
  access: (ctx: Admin) => (ctx ? { read: true, create: true, update: true, delete: true } : {}),
})

const products = memory([{ id: 1, name: "Lamp", price: 30 }])

export const publicApi = sysone({ basePath: "/api", models: [product.from(products)] })
export const adminApi = sysone({ basePath: "/admin/api", models: [productAdmin.from(products)] })
export type PublicApi = typeof publicApi
export type AdminApi = typeof adminApi

const app = express()
app.use(express.json())
app.use(nodeHandler(publicApi, { context: () => null }))
app.use(nodeHandler(adminApi, { context: (req: express.Request): Admin => (req.get("x-admin") ? { adminId: req.get("x-admin")! } : null) }))
app.listen(3000)
```

The browser creates one client per API, such as `createClient<AdminApi>({ url: "/admin/api" })`.

Each `.from()` call with `memory()` keeps its own copy of the rows, so the two APIs above do not share data. With a database source, both read and write the same table.

## Use the API object directly

`api.handle(input)` is what both handlers call. Use it to connect another server, or to call the API in a test without HTTP. It returns `null` when the path does not match a model.

<!-- file: handle.ts -->
```ts
import { api } from "./api.ts"

const out = await api.handle({
  method: "POST",
  path: "/api/note",
  query: new URLSearchParams(),
  body: async () => ({ text: "Buy milk" }),
  ctx: () => ({ userId: "u1" }),
})
console.log(out?.status, out?.body)
```

| Input field | Type |
|---|---|
| `method` | `string` |
| `path` | `string`, the URL path without the query |
| `query` | `URLSearchParams` |
| `body` | `() => Promise<unknown>`, called only for POST and PATCH |
| `ctx` | `() => Ctx \| Promise<Ctx>` |

The result is `{ status, body? }`, where `body` is the JSON value to send. Errors that are not request errors, such as a database failure, are thrown.
