import type { z } from "zod"
import type { FilterInput, SortSpec } from "./contract"
import type { Source } from "./source"

export type AnySchema = z.ZodObject
type Out<S extends AnySchema> = z.output<S>
type In<S extends AnySchema> = z.input<S>
type Scalar = string | number | boolean | bigint | Date

export type Field<S extends AnySchema> = Extract<keyof Out<S>, string>

type KeysWhere<T, V> = { [K in keyof T]-?: NonNullable<T[K]> extends V ? K : never }[keyof T] & string
type NonNullKeys<T> = { [K in keyof T]-?: null extends T[K] ? never : undefined extends T[K] ? never : K }[keyof T] & string

export type ScalarField<S extends AnySchema> = KeysWhere<Out<S>, Scalar>
export type TextField<S extends AnySchema> = KeysWhere<Out<S>, string>
export type OrderedField<S extends AnySchema> = KeysWhere<Out<S>, string | number | bigint | Date> & NonNullKeys<Out<S>>
export type IdField<S extends AnySchema> = KeysWhere<Out<S>, string | number | bigint> & NonNullKeys<Out<S>>

export type Match<Row> = { readonly [K in KeysWhere<Row, Scalar>]?: Row[K] | readonly Row[K][] }
export type Rule<Row> = boolean | Match<Row> | readonly Match<Row>[]

export interface Grants<Row> {
  readonly read?: Rule<Row>
  readonly create?: boolean | Match<Row>
  readonly update?: Rule<Row>
  readonly delete?: Rule<Row>
}

export interface Relation<K extends string = string> {
  readonly model: string
  readonly key: K
}

export interface ModelOptions<S extends AnySchema> {
  readonly id?: IdField<S>
  readonly write?: readonly Field<S>[]
  readonly search?: readonly TextField<S>[]
  readonly filter?: readonly ScalarField<S>[]
  readonly sort?: readonly OrderedField<S>[]
  readonly defaultSort?: readonly SortSpec<OrderedField<S> | IdField<S>>[]
  readonly limit?: number
  readonly maxLimit?: number
  readonly relations?: { readonly [name: string]: Relation<ScalarField<S>> }
  readonly access?: (ctx: never) => Grants<Out<S>>
}

type Covers<F extends string, R> = [F] extends [keyof R] ? unknown : { readonly "~missing columns": Exclude<F, keyof R> }

export interface Model<N extends string = string, S extends AnySchema = AnySchema, O extends ModelOptions<S> = ModelOptions<S>> {
  readonly name: N
  readonly schema: S
  readonly options: O
  from<R>(source: Source<R> & Covers<Field<S>, R>): Bound<Model<N, S, O>>
}

export type AnyModel = Model<string, AnySchema, any>

export interface Bound<M extends AnyModel = AnyModel> {
  readonly model: M
  readonly source: Source<unknown>
}

export function defineModel<const N extends string, S extends AnySchema, const O extends ModelOptions<S>>(
  config: { readonly name: N; readonly schema: S } & O,
): Model<N, S, O> {
  const model: Model<N, S, O> = {
    name: config.name,
    schema: config.schema,
    options: config,
    from: (source) => ({ model, source: source as Source<unknown> }),
  }
  return model
}

type SchemaOf<M extends AnyModel> = M["schema"]
type OptionsOf<M extends AnyModel> = M["options"]
type ListOf<O, K extends string> = O extends { readonly [P in K]?: readonly (infer E)[] } ? Extract<E, string> : never

export type RowOf<M extends AnyModel> = Out<SchemaOf<M>>
export type IdOf<M extends AnyModel> = OptionsOf<M>["id"] extends string ? OptionsOf<M>["id"] : "id"
export type CtxOf<M extends AnyModel> = OptionsOf<M> extends { readonly access: (ctx: infer C) => unknown } ? C : never
export type CreateOf<M extends AnyModel> = Pick<In<SchemaOf<M>>, ListOf<OptionsOf<M>, "write"> & keyof In<SchemaOf<M>>>
export type PatchOf<M extends AnyModel> = Partial<CreateOf<M>>

type RelationsOf<M extends AnyModel> = OptionsOf<M> extends { readonly relations: infer R } ? R : {}

export type ContractOf<M extends AnyModel> = {
  readonly row: RowOf<M>
  readonly id: RowOf<M>[IdOf<M>] & (string | number | bigint)
  readonly create: CreateOf<M>
  readonly patch: PatchOf<M>
  readonly filter: { readonly [K in ListOf<OptionsOf<M>, "filter">]?: FilterInput<RowOf<M>[K]> }
  readonly sort: ListOf<OptionsOf<M>, "sort"> | IdOf<M>
  readonly search: [ListOf<OptionsOf<M>, "search">] extends [never] ? false : true
  readonly relations: {
    readonly [R in keyof RelationsOf<M> & string]: RelationsOf<M>[R] extends Relation<infer K>
      ? { readonly model: RelationsOf<M>[R]["model"]; readonly nullable: null extends RowOf<M>[K] ? true : false }
      : never
  }
}
