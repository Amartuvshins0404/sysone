import { useEffect, useState, useSyncExternalStore } from "react"
import type { Contracts, GetSnapshot, Item, ListParams, ListSnapshot, Live, Ref, RelationName, SysoneClientError } from "sysonejs/client"

export interface HookOptions {
  readonly debounce?: number
  readonly enabled?: boolean
}

export type ListResult<T> = ListSnapshot<T>

export type GetResult<T> = GetSnapshot<T>

export interface Option<T> {
  readonly value: string
  readonly label: string
  readonly item: T
}

export interface SelectOptions<Cs extends Contracts, N extends keyof Cs & string, I extends readonly RelationName<Cs[N]>[]>
  extends Omit<ListParams<Cs[N], I>, "search" | "cursor">,
    HookOptions {
  readonly label: (keyof Cs[N]["row"] & string) | ((item: Item<Cs, N, I>) => string)
  readonly value?: Cs[N]["id"] | null
}

export interface SelectResult<T> {
  readonly options: readonly Option<T>[]
  readonly selected: Option<T> | undefined
  readonly search: string
  readonly onSearch: (search: string) => void
  readonly loading: boolean
  readonly error: SysoneClientError | Error | undefined
  readonly hasMore: boolean
  readonly loadMore: () => Promise<void>
}

type Rels<Cs extends Contracts, N extends keyof Cs & string> = readonly RelationName<Cs[N]>[]

const done = async () => {}
const SNAP = { items: [], ids: [], data: undefined, loading: false, error: undefined, hasMore: false, loadMore: done, refetch: done }
const IDLE = { subscribe: () => done, getSnapshot: () => SNAP }

const useLive = <S>(live: Live<S>) => useSyncExternalStore(live.subscribe, live.getSnapshot)

function useDebounced<T>(value: T, ms: number | undefined): T {
  const [settled, set] = useState(value)
  useEffect(() => {
    const t = setTimeout(set, ms, value)
    return () => clearTimeout(t)
  }, [value, ms])
  return ms ? settled : value
}

export function useList<Cs extends Contracts, N extends keyof Cs & string, const I extends Rels<Cs, N> = readonly []>(
  ref: Ref<Cs, N>,
  params: ListParams<Cs[N], I> = {},
  options: HookOptions = {},
): ListResult<Item<Cs, N, I>> {
  const search = useDebounced(params.search, options.debounce)
  return useLive(options.enabled === false ? IDLE : ref.watchList({ ...params, search }))
}

export function useGet<Cs extends Contracts, N extends keyof Cs & string, const I extends Rels<Cs, N> = readonly []>(
  ref: Ref<Cs, N>,
  id: Cs[N]["id"] | null | undefined,
  options: { readonly include?: I; readonly enabled?: boolean } = {},
): GetResult<Item<Cs, N, I>> {
  return useLive(id == null || options.enabled === false ? IDLE : ref.watchGet(id, options))
}

export function useSelect<Cs extends Contracts, N extends keyof Cs & string, const I extends Rels<Cs, N> = readonly []>(
  ref: Ref<Cs, N>,
  { label, value, debounce = 250, enabled, ...params }: SelectOptions<Cs, N, I>,
): SelectResult<Item<Cs, N, I>> {
  const [search, onSearch] = useState("")
  const list = useList(ref, { ...params, search } as ListParams<Cs[N], I>, { debounce, enabled })
  const text = typeof label === "function" ? label : (item: Item<Cs, N, I>) => String(item[label])
  const options = list.items.map((item, i) => ({ value: list.ids[i]!, label: text(item), item }))
  const key = String(value)
  const found = options.find((o) => o.value === key)
  const off = useGet(ref, value, { include: params.include, enabled: enabled !== false && !list.loading && !found }).data
  return { ...list, options, selected: found ?? (off ? { value: key, label: text(off), item: off } : undefined), search, onSearch }
}
