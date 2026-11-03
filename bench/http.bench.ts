import autocannon from "autocannon"
import express from "express"
import { z } from "zod"
import { defineModel } from "../packages/core/dist/index.mjs"
import { expose, type Source } from "../packages/core/dist/server.mjs"
import { sysone } from "../packages/express/dist/index.mjs"

const rows = Array.from({ length: 21 }, (_, i) => ({
  id: i + 1,
  name: `Category ${i}`,
  parentId: i % 3 ? 1 : null,
  active: i % 2 === 0,
  createdAt: new Date(2026, 0, i + 1),
}))

const fixed: Source = {
  exact: true,
  list: async () => rows,
  get: async () => rows[0]!,
  create: async (d) => d,
  update: async (_, d) => d,
  delete: async () => true,
}

const category = defineModel({
  name: "category",
  schema: z.object({ id: z.number().int(), name: z.string(), parentId: z.number().int().nullable(), active: z.boolean(), createdAt: z.date() }),
  search: ["name"],
  filter: ["parentId", "active"],
  sort: ["name", "createdAt"],
})

const plain = express()
plain.get("/api/category", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 20), 100)
  const out = await fixed.list({ filter: {}, sort: { field: "id", dir: "asc" }, limit })
  const items = out.slice(0, limit)
  res.json({ items, next: out.length > limit ? String(items.at(-1)!.id) : null })
})

const lib = express()
lib.use("/api", sysone([expose(category, { source: () => fixed })]))

const listen = (app: express.Express, port: number) => new Promise<{ close(): void }>((r) => { const s = app.listen(port, () => r(s)) })
const servers = [await listen(plain, 4101), await listen(lib, 4102)]

const hit = (port: number, path: string) =>
  autocannon({ url: `http://localhost:${port}${path}`, connections: 50, duration: 10, pipelining: 1 })

const results: Record<string, number> = {}
for (const [name, port, path] of [
  ["hand-written express route", 4101, "/api/category?limit=20"],
  ["sysonejs (no params)", 4102, "/api/category?limit=20"],
  ["sysonejs (search + filters + sort)", 4102, "/api/category?search=cat&filter[parentId]=1&filter[active]=true&sort=-createdAt&limit=20"],
] as const) {
  await hit(port, path)
  const r = await hit(port, path)
  results[name] = r.requests.average
  console.log(`${name.padEnd(36)} ${Math.round(r.requests.average).toString().padStart(7)} req/s   p99 ${r.latency.p99} ms`)
}
const base = results["hand-written express route"]!
for (const [k, v] of Object.entries(results))
  if (v !== base) console.log(`${k}: ${v >= base ? "+" : ""}${(((v - base) / base) * 100).toFixed(1)}% throughput vs hand-written`)
servers.forEach((s) => s.close())
