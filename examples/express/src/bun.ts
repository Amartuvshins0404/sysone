import { expose, fetchHandler } from "sysonejs/server"
import { source } from "./sources.ts"

const { model, source: from } = await source(process.env.SOURCE ?? "memory")

const handle = fetchHandler([expose(model, { source: from, can: ({ action, ctx }) => action === "list" || action === "get" || ctx.admin })], {
  prefix: "/api",
  context: (req) => ({ admin: req.headers.get("x-admin") === "1" }),
})

Bun.serve({ port: Number(process.env.PORT ?? 3000), fetch: handle })
