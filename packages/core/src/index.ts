import type { z } from "zod"

export type Dir = "asc" | "desc"

type Keys<S extends z.ZodObject> = Extract<keyof S["shape"], string>

export interface ModelConfig<S extends z.ZodObject, K extends Keys<S>> {
  name: string
  schema: S
  id?: K
  search?: Keys<S>[]
  filter?: Keys<S>[]
  sort?: Keys<S>[]
  defaultSort?: Keys<S> | `-${Keys<S>}`
  limit?: number
  maxLimit?: number
  create?: z.ZodType
  update?: z.ZodType
}

export interface Model<S extends z.ZodObject = z.ZodObject, K extends string = string> {
  name: string
  schema: S
  id: K
  keys: string[]
  dates: string[]
  search: string[]
  filter: string[]
  sort: string[]
  defaultSort: string
  limit: number
  maxLimit: number
  create: z.ZodType
  update: z.ZodType
}

export type Infer<M extends Model> = z.infer<M["schema"]>
export type Id<M extends Model> = Infer<M>[M["id"]]

export interface Page<T> {
  items: T[]
  next: string | null
}

export function kind(t: z.ZodType): string {
  let d = t._zod.def as { type: string; innerType?: z.ZodType }
  while (d.innerType) d = d.innerType._zod.def as typeof d
  return d.type
}

export function defineModel<S extends z.ZodObject, K extends Keys<S> = Extract<"id", Keys<S>>>(
  c: ModelConfig<S, K>,
): Model<S, K> {
  const id = (c.id ?? "id") as K
  const keys = Object.keys(c.schema.shape)
  if (!keys.includes(id)) throw new Error(`sysonejs: model "${c.name}" has no "${id}" field`)
  const create = c.create ?? c.schema.omit({ [id]: true } as never)
  return {
    name: c.name,
    schema: c.schema,
    id,
    keys,
    dates: keys.filter((k) => kind(c.schema.shape[k] as z.ZodType) === "date"),
    search: c.search ?? [],
    filter: c.filter ?? [],
    sort: c.sort ?? [],
    defaultSort: c.defaultSort ?? id,
    limit: c.limit ?? 20,
    maxLimit: c.maxLimit ?? 100,
    create,
    update: c.update ?? (create as z.ZodObject).partial(),
  }
}
