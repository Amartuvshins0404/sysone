import type { z } from "zod"
import { kind, type Dir, type Model } from "./index"

export type Row = Record<string, unknown>
export type Action = "list" | "get" | "create" | "update" | "delete"

export interface ListQuery {
  search?: { fields: string[]; term: string }
  filter: Record<string, unknown[]>
  sort: { field: string; dir: Dir }
  after?: { value: unknown; id: unknown }
  limit: number
}

export interface Source {
  exact?: boolean
  list(q: ListQuery): Promise<Row[]>
  get(id: unknown): Promise<Row | null>
  create(data: Row): Promise<Row>
  update(id: unknown, data: Row): Promise<Row | null>
  delete(id: unknown): Promise<boolean>
}

export type SourceFactory = (model: Model) => Source

export interface Access<C> {
  action: Action
  ctx: C
  model: Model
  id?: unknown
  data?: Row
}

export type Can<C = any> = (a: Access<C>) => boolean | Promise<boolean>

export interface Endpoint {
  model: Model
  source: Source
  can: Can
}

export interface Req {
  method: string
  path: string
  query: URLSearchParams
  body: () => unknown
  ctx: () => unknown
}

export interface Res {
  status: number
  body?: unknown
}

export class SysoneError extends Error {
  status: number
  code: string
  issues?: unknown
  constructor(status: number, code: string, message: string, issues?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.issues = issues
  }
}

const readOnly: Can = ({ action }) => action === "list" || action === "get"

export function expose<C = any>(model: Model, opts: { source: SourceFactory; can?: Can<C> }): Endpoint {
  return { model, source: opts.source(model), can: opts.can ?? readOnly }
}

const bad = (code: string, message: string) => new SysoneError(400, code, message)
const notFound = () => new SysoneError(404, "not_found", "Not found")

export function coerce(model: Model, field: string, raw: unknown): unknown {
  const t = model.schema.shape[field] as z.ZodType
  if ((raw === null || raw === "null") && t.safeParse(null).success) return null
  let v = raw
  if (typeof raw === "string") {
    const k = kind(t)
    if (k === "number") v = raw.trim() === "" ? NaN : Number(raw)
    else if (k === "boolean") v = raw === "true" ? true : raw === "false" ? false : raw
    else if (k === "date") v = new Date(raw)
    else if (k === "bigint") {
      try {
        v = BigInt(raw)
      } catch {}
    }
  }
  const r = t.safeParse(v)
  if (!r.success) throw bad("invalid_value", `Invalid value for "${field}"`)
  return r.data
}

export function encodeCursor(v: unknown[]): string {
  try {
    return JSON.stringify(v)
  } catch {
    return JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x))
  }
}

export const decodeCursor = (s: string): unknown => JSON.parse(s)

export function parseList(model: Model, q: URLSearchParams): ListQuery {
  let limit = model.limit
  const l = q.get("limit")
  if (l !== null) {
    limit = Number(l)
    if (!Number.isInteger(limit) || limit < 1) throw bad("invalid_limit", "Invalid limit")
    limit = Math.min(limit, model.maxLimit)
  }

  const s = q.get("sort") || model.defaultSort
  const dir: Dir = s[0] === "-" ? "desc" : "asc"
  const field = dir === "desc" ? s.slice(1) : s
  if (field !== model.id && !model.sort.includes(field)) throw bad("invalid_sort", `Cannot sort by "${field}"`)

  const filter: Record<string, unknown[]> = {}
  for (const [k, v] of q) {
    if (!k.startsWith("filter[") || !k.endsWith("]")) continue
    const f = k.slice(7, -1)
    if (!model.filter.includes(f)) throw bad("invalid_filter", `Cannot filter by "${f}"`)
    ;(filter[f] ??= []).push(coerce(model, f, v))
  }

  const term = q.get("search")?.trim()
  if (term && !model.search.length) throw bad("invalid_search", "Search is not enabled")

  let after: ListQuery["after"]
  const c = q.get("cursor")
  if (c) {
    let t: unknown
    try {
      t = decodeCursor(c)
    } catch {}
    if (!Array.isArray(t) || t.length !== 3 || t[0] !== s) throw bad("invalid_cursor", "Invalid cursor")
    after = { value: coerce(model, field, t[1]), id: coerce(model, model.id, t[2]) }
  }

  return {
    search: term ? { fields: model.search, term } : undefined,
    filter,
    sort: { field, dir },
    after,
    limit,
  }
}

function pick(keys: string[], row: Row): Row {
  const out: Row = {}
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined) out[k] = v
  }
  return out
}

