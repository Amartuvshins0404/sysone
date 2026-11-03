import { ObjectId, type Collection, type Document, type Filter } from "mongodb"
import { expandAfter, type Binding, type Cond, type Row, type Source, type Store } from "sysonejs/source"

type Plain<T> = T extends ObjectId ? string : T

export type MongoRow<D> = { [K in keyof D as K extends "_id" ? never : K]: Plain<D[K]> } & { id: string }

export interface MongoOptions<D> {
  readonly objectIds?: readonly (keyof D & string)[]
}

const NUMERIC_ID: Document = { _id: { $type: "number" } }

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export function mongo<D extends Document>(collection: Collection<D>, options: MongoOptions<D> = {}): Source<MongoRow<D>> {
  return { name: "mongo", bind: (binding) => mongoStore(collection as unknown as Collection<Document>, binding, options.objectIds) }
}

function mongoStore(collection: Collection<Document>, binding: Binding, objectIds: readonly string[] = [binding.id]): Store {
  const id = binding.id
  const idKind = binding.fields.find((f) => f.name === id)!.kind
  const counted = idKind === "number" || idKind === "bigint"
  const oids = new Set(objectIds)
  const every = binding.fields.map((f) => f.name)
  const useBigInt64 = binding.fields.some((f) => f.kind === "bigint")
  const key = (field: string) => (field === id ? "_id" : field)
  const stored = (field: string, v: unknown) => (oids.has(field) && typeof v === "string" && v.length === 24 && ObjectId.isValid(v) ? new ObjectId(v) : v)
  const filter = (cond: Cond) => toFilter(cond, key, stored)
  const projection = (select: readonly string[]) => {
    const p: Document = { _id: 0 }
    for (const f of select) p[key(f)] = 1
    return p
  }
  const all = { projection: projection(every), useBigInt64 }
  const toRow = (doc: Document, select: readonly string[]): Row => {
    const row: Row = {}
    for (const f of select) {
      const v = doc[key(f)]
      if (v !== undefined) row[f] = v instanceof ObjectId ? v.toHexString() : v
    }
    return row
  }
  const toDoc = (row: Row): Document => {
    const doc: Document = {}
    for (const f in row) doc[key(f)] = stored(f, row[f])
    return doc
  }
  const nextId = async () => {
    const [top] = await collection.find(NUMERIC_ID, { projection: { _id: 1 }, sort: { _id: -1 }, limit: 1, useBigInt64 }).toArray()
    const last = (top?._id ?? 0) as number | bigint
    return idKind === "bigint" ? BigInt(last) + 1n : Number(last) + 1
  }

  return {
    async find(plan) {
      const select = plan.select.length === every.length ? every : plan.select
      const docs = await collection
        .find(plan.where ? filter(plan.where) : {}, {
          projection: select === every ? all.projection : projection(select),
          sort: plan.sort.map((k) => [key(k.field), k.dir === "asc" ? 1 : -1] as [string, 1 | -1]),
          limit: plan.take,
          useBigInt64,
        })
        .toArray()
      return docs.map((d) => toRow(d, select))
    },
    async insert(row) {
      const doc = toDoc(row)
      const generate = counted && doc._id === undefined
      for (;;) {
        if (generate) doc._id = await nextId()
        try {
          await collection.insertOne(doc)
          return toRow(doc, every)
        } catch (e) {
          const err = e as { code?: number; keyPattern?: Document }
          if (!generate || err.code !== 11000 || !err.keyPattern?._id) throw e
        }
      }
    },
    async update(cond, patch) {
      const set = toDoc(patch)
      delete set._id
      const doc = Object.keys(set).length
        ? await collection.findOneAndUpdate(filter(cond), { $set: set }, { ...all, returnDocument: "after" })
        : await collection.findOne(filter(cond), all)
      return doc && toRow(doc, every)
    },
    async remove(cond) {
      return (await collection.deleteOne(filter(cond))).deletedCount > 0
    },
  }
}

function toFilter(cond: Cond, key: (field: string) => string, stored: (field: string, value: unknown) => unknown): Filter<Document> {
  switch (cond.op) {
    case "and":
      return { $and: cond.of.map((c) => toFilter(c, key, stored)) }
    case "or":
      return { $or: cond.of.map((c) => toFilter(c, key, stored)) }
    case "eq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return { [key(cond.field)]: { [`$${cond.op}`]: stored(cond.field, cond.value) } }
    case "in":
      return { [key(cond.field)]: { $in: cond.values.map((v) => stored(cond.field, v)) } }
    case "null":
      return { [key(cond.field)]: null }
    case "contains": {
      const match = { $regex: escapeRegex(cond.term), $options: "i" }
      return { $or: cond.fields.map((f) => ({ [key(f)]: match })) }
    }
    case "after":
      return toFilter(expandAfter(cond), key, stored)
    default:
      return cond satisfies never
  }
}
