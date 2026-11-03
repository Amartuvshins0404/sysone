import { execFile } from "node:child_process"
import { promisify } from "node:util"
import express from "express"
import { z } from "zod"
import { defineModel, sysone } from "../packages/core/dist/index.mjs"
import type { Source, Store } from "../packages/core/dist/kit.mjs"
import { nodeHandler } from "../packages/core/dist/node.mjs"

const rows = Array.from({ length: 21 }, (_, i) => ({
  id: i + 1,
  name: `Category ${i}`,
  parentId: i % 3 ? 1 : null,
  active: i % 2 === 0,
  createdAt: new Date(2026, 0, i + 1),
}))

const store: Store = {
  find: async () => rows,
  insert: async (r) => r,
  update: async (_, r) => r,
  remove: async () => true,
}
const fixed: Source<(typeof rows)[number]> = { name: "fixed", bind: () => store }

const category = defineModel({
  name: "category",
  schema: z.object({ id: z.number().int(), name: z.string(), parentId: z.number().int().nullable(), active: z.boolean(), createdAt: z.date() }),
  search: ["name"],
  filter: ["parentId", "active"],
  sort: ["name", "createdAt"],
  access: () => ({ read: true }),
})

const plain = express()
plain.get("/api/category", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 20), 100)
  const out = await store.find({ where: null, sort: [{ field: "id", dir: "asc" }], take: limit + 1, select: [] })
  const items = out.slice(0, limit)
  res.json({ items, next: out.length > limit ? String(items.at(-1)!.id) : null })
})
plain.get("/api/raw", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 20), 100)
  const out = await store.find({ where: null, sort: [{ field: "id", dir: "asc" }], take: limit + 1, select: [] })
  const items = out.slice(0, limit)
  res.statusCode = 200
  res.setHeader("content-type", "application/json")
  res.end(JSON.stringify({ items, next: out.length > limit ? String(items.at(-1)!.id) : null }))
})

const lib = express()
lib.use(nodeHandler(sysone({ basePath: "/api", models: [category.from(fixed)] }), { context: () => null }))

const listen = (app: express.Express, port: number) => new Promise<{ close(): void }>((r) => { const s = app.listen(port, () => r(s)) })
const servers = [await listen(plain, 4101), await listen(lib, 4102)]

const run = promisify(execFile)
const hit = async (port: number, path: string) => {
  const { stdout } = await run("node_modules/.bin/autocannon", ["-j", "-c", "50", "-d", "10", `http://localhost:${port}${path}`], { maxBuffer: 1 << 24 })
  return JSON.parse(stdout) as { requests: { average: number }; latency: { p99: number }; non2xx: number; errors: number }
}

const results: Record<string, number> = {}
for (const [name, port, path] of [
  ["hand-written, res.json", 4101, "/api/category?limit=20"],
  ["hand-written, res.end", 4101, "/api/raw?limit=20"],
  ["sysonejs (no params)", 4102, "/api/category?limit=20"],
  ["sysonejs (search + filters + sort)", 4102, "/api/category?search=cat&filter[parentId]=1&filter[active]=true&sort=-createdAt&limit=20"],
] as const) {
  await hit(port, path)
  const r = await hit(port, path)
  results[name] = r.requests.average
  console.log(`${name.padEnd(36)} ${Math.round(r.requests.average).toString().padStart(7)} req/s   p99 ${r.latency.p99} ms   non-2xx ${r.non2xx} errors ${r.errors}`)
}
const base = results["hand-written, res.end"]!
for (const [k, v] of Object.entries(results))
  if (v !== base) console.log(`${k}: ${v >= base ? "+" : ""}${(((v - base) / base) * 100).toFixed(1)}% throughput vs hand-written res.end`)
servers.forEach((s) => s.close())
