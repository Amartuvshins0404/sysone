import type { Row, SourceFactory } from "sysonejs/server"

export interface Delegate {
  findMany(args: any): Promise<any[]>
  findUnique(args: any): Promise<any>
  create(args: any): Promise<any>
  update(args: any): Promise<any>
  deleteMany(args: any): Promise<{ count: number }>
}

export interface PrismaOptions {
  insensitive?: boolean
}

const missing = (e: any) => e?.code === "P2025" || e?.code === "P2023"

function anyOf(f: string, vs: unknown[]) {
  const values = vs.filter((v) => v !== null)
  const parts: Row[] = values.length === 1 ? [{ [f]: values[0] }] : values.length ? [{ [f]: { in: values } }] : []
  if (values.length < vs.length) parts.push({ [f]: null })
  return parts.length === 1 ? parts[0]! : { OR: parts }
}

export function prisma(delegate: Delegate, opts: PrismaOptions = {}): SourceFactory {
  const mode = opts.insensitive === false ? {} : { mode: "insensitive" }
  return (model) => {
    const id = model.id
    const select = Object.fromEntries(model.keys.map((k) => [k, true]))
    const get = async (v: unknown): Promise<Row | null> => {
      try {
        return await delegate.findUnique({ where: { [id]: v }, select })
      } catch (e) {
        if (missing(e)) return null
        throw e
      }
    }
    return {
      exact: true,
      async list(q) {
        const AND: Row[] = []
        if (q.search) AND.push({ OR: q.search.fields.map((f) => ({ [f]: { contains: q.search!.term, ...mode } })) })
        for (const f in q.filter) AND.push(anyOf(f, q.filter[f]!))
        const s = q.sort.field
        const op = q.sort.dir === "asc" ? "gt" : "lt"
        if (q.after)
          AND.push(
            s === id
              ? { [id]: { [op]: q.after.id } }
              : { OR: [{ [s]: { [op]: q.after.value } }, { [s]: q.after.value, [id]: { [op]: q.after.id } }] },
          )
        return delegate.findMany({
          where: { AND },
          orderBy: s === id ? [{ [id]: q.sort.dir }] : [{ [s]: q.sort.dir }, { [id]: q.sort.dir }],
          take: q.limit + 1,
          select,
        })
      },
      get,
      create: (data) => delegate.create({ data, select }),
      async update(v, data) {
        try {
          return await delegate.update({ where: { [id]: v }, data, select })
        } catch (e) {
          if (missing(e)) return null
          throw e
        }
      },
      async delete(v) {
        try {
          return (await delegate.deleteMany({ where: { [id]: v } })).count > 0
        } catch (e) {
          if (missing(e)) return false
          throw e
        }
      },
    }
  }
}
