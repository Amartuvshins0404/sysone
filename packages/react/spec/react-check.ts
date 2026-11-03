import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Window } from "happy-dom"
import { createElement, useState } from "react"
import { createClient } from "sysonejs/client"
import { useGet, useList, useSelect } from "@sysonejs/react"
import type { Api } from "../../../examples/express/src/api.ts"

const port = 3900 + Math.floor(Math.random() * 90)
const base = `http://localhost:${port}/api`
const server = spawn(process.execPath, [fileURLToPath(new URL("../../../examples/express/src/server.ts", import.meta.url))], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "ignore"],
})
process.on("exit", () => server.kill())
setTimeout(() => {
  console.log("FAIL the check did not finish in 60s")
  process.exit(1)
}, 60_000).unref()
await new Promise<void>((ok, fail) => {
  server.stdout!.once("data", () => ok())
  server.once("exit", (code) => fail(new Error(`example server exited with ${code}`)))
})

const win = new Window({ url: "http://localhost/" })
Object.assign(globalThis, { window: win, document: win.document })
const { createRoot } = await import("react-dom/client")

const nodeFetch = globalThis.fetch
let log: { method: string; path: string; query: URLSearchParams }[] = []
let slow: ((path: string, query: URLSearchParams) => number) | undefined
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const db = createClient<Api>({
  url: base,
  headers: () => ({ "x-tenant": "t1", "x-role": "admin" }),
  fetch: async (input, init) => {
    const url = new URL(String(input))
    const path = url.pathname.slice(4)
    log.push({ method: init?.method ?? "GET", path, query: url.searchParams })
    const res = await nodeFetch(input, init)
    const delay = slow?.(path, url.searchParams) ?? 0
    if (delay) await sleep(delay)
    return res
  },
})

