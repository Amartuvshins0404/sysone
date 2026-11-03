import { createContext, createElement, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react"
import type { Id, Infer, Model } from "sysonejs"
import { createClient, type Client, type ListParams, type Query } from "sysonejs/client"

const Ctx = createContext<Client | null>(null)
let fallback: Client | undefined

export function SysoneProvider(p: { client: Client; children?: ReactNode }) {
  return createElement(Ctx.Provider, { value: p.client }, p.children)
}

export function useClient(): Client {
  return useContext(Ctx) ?? (fallback ??= createClient())
}

const idle = { data: undefined, error: undefined, loading: false }
const none: never[] = []
const noop = () => () => {}

function useQuery<T>(q: Query<T> | null) {
  return useSyncExternalStore(
    q ? q.subscribe : noop,
    () => (q ? q.state : idle),
    () => (q ? q.state : idle),
  )
}

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v)
  useEffect(() => {
    if (!ms) return setD(v)
    const t = setTimeout(() => setD(v), ms)
    return () => clearTimeout(t)
  }, [v, ms])
  return ms ? d : v
}

export interface ListOptions {
  debounce?: number
  enabled?: boolean
}

export function useList<M extends Model>(model: M, params: ListParams<M> = {}, opts: ListOptions = {}) {
  const client = useClient()
  const search = useDebounced(params.search, opts.debounce ?? 0)
  const q = opts.enabled === false ? null : client.query.list(model, { ...params, search })
  const s = useQuery(q)
  return {
    items: (s.data?.items ?? none) as Infer<M>[],
    loading: s.loading,
    error: s.error,
    hasMore: !!s.data?.next,
    loadMore: () => q?.more(),
    refetch: () => q?.refetch(),
  }
}

export function useGet<M extends Model>(model: M, id: Id<M> | null | undefined) {
  const client = useClient()
  const s = useQuery(id == null ? null : client.query.get(model, id))
  return { data: s.data, loading: s.loading, error: s.error }
}

export interface Option<T> {
  value: string
  label: string
  item: T
}

export interface SelectOptions<M extends Model> extends ListOptions {
  label: keyof Infer<M> | ((item: Infer<M>) => string)
  value?: Id<M> | null
  params?: Omit<ListParams<M>, "search">
}

export function useSelect<M extends Model>(model: M, opts: SelectOptions<M>) {
  const [search, setSearch] = useState("")
  const list = useList(model, { ...opts.params, search }, { debounce: opts.debounce ?? 250, enabled: opts.enabled })
  const id = model.id as keyof Infer<M>
  const missing = opts.value != null && !list.items.some((i) => i[id] === opts.value)
  const selected = useGet(model, missing ? opts.value : null).data
  const label = opts.label
  const { options, current } = useMemo(() => {
    const toOption = (item: Infer<M>): Option<Infer<M>> => ({
      value: String(item[id]),
      label: typeof label === "function" ? label(item) : String(item[label]),
      item,
    })
    const options = list.items.map(toOption)
    const extra = selected ? toOption(selected) : undefined
    if (extra && !search) options.unshift(extra)
    return { options, current: options.find((o) => o.item[id] === opts.value) ?? extra }
  }, [list.items, selected, label, search, opts.value])
  return {
    options,
    selected: current,
    search,
    onSearch: setSearch,
    loading: list.loading,
    error: list.error,
    hasMore: list.hasMore,
    loadMore: list.loadMore,
  }
}
