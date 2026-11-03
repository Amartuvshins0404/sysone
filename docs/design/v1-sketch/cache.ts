import type { SysoneClientError } from "./client"
import type { WireList, WireListParams, WireModelMeta, WireOne, WireRow } from "./wire"

export type Decoded = Record<string, unknown>

export interface Entity {
  readonly row: Decoded
  readonly at: number
}

export interface Status {
  readonly loading: boolean
  readonly error: SysoneClientError | undefined
}

export interface ListEntry {
  readonly key: string
  readonly model: string
  readonly params: WireListParams
  readonly reads: ReadonlySet<string>
  ids: readonly string[]
  next: string | null
  status: Status
  gen: number
  dirty: boolean
  readonly subs: Set<() => void>
  snapshot: unknown
  seen: number
  gc: ReturnType<typeof setTimeout> | undefined
}

export interface GetEntry {
  readonly key: string
  readonly model: string
  readonly id: string
  readonly include: readonly string[]
  readonly reads: ReadonlySet<string>
  status: Status
  missing: boolean
  readonly subs: Set<() => void>
  snapshot: unknown
  seen: number
  gc: ReturnType<typeof setTimeout> | undefined
}

export interface Cache {
  clock: number
  readonly entities: Map<string, Map<string, Entity>>
  readonly versions: Map<string, number>
  readonly meta: Map<string, WireModelMeta>
  readonly lists: Map<string, ListEntry>
  readonly gets: Map<string, GetEntry>
  readonly readers: Map<string, Set<ListEntry | GetEntry>>
}

export function createCache(): Cache {
  throw new Error("not implemented")
}

export function tick(cache: Cache): number {
  throw new Error("not implemented")
}

export function ingest(cache: Cache, model: string, body: WireList | WireOne, startedAt: number): readonly string[] {
  // TODO shared-state rule (lists, gets and writes all write entities):
  //   cache.meta.set(m, body.meta[m]) for every model in the body; revive date/bigint fields by meta.types
  //   entity key = String(row[meta.id])
  //   for each row of body.items / body.item and of body.included[m]:
  //     prev = entities[m][id]
  //     if prev && prev.at > startedAt -> keep prev (a newer write landed while this request was in flight)
  //     else entities[m][id] = { row, at: startedAt }; versions[m]++
  //   notify readers of every touched model once (batched in a microtask)
  //   return ids of the primary rows in response order
  throw new Error("not implemented")
}

export function revive(row: WireRow, meta: WireModelMeta): Decoded {
  throw new Error("not implemented")
}

export function readList(cache: Cache, entry: ListEntry): unknown {
  // TODO stable snapshot for useSyncExternalStore:
  //   v = sum of versions over entry.reads ; if v == entry.seen && entry.snapshot -> return entry.snapshot
  //   items = entry.ids.map(id => join(entities[model][id].row, include)), dropping ids whose entity was removed
  //   join via cache.meta[model].links: row[rel] = entities[target][String(row[key])]?.row ?? null
  //   (merged at read, never copied into the stored row)
  //   entry.snapshot = { items, loading, error, hasMore: next != null }; entry.seen = v
  throw new Error("not implemented")
}

export function loadMore(cache: Cache, entry: ListEntry, fetchPage: (params: WireListParams) => Promise<WireList>): Promise<void> {
  throw new Error("not implemented")
}

export function refetchList(cache: Cache, entry: ListEntry, fetchPage: (params: WireListParams) => Promise<WireList>): Promise<void> {
  // TODO refetch every loaded page, swap atomically:
  //   gen = ++entry.gen; entry.dirty = false; want = max(entry.ids.length, params.limit ?? default)
  //   startedAt = tick(); ids = []; cursor = null
  //   loop: page = fetchPage({ ...params, cursor, limit: want - ids.length })   server clamps to maxLimit
  //         ingest(page, startedAt); ids.push(...page ids); cursor = page.next
  //         stop when ids.length >= want or cursor == null
  //   if gen !== entry.gen -> discard (a newer refetch superseded this one)
  //   entry.ids = ids; entry.next = cursor; status idle; notify
  //   if entry.dirty became true during the loop -> refetchList again (a write happened mid-flight)
  //   error -> keep old ids, set status.error, notify
  throw new Error("not implemented")
}

export type WriteKind = "insert" | "patch" | "remove"

export function invalidate(cache: Cache, model: string, kind: WriteKind, id: string, row: Decoded | null): void {
  // TODO cache invalidation after a successful write on `model`:
  //   at = tick()
  //   patch:  entities[model][id] = { row, at } -> every list/get that shows it (directly or via include) re-renders
  //   remove: delete entities[model][id]; gets of that id -> data null; lists drop the id on next read
  //   insert: entities[model][id] = { row, at }
  //   then for each list entry with entry.model == model (not lists that only include it):
  //     subscribed  -> entry.dirty = true; if not loading refetchList(entry) else picked up by the running loop
  //     unsubscribed -> lists.delete(entry.key)
  //   gets of `model` are never refetched: the write response is the new truth
  throw new Error("not implemented")
}

export function retain(cache: Cache, entry: ListEntry | GetEntry, onChange: () => void): () => void {
  throw new Error("not implemented")
}
