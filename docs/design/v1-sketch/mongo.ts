import type { Collection, Document, Filter, ObjectId } from "mongodb"
import type { Cond, Source } from "./source"

type Plain<T> = T extends ObjectId ? string : T

export type MongoRow<D> = { [K in keyof D as K extends "_id" ? never : K]: Plain<D[K]> } & { id: string }

export interface MongoOptions<D> {
  readonly objectIds?: readonly (keyof D & string)[]
}

export function mongo<D extends Document>(collection: Collection<D>, options?: MongoOptions<D>): Source<MongoRow<D>> {
  throw new Error("not implemented")
}

function toFilter(cond: Cond, field: (name: string) => string, toStored: (name: string, value: unknown) => unknown): Filter<Document> {
  throw new Error("not implemented")
}
