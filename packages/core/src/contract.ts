export type Value = string | number | boolean | bigint | Date

export type SortSpec<K extends string> = K | `-${K}`

export interface Range<T> {
  readonly gt?: T
  readonly gte?: T
  readonly lt?: T
  readonly lte?: T
}

export type FilterInput<T> =
  | undefined
  | T
  | readonly NonNullable<T>[]
  | (NonNullable<T> extends string | number | bigint | Date ? Range<NonNullable<T>> : never)

export interface RelationContract {
  readonly model: string
}

export interface ModelContract {
  readonly row: object
  readonly id: string | number | bigint
  readonly create: object
  readonly patch: object
  readonly filter: object
  readonly sort: string
  readonly search: boolean
  readonly relations: { readonly [name: string]: RelationContract }
}

export type Contracts = { readonly [model: string]: ModelContract }

export interface HasContract<Cs extends Contracts = Contracts> {
  readonly "~contract"?: Cs
}

export type ContractsOf<A> = A extends HasContract<infer Cs> ? Cs : never

export type RelationName<C extends ModelContract> = Extract<keyof C["relations"], string>

export type Related<Cs extends Contracts, R extends RelationContract> = R["model"] extends keyof Cs ? Cs[R["model"]]["row"] | null : never

export type Item<Cs extends Contracts, N extends keyof Cs, I extends readonly string[]> = Cs[N]["row"] & {
  readonly [R in I[number] & keyof Cs[N]["relations"]]: Related<Cs, Cs[N]["relations"][R]>
}

export interface ListParams<C extends ModelContract, I extends readonly RelationName<C>[] = readonly []> {
  readonly search?: C["search"] extends true ? string : never
  readonly filter?: C["filter"]
  readonly sort?: readonly SortSpec<C["sort"]>[]
  readonly include?: I
  readonly limit?: number
}

export interface Page<T> {
  readonly items: readonly T[]
  readonly next: string | null
}
