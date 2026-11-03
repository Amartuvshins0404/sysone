import { bench, boxplot, run, summary } from "mitata"
import { z } from "zod"
import { defineModel } from "../packages/core/dist/index.mjs"
import { createHandler, expose, type Source } from "../packages/core/dist/server.mjs"

const rows = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  name: `Category ${i}`,
  parentId: i % 3 ? 1 : null,
  active: i % 2 === 0,
  createdAt: new Date(2026, 0, i + 1),
}))

const fixed: Source = {
  exact: true,
  list: async () => rows.concat(rows[0]!),
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

const handle = createHandler([expose(category, { source: () => fixed })])
const none = () => undefined

async function handWritten(url: string) {
  const q = new URLSearchParams(url.slice(url.indexOf("?") + 1))
  const limit = Math.min(Number(q.get("limit") ?? 20), 100)
  const out = await fixed.list({ filter: {}, sort: { field: "id", dir: "asc" }, limit })
  const items = out.slice(0, limit).map(({ id, name, parentId, active, createdAt }) => ({ id, name, parentId, active, createdAt }))
  return { status: 200, body: { items, next: out.length > limit ? String(items.at(-1)!.id) : null } }
}

const simple = "/category?limit=20"
const full = "/category?search=cat&filter[parentId]=1&filter[parentId]=null&filter[active]=true&sort=-createdAt&limit=20"

const req = (url: string) => {
  const i = url.indexOf("?")
  return { method: "GET", path: url.slice(0, i), query: new URLSearchParams(url.slice(i + 1)), body: none, ctx: none }
}

boxplot(() => {
  summary(() => {
    bench("hand-written list endpoint", () => handWritten(simple))
    bench("sysonejs list (no params)", () => handle(req(simple)))
    bench("sysonejs list (search + 3 filters + sort)", () => handle(req(full)))
  })
})

await run()