async function run(e: Endpoint, req: Req, rawId: string | undefined): Promise<Res> {
  const { model, source } = e
  const shape = source.exact ? (r: Row) => r : (r: Row) => pick(model.keys, r)
  const m = req.method
  const action: Action | undefined =
    rawId === undefined
      ? m === "GET" ? "list" : m === "POST" ? "create" : undefined
      : m === "GET" ? "get" : m === "PATCH" ? "update" : m === "DELETE" ? "delete" : undefined
  if (!action) throw new SysoneError(405, "method_not_allowed", "Method not allowed")

  const id = rawId === undefined ? undefined : coerce(model, model.id, decodeURIComponent(rawId))
  let data: Row | undefined
  if (action === "create" || action === "update") {
    const r = (action === "create" ? model.create : model.update).safeParse(await req.body())
    if (!r.success) throw new SysoneError(422, "invalid_body", "Invalid body", r.error.issues)
    data = r.data as Row
  }
  if (!(await e.can({ action, ctx: await req.ctx(), model, id, data }))) throw new SysoneError(403, "forbidden", "Forbidden")

  if (action === "list") {
    const q = parseList(model, req.query)
    const rows = await source.list(q)
    const more = rows.length > q.limit
    const items = (more ? rows.slice(0, q.limit) : rows).map(shape)
    const last = items[items.length - 1]
    const next = more && last ? encodeCursor([req.query.get("sort") || model.defaultSort, last[q.sort.field], last[model.id]]) : null
    return { status: 200, body: { items, next } }
  }
  if (action === "get") {
    const row = await source.get(id)
    if (!row) throw notFound()
    return { status: 200, body: shape(row) }
  }
  if (action === "create") return { status: 201, body: shape(await source.create(data!)) }
  if (action === "update") {
    const row = await source.update(id, data!)
    if (!row) throw notFound()
    return { status: 200, body: shape(row) }
  }
  if (!(await source.delete(id))) throw notFound()
  return { status: 204 }
}

export type Handler = (req: Req) => Promise<Res | null>

export function createHandler(endpoints: Endpoint[]): Handler {
  const map = new Map(endpoints.map((e) => [e.model.name, e]))
  return async (req) => {
    const parts = req.path.split("/").filter(Boolean)
    if (parts.length < 1 || parts.length > 2) return null
    const e = map.get(decodeURIComponent(parts[0]!))
    if (!e) return null
    try {
      return await run(e, req, parts[1])
    } catch (err) {
      if (!(err instanceof SysoneError)) throw err
      return { status: err.status, body: { error: { code: err.code, message: err.message, issues: err.issues } } }
    }
  }
}

export function fetchHandler(
  endpoints: Endpoint[],
  opts: { prefix?: string; context?: (req: Request) => unknown } = {},
): (req: Request) => Promise<Response> {
  const handle = createHandler(endpoints)
  const prefix = opts.prefix ?? ""
  return async (request) => {
    const url = new URL(request.url)
    const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : ""
    const r = await handle({
      method: request.method,
      path,
      query: url.searchParams,
      body: () => request.json().catch(() => undefined),
      ctx: () => opts.context?.(request),
    })
    if (!r) return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 })
    return r.body === undefined ? new Response(null, { status: r.status }) : Response.json(r.body, { status: r.status })
  }
}

export function memory(rows: Row[] = []): SourceFactory {
  return (model) => {
    const id = model.id
    let seq = rows.length
    const find = (v: unknown) => rows.findIndex((r) => r[id] === v)
    const cmp = (a: unknown, b: unknown) => (a! < b! ? -1 : a! > b! ? 1 : 0)
    return {
      async list(q) {
        const term = q.search?.term.toLowerCase()
        const s = q.sort.field
        const sign = q.sort.dir === "asc" ? 1 : -1
        const order = (a: Row, b: Row) => sign * (cmp(a[s], b[s]) || cmp(a[id], b[id]))
        const out = rows.filter(
          (r) =>
            (!term || q.search!.fields.some((f) => String(r[f] ?? "").toLowerCase().includes(term))) &&
            Object.entries(q.filter).every(([f, vs]) => vs.includes(r[f])) &&
            (!q.after || order(r, { [s]: q.after.value, [id]: q.after.id }) > 0),
        )
        return out.sort(order).slice(0, q.limit + 1)
      },
      async get(v) {
        return rows[find(v)] ?? null
      },
      async create(data) {
        const row = { [id]: ++seq, ...data }
        rows.push(row)
        return row
      },
      async update(v, data) {
        const r = rows[find(v)]
        return r ? Object.assign(r, data) : null
      },
      async delete(v) {
        const i = find(v)
        if (i < 0) return false
        rows.splice(i, 1)
        return true
      },
    }
  }
}