let failed = 0
function check(ok: boolean, what: string, detail?: unknown) {
  if (!ok) failed++
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok || detail === undefined ? "" : `  got ${JSON.stringify(detail)}`}`)
}

async function until(cond: () => boolean, what: string, ms = 2000) {
  const end = Date.now() + ms
  const ok = () => {
    try {
      return cond()
    } catch {
      return false
    }
  }
  while (!ok()) {
    if (Date.now() > end) return check(false, `timed out waiting for ${what}`)
    await sleep(5)
  }
}

function mount<P extends object, T>(hook: (props: P) => T, props: P) {
  const box = { current: undefined as T }
  const root = createRoot(document.createElement("div") as unknown as Element)
  const C = (p: P) => {
    box.current = hook(p)
    return null
  }
  root.render(createElement(C, props))
  return { box, rerender: (p: P) => root.render(createElement(C, p)), unmount: () => root.unmount() }
}

const gets = (path: string) => log.filter((r) => r.method === "GET" && r.path === path)
const lists = () => log.filter((r) => r.method === "GET" && r.path === "/category")
const settle = () => sleep(60)

try {
  {
    log = []
    const label = (c: { name: string; parent: { name: string } | null }) => (c.parent ? `${c.parent.name} / ${c.name}` : c.name)
    const on = mount(() => useSelect(db.category, { value: 4, include: ["parent"], label, sort: ["name"], limit: 5 }), {})
    await until(() => !!on.box.current.selected, "on-page selected option")
    await settle()
    check(on.box.current.options.length === 5, "select shows first page of 5", on.box.current.options.length)
    check(on.box.current.selected?.label === "Banana / Date 100%", "on-page selected value uses the page row", on.box.current.selected?.label)
    check(gets("/category/4").length === 0, "on-page selected value makes no extra request", gets("/category/4").length)
    const off = mount(() => useSelect(db.category, { value: 12, include: ["parent"], label, sort: ["name"], limit: 5 }), {})
    await until(() => !!off.box.current.selected, "off-page selected option")
    check(off.box.current.selected?.label === "Elder_berry / Nectarine", "off-page selected value carries its include", off.box.current.selected?.label)
    check(gets("/category/12").length === 1, "off-page value fetched once by id", gets("/category/12").length)
    check(gets("/category/12")[0]?.query.get("include") === "parent", "off-page fetch asks for the include")
    const cached = mount(() => [useGet(db.category, 2, { include: ["parent"] }), useGet(db.category, 9, { include: ["parent"] })] as const, {})
    await until(() => !!cached.box.current[1].data, "get by id")
    check(cached.box.current[0].data?.parent?.name === "Apple", "a get whose row and include are cached reads the cache", cached.box.current[0].data)
    check(gets("/category/2").length === 0, "a cached get makes no request", gets("/category/2").length)
    check(gets("/category/9").length === 1 && cached.box.current[1].data?.parent?.name === "Date 100%", "an uncached get fetches once with its include")
    cached.unmount()
    check(lists().length === 1, "two pickers with the same params share one list request", lists().length)

    log = []
    const s = on.box.current
    s.onSearch("a")
    await sleep(30)
    on.box.current.onSearch("ap")
    await sleep(30)
    on.box.current.onSearch("app")
    await until(() => !on.box.current.loading && on.box.current.search === "app" && lists().length > 0, "debounced search")
    await sleep(300)
    check(lists().length === 1, "typing three characters makes one request", lists().map((r) => r.query.get("search")))
    check(lists()[0]?.query.get("search") === "app", "the request carries the final term", lists()[0]?.query.get("search"))
    check(on.box.current.options.map((o) => o.label).join() === "Apple", "search results are shown", on.box.current.options.map((o) => o.label))
    off.unmount()
    on.unmount()
  }

  {
    log = []
    const byName = mount(() => useList(db.category, { sort: ["name"], limit: 5 }), {})
    await until(() => byName.box.current.items.length === 5, "first page")
    check(byName.box.current.hasMore, "first page has more")
    await byName.box.current.loadMore()
    await until(() => byName.box.current.items.length === 10, "second page")
    check(lists()[1]?.query.has("cursor") === true, "loadMore sends the cursor")
    log = []
    await db.category.update(5, { name: "Elderberry" })
    await settle()
    check(lists().length === 1 && lists()[0]!.query.get("limit") === "10", "a partly loaded list refetches the 10 rows it had loaded", lists().map((r) => r.query.toString()))
    check(byName.box.current.items.length === 10 && byName.box.current.hasMore, "the refetched span keeps its size and cursor")
    await byName.box.current.loadMore()
    await until(() => byName.box.current.items.length === 12, "third page")
    check(!byName.box.current.hasMore, "last page has no more")
    check(byName.box.current.items.map((c) => c.name).join() === "Apple,Banana,Cherry,Date 100%,Elderberry,Fig,Grape,Honeydew,Kiwi,Lemon,Mango,Nectarine", "pages are in order")
    check(byName.box.current.items[0]!.createdAt instanceof Date && typeof byName.box.current.items[4]!.size === "bigint", "dates and bigints are revived")
    check(byName.box.current.items[4]!.size === 9007199254740993n, "bigint keeps full precision", String(byName.box.current.items[4]!.size))

    const active = mount(() => useList(db.category, { filter: { active: true }, sort: ["-createdAt"], limit: 5 }), {})
    await until(() => active.box.current.items.length === 5, "filtered list")
    await active.box.current.loadMore()
    await until(() => active.box.current.items.length === 9, "filtered list fully loaded")
    await settle()

    log = []
    const target = active.box.current.items[0]!
    await db.category.update(target.id, { parentId: 7 })
    await settle()
    check(lists().length === 0, "patch on a field no list depends on refetches no list", lists().map((r) => r.query.toString()))
    check(active.box.current.items.find((c) => c.id === target.id)?.parentId === 7, "the patched row updates in place")

    log = []
    await db.category.update(target.id, { name: "Aardvark" })
    await settle()
    check(lists().length === 1 && lists()[0]!.query.get("sort") === "name", "patch on a sorted field refetches only the list sorted by it", lists().map((r) => r.query.toString()))
    check(lists()[0]?.query.get("limit") === "13", "a fully loaded list refetches its whole span", lists()[0]?.query.get("limit"))
    await until(() => byName.box.current.items[0]?.name === "Aardvark", "re-sorted list")

    log = []
    await db.category.update(target.id, { active: false })
    await settle()
    check(
      lists().length === 1 && lists()[0]!.query.get("filter[active]") === "true" && lists()[0]!.query.get("limit") === "10",
      "patch on a filtered field refetches the filtered list's loaded span",
      lists().map((r) => r.query.toString()),
    )
    check(!active.box.current.items.some((c) => c.id === target.id), "the row leaves the filtered list")
    check(byName.box.current.items.some((c) => c.id === target.id), "the row stays in the unfiltered list")

    log = []
    const gone = byName.box.current.items[1]!
    await db.category.delete(gone.id)
    await settle()
    check(lists().length === 0, "delete refetches no list", lists().length)
    check(!byName.box.current.items.some((c) => c.id === gone.id) && !active.box.current.items.some((c) => c.id === gone.id), "delete removes the row from every list")
    await db.category.delete(gone.id)
    check(true, "deleting twice is safe")

    log = []
    const made = await db.category.create({ name: "Avocado", parentId: null, active: true })
    await settle()
    check(lists().length === 2, "insert refetches every mounted list of the model", lists().map((r) => r.query.toString()))
    await until(() => byName.box.current.items.some((c) => c.id === made.id), "inserted row shown")
    check(byName.box.current.items[1]?.name === "Avocado", "inserted row lands in sort order", byName.box.current.items.map((c) => c.name))

    log = []
    const row = active.box.current.items[0]!
    slow = (path) => (path === "/category" ? 300 : 0)
    const stale = active.box.current.refetch()
    await sleep(50)
    slow = undefined
    await db.category.update(row.id, { name: "Fresh" })
    await stale
    await settle()
    check(active.box.current.items.find((c) => c.id === row.id)?.name === "Fresh", "a slow older list response does not overwrite a newer write", active.box.current.items.find((c) => c.id === row.id)?.name)

    log = []
    const leaving = active.box.current.items[0]!
    slow = (path) => (path === "/category" ? 300 : 0)
    void active.box.current.refetch()
    await sleep(50)
    slow = undefined
    await db.category.update(leaving.id, { active: false })
    await sleep(400)
    check(!active.box.current.items.some((c) => c.id === leaving.id), "a slow older list response does not bring back a row a newer write moved out")

    const racing = active.box.current.items[0]!
    slow = (path) => (path === `/category/${racing.id}` ? 300 : 0)
    const patching = db.category.update(racing.id, { active: false })
    await sleep(100)
    slow = undefined
    await byName.box.current.refetch()
    await patching
    await settle()
    check(!active.box.current.items.some((c) => c.id === racing.id), "a write still refetches the lists it affects when another list saw the new value first")
    byName.unmount()
    active.unmount()
  }

  {
    log = []
    const Search = () => {
      const [q] = useState("")
      return useList(db.category, { search: q, filter: { active: true }, sort: ["name"] }, { debounce: 200 })
    }
    const s = mount(Search, {})
    await until(() => !s.box.current.loading, "list with debounce")
    const first = lists().length
    s.rerender({})
    await sleep(250)
    check(lists().length === first, "re-rendering with the same params makes no request", lists().length)
    s.unmount()
  }

  try {
    await db.category.update(1, { name: "" })
    check(false, "invalid body is rejected")
  } catch (e) {
    const err = e as { code?: string; issues?: { [k: string]: string } }
    check(err.code === "invalid_body" && typeof err.issues?.name === "string", "server validation errors arrive keyed by field", err)
  }
} finally {
  server.kill()
  await win.happyDOM.close()
}

console.log(failed ? `${failed} check(s) failed` : "all checks passed")
process.exit(failed ? 1 : 0)
