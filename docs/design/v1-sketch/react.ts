import type { Contracts, Item, ListParams, RelationName } from "./contract"
import type { Ref, SysoneClientError } from "./client"

export interface HookOptions {
  readonly debounce?: number
  readonly enabled?: boolean
}

export interface ListResult<T> {
  readonly items: readonly T[]
  readonly loading: boolean
  readonly error: SysoneClientError | undefined
  readonly hasMore: boolean
  readonly loadMore: () => Promise<void>
  readonly refetch: () => Promise<void>
}

export interface GetResult<T> {
  readonly data: T | null | undefined
  readonly loading: boolean
  readonly error: SysoneClientError | undefined
}

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
  readonly error: SysoneClientError | undefined
  readonly hasMore: boolean
  readonly loadMore: () => Promise<void>
}

export function useList<Cs extends Contracts, N extends keyof Cs & string, const I extends readonly RelationName<Cs[N]>[] = readonly []>(
  ref: Ref<Cs, N>,
  params?: ListParams<Cs[N], I>,
  options?: HookOptions,
): ListResult<Item<Cs, N, I>> {
  throw new Error("not implemented")
}

export function useGet<Cs extends Contracts, N extends keyof Cs & string, const I extends readonly RelationName<Cs[N]>[] = readonly []>(
  ref: Ref<Cs, N>,
  id: Cs[N]["id"] | null | undefined,
  options?: { readonly include?: I; readonly enabled?: boolean },
): GetResult<Item<Cs, N, I>> {
  throw new Error("not implemented")
}

export function useSelect<Cs extends Contracts, N extends keyof Cs & string, const I extends readonly RelationName<Cs[N]>[] = readonly []>(
  ref: Ref<Cs, N>,
  options: SelectOptions<Cs, N, I>,
): SelectResult<Item<Cs, N, I>> {
  throw new Error("not implemented")
}
