import type { Id, Infer, Model, Page } from "./index"

export interface ListParams<M extends Model = Model> {
  search?: string
  filter?: { [K in keyof Infer<M>]?: Infer<M>[K] | Infer<M>[K][] }
  sort?: string
  limit?: number
  cursor?: string | null
}

export interface ClientOptions {
  url?: string
  fetch?: typeof fetch
  headers?: () => HeadersInit | Promise<HeadersInit>
  credentials?: RequestCredentials
}

export interface State<T> {
  data: T | undefined
  error: unknown
  loading: boolean
}

export interface Query<T> {
  key: string
  state: State<T>
  subscribe(fn: () => void): () => void
  refetch(): Promise<void>
}

export interface ListQuery<T> extends Query<Page<T>> {
  more(): Promise<void>
}

export class SysoneClientError extends Error {
  status: number
  code: string
  issues?: unknown
  constructor(status: number, e?: { code?: string; message?: string; issues?: unknown }) {
    super(e?.message ?? `Request failed with ${status}`)
    this.status = status
    this.code = e?.code ?? "http_error"
    this.issues = e?.issues
  }
}

const enc = (v: unknown) => (v instanceof Date ? v.toISOString() : v === null ? "null" : String(v))

export function toQuery(p: ListParams<any>): string {
  const q = new URLSearchParams()
  if (p.search) q.set("search", p.search)
  if (p.sort) q.set("sort", p.sort)
  if (p.limit) q.set("limit", String(p.limit))
  if (p.cursor) q.set("cursor", p.cursor)
  if (p.filter)
    for (const k of Object.keys(p.filter).sort()) {
      const v = p.filter[k]
      if (v === undefined) continue
      for (const x of Array.isArray(v) ? v : [v]) q.append(`filter[${k}]`, enc(x))
    }
  const s = q.toString()
  return s ? "?" + s : ""
}

interface Entry {
  q: Query<any>
  model: string
  subs: Set<() => void>
  set(s: Partial<State<any>>): void
  gc?: ReturnType<typeof setTimeout>
}

export type Client = ReturnType<typeof createClient>

export function createClient(o: ClientOptions = {}) {
  const base = (o.url ?? "/api").replace(/\/$/, "")
  const entries = new Map<string, Entry>()

  async function call(method: string, path: string, body?: unknown) {
    const headers = new Headers(await o.headers?.())
    if (body !== undefined) headers.set("content-type", "application/json")
    const res = await (o.fetch ?? fetch)(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: o.credentials,
    })
    if (res.status === 204) return undefined
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new SysoneClientError(res.status, json?.error)
    return json
  }

  function revive<T>(m: Model, row: any): T {
    for (const k of m.dates) if (typeof row[k] === "string") row[k] = new Date(row[k])
    return row
  }

  const path = (m: Model, id?: unknown) => "/" + encodeURIComponent(m.name) + (id === undefined ? "" : "/" + encodeURIComponent(enc(id)))

  const api = {
    async list<M extends Model>(m: M, p: ListParams<M> = {}): Promise<Page<Infer<M>>> {
      const page = await call("GET", path(m) + toQuery(p))
      page.items.forEach((r: unknown) => revive(m, r))
      return page
    },
    async get<M extends Model>(m: M, id: Id<M>): Promise<Infer<M>> {
      return revive(m, await call("GET", path(m, id)))
    },
    async create<M extends Model>(m: M, data: Partial<Infer<M>>): Promise<Infer<M>> {
      const r = revive<Infer<M>>(m, await call("POST", path(m), data))
      invalidate(m)
      return r
    },
    async update<M extends Model>(m: M, id: Id<M>, data: Partial<Infer<M>>): Promise<Infer<M>> {
      const r = revive<Infer<M>>(m, await call("PATCH", path(m, id), data))
      invalidate(m)
      return r
    },
    async delete<M extends Model>(m: M, id: Id<M>): Promise<void> {
      await call("DELETE", path(m, id))
      invalidate(m)
    },
  }

  function entry(key: string, model: string, load: (prev: any, more: boolean) => Promise<any>): Entry {
    let e = entries.get(key)
    if (e) return e
    let run: Promise<void> | undefined
    let runMore = false
    let seq = 0
    const fetchNow = (more = false): Promise<void> => {
      if (run && (more || !runMore)) return run
      const n = ++seq
      runMore = more
      self.set({ loading: true, error: undefined })
      const p = load(self.q.state.data, more).then(
        (data) => {
          if (n === seq) self.set({ loading: false, data })
        },
        (error) => {
          if (n === seq) self.set({ loading: false, error })
        },
      )
      run = p.finally(() => {
        if (n === seq) run = undefined
      })
      return run
    }
    const self: Entry = {
      model,
      subs: new Set(),
      q: {
        key,
        state: { data: undefined, error: undefined, loading: false },
        subscribe(fn) {
          clearTimeout(self.gc)
          self.subs.add(fn)
          if (self.subs.size === 1) fetchNow()
          return () => {
            self.subs.delete(fn)
            if (!self.subs.size) self.gc = setTimeout(() => entries.delete(key), 60_000)
          }
        },
        refetch: () => fetchNow(),
      },
      set(s) {
        self.q.state = { ...self.q.state, ...s }
        self.subs.forEach((f) => f())
      },
    }
    ;(self.q as ListQuery<unknown>).more = () => fetchNow(true)
    entries.set(key, (e = self))
    return e
  }

  function invalidate(m: Model) {
    for (const e of entries.values()) if (e.model === m.name) e.subs.size ? e.q.refetch() : entries.delete(e.q.key)
  }

  function list<M extends Model>(m: M, p: ListParams<M> = {}): ListQuery<Infer<M>> {
    return entry(`${m.name}${toQuery(p)}`, m.name, async (prev: Page<Infer<M>> | undefined, more) => {
      if (!more) return api.list(m, p)
      if (!prev?.next) return prev
      const page = await api.list(m, { ...p, cursor: prev.next })
      return { items: prev.items.concat(page.items), next: page.next }
    }).q as ListQuery<Infer<M>>
  }

  function one<M extends Model>(m: M, id: Id<M>): Query<Infer<M>> {
    return entry(`${m.name}/${enc(id)}`, m.name, () => api.get(m, id)).q
  }

  return { ...api, query: { list, get: one }, invalidate }
}
