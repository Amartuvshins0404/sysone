import type { SysoneClientError } from "./client"
import type { WireList, WireListParams, WireModelMeta, WireOne, WireRow } from "./wire"

export type Row = { [field: string]: unknown }
export type Body = WireList | WireOne | null

type Entity = readonly [row: Row | null, at: number]

export interface Snapshot {
  readonly items: readonly Row[]
  readonly ids: readonly string[]
  readonly data: Row | null | undefined
  readonly loading: boolean
  readonly error: SysoneClientError | Error | undefined
  readonly hasMore: boolean
  readonly loadMore: () => Promise<void>
  readonly refetch: () => Promise<void>
}

export interface Query {
  readonly subscribe: (onChange: () => void) => () => void
  readonly getSnapshot: () => Snapshot
  readonly changed: () => void
  readonly written: (model: string, changed: readonly string[] | null) => void
}

export type Request = (method: string, model: string, id?: unknown, query?: string, body?: object) => Promise<Body>

export const text = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v))

export function encodeQuery(p: WireListParams): string {
  const q = new URLSearchParams()
  const add = (k: string, v: unknown): unknown =>
    Array.isArray(v)
      ? v.forEach((x) => add(k, x))
      : v && typeof v === "object" && !(v instanceof Date)
        ? Object.keys(v).sort().forEach((o) => add(`${k}[${o}]`, (v as Row)[o]))
        : v !== undefined && q.append(k, text(v))
  add("search", p.search?.trim() || undefined)
  add("filter", p.filter)
  add("sort", p.sort?.join() || undefined)
  add("include", p.include?.slice().sort().join() || undefined)
  add("limit", p.limit)
  add("cursor", p.cursor || undefined)
  return q.toString()
}

export function createCache(request: Request) {
  let clock = 0
  const entities = new Map<string, Map<string, Entity>>()
  const metas = new Map<string, WireModelMeta>()
  const queries = new Map<string, Query>()
  const readers = new Map<string, Set<Query>>()

  const table = (m: string) => entities.get(m) ?? entities.set(m, new Map()).get(m)!
  const rowOf = (m: string, id: string) => table(m).get(id)?.[0]
  const link = (m: string, r: string): readonly string[] => metas.get(m)?.links?.[r] ?? []
  const touch = (m: string) => readers.get(m)?.forEach((q) => q.changed())
  const put = (m: string, id: string, row: Row | null, at: number) => {
    const t = table(m)
    if ((t.get(id)?.[1] ?? 0) <= at) t.set(id, [row, at])
  }

  function ingest(m: string, body: Body, at: number): string[] {
    if (!body) return []
    for (const n in body.meta) metas.set(n, body.meta[n]!)
    const store = (n: string, rows: readonly WireRow[]) => {
      const meta = metas.get(n)!
      const types = meta.types ?? {}
      const ids = rows.map((r) => {
        const row = r as Row
        for (const f in types) if (row[f] != null) row[f] = types[f] === "date" ? new Date(row[f] as string) : BigInt(row[f] as string)
        const id = text(row[meta.id])
        put(n, id, row, at)
        return id
      })
      touch(n)
      return ids
    }
    for (const n in body.included) store(n, body.included[n]!)
    return store(m, (body as WireList).items ?? [(body as WireOne).item])
  }

  const related = (m: string, row: Row, r: string) => {
    const [t, k] = link(m, r)
    return t && (row[k!] == null ? null : rowOf(t, text(row[k!])))
  }

  function join(m: string, ids: readonly string[], include: readonly string[]): [Row[], string[]] {
    const items: Row[] = []
    const kept: string[] = []
    for (const id of ids) {
      const row = rowOf(m, id)
      if (!row) continue
      const item = include.length ? { ...row } : row
      for (const r of include) item[r] = related(m, row, r) || null
      items.push(item)
      kept.push(id)
    }
    return [items, kept]
  }

  function query(model: string, params?: WireListParams, rawId?: unknown, include: readonly string[] = params?.include ?? []): Query {
    const id = params ? undefined : text(rawId)
    const key = `${model}/${id ?? ""}?${encodeQuery(params ?? { include })}`
    const hit = queries.get(key)
    if (hit) return hit
    let ids: readonly string[] = params ? [] : [id!]
    let next: string | null = null
    let ready = false
    let loading = false
    let error: Error | undefined
    let gen = 0
    let snap: Snapshot | undefined
    let gc: ReturnType<typeof setTimeout> | undefined
    const subs = new Set<() => void>()
    const emit = () => subs.forEach((f) => f())
    const changed = () => {
      snap = undefined
      emit()
    }
    const drop = () => {
      if (queries.get(key) === q) queries.delete(key)
      readers.forEach((s) => s.delete(q))
    }

    async function load(more?: boolean): Promise<void> {
      if (more && (!next || loading)) return
      const g = ++gen
      const at = ++clock
      const want = more || !ready ? 0 : ids.length + (next ? 0 : 1)
      const page = params?.limit
      const got = more ? [...ids] : []
      let cursor = more ? next : null
      loading = true
      changed()
      try {
        do {
          const body = await request("GET", model, id, encodeQuery(params ? { ...params, cursor, limit: Math.max(want - got.length, page ?? 0) || undefined } : { include }))
          if (g !== gen) return
          got.push(...ingest(model, body, at))
          cursor = (body as WireList | null)?.next ?? null
        } while (cursor && got.length < want)
        ids = got
        next = cursor
        ready = true
        error = undefined
      } catch (e) {
        if (g !== gen) return
        error = e as Error
      }
      loading = false
      changed()
    }

    const loadMore = () => load(true)
    const refetch = () => load()
    const q: Query = {
      changed,
      subscribe(f) {
        clearTimeout(gc)
        subs.add(f)
        if (!ready && !loading) {
          const row = !params && rowOf(model, id!)
          if (row && include.every((r) => related(model, row, r) !== undefined)) {
            ready = true
            changed()
          } else load()
        }
        return () => {
          subs.delete(f)
          if (!subs.size) gc = setTimeout(drop, 3e4)
        }
      },
      getSnapshot() {
        if (!snap) {
          for (const n of [model, ...include.map((r) => link(model, r)[0]!)]) (readers.get(n) ?? readers.set(n, new Set()).get(n)!).add(q)
          const [items, kept] = join(model, ids, include)
          snap = { items, ids: kept, data: ready ? (items[0] ?? null) : undefined, loading: loading || (!ready && !error), error, hasMore: !!next, loadMore, refetch }
        }
        return snap
      },
      written(m, fields) {
        if (m !== model || !params) return
        const sort = params.sort
        const deps =
          params.search || !sort?.length ? fields : [...include.map((r) => link(model, r)[1]!), ...Object.keys(params.filter ?? {}), ...sort.map((s) => s.replace("-", ""))]
        if (!fields || deps!.some((f) => fields.includes(f))) subs.size ? load() : drop()
      },
    }
    queries.set(key, q)
    return q
  }

  async function write(m: string, method: string, rawId?: unknown, data?: object): Promise<Row | null> {
    const at = ++clock
    const id = text(rawId)
    const old = rowOf(m, id)
    const body = await request(method, m, rawId, "", data)
    if (!body) {
      put(m, id, null, at)
      touch(m)
      return null
    }
    ingest(m, body, at)
    const row = (body as WireOne).item as Row
    const fields = method === "POST" ? null : Object.keys(row).filter((f) => !old || text(old[f]) !== text(row[f]))
    queries.forEach((q) => q.written(m, fields))
    return row
  }

  return [query, write] as const
}
