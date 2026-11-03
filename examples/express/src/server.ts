import { sysone } from "@sysonejs/express"
import express from "express"
import { expose } from "sysonejs/server"
import { source } from "./sources.ts"

const SOURCE = process.env.SOURCE ?? "memory"
const PORT = Number(process.env.PORT ?? 3000)

const { model, source: from } = await source(SOURCE)

const app = express()
app.use(express.json())
app.use(
  "/api",
  sysone([expose(model, { source: from, can: ({ action, ctx }) => action === "list" || action === "get" || ctx.admin })], {
    context: (req) => ({ admin: req.get("x-admin") === "1" }),
  }),
)

app.listen(PORT, () => console.log(`sysonejs example (${SOURCE}) on http://localhost:${PORT}/api/category`))
