import { ObjectId, type Collection, type Document, type Filter } from "mongodb"
import type { Row, SourceFactory } from "sysonejs/server"

export interface MongoOptions {
  objectIds?: string[]
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export function mongo(collection: Collection<any>, opts: MongoOptions = {}): SourceFactory {
  return (model) => {
    const id = model.id
    const oids = new Set(opts.objectIds ?? [id])
    const field = (k: string) => (k === id ? "_id" : k)
    const to = (k: string, v: unknown) => (oids.has(k) && typeof v === "string" && ObjectId.isValid(v) && v.length === 24 ? new ObjectId(v) : v)
    const projection = Object.fromEntries(model.keys.map((k) => [field(k), 1]))
    const out = (d: Document | null): Row | null => {
      if (!d) return null
      const r: Row = {}
      for (const k of model.keys) {
        const v = d[field(k)]
        if (v !== undefined) r[k] = v instanceof ObjectId && oids.has(k) ? v.toHexString() : v
      }
      return r
    }
    const doc = (data: Row) => {
      const d: Document = {}
      for (const k in data) d[field(k)] = to(k, data[k])
      return d
    }

    return {
      exact: true,
      async list(q) {
        const and: Filter<Document>[] = []
        if (q.search) {
          const $regex = escapeRegex(q.search.term)
          and.push({ $or: q.search.fields.map((f) => ({ [field(f)]: { $regex, $options: "i" } })) })
        }
        for (const f in q.filter) {
          const vs = q.filter[f]!.map((v) => to(f, v))
          and.push({ [field(f)]: vs.length === 1 ? vs[0] : { $in: vs } })
        }
        const s = field(q.sort.field)
        const op = q.sort.dir === "asc" ? "$gt" : "$lt"
        if (q.after) {
          const av = to(q.sort.field, q.after.value)
          const ai = to(id, q.after.id)
          and.push(s === "_id" ? { _id: { [op]: ai } } : { $or: [{ [s]: { [op]: av } }, { [s]: av, _id: { [op]: ai } }] })
        }
        const d = q.sort.dir === "asc" ? 1 : -1
        const rows = await collection
          .find(and.length ? { $and: and } : {}, { projection })
          .sort(s === "_id" ? { _id: d } : { [s]: d, _id: d })
          .limit(q.limit + 1)
          .toArray()
        return rows.map((r) => out(r)!)
      },
      async get(v) {
        return out(await collection.findOne({ _id: to(id, v) }, { projection }))
      },
      async create(data) {
        const d = doc(data)
        const r = await collection.insertOne(d)
        return out({ ...d, _id: r.insertedId })!
      },
      async update(v, data) {
        const d = doc(data)
        delete d._id
        if (!Object.keys(d).length) return out(await collection.findOne({ _id: to(id, v) }, { projection }))
        return out(await collection.findOneAndUpdate({ _id: to(id, v) }, { $set: d }, { returnDocument: "after", projection }))
      },
      async delete(v) {
        return (await collection.deleteOne({ _id: to(id, v) })).deletedCount > 0
      },
    }
  }
}
