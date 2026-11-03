import { and, asc, desc, eq, getTableColumns, gt, ilike, inArray, is, isNull, like, lt, or, type Column, type SQL, type Table } from "drizzle-orm"
import { MySqlTable } from "drizzle-orm/mysql-core"
import { PgTable } from "drizzle-orm/pg-core"
import type { Row, SourceFactory } from "sysonejs/server"

const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&")

function anyOf(c: Column, vs: unknown[]): SQL {
  const values = vs.filter((v) => v !== null)
  const parts = values.length === 1 ? [eq(c, values[0])] : values.length ? [inArray(c, values)] : []
  if (values.length < vs.length) parts.push(isNull(c))
  return parts.length === 1 ? parts[0]! : or(...parts)!
}

export function drizzle(db: any, table: Table): SourceFactory {
  return (model) => {
    const cols = getTableColumns(table) as Record<string, Column>
    const col = (f: string) => {
      const c = cols[f]
      if (!c) throw new Error(`@sysonejs/drizzle: column "${f}" not found for model "${model.name}"`)
      return c
    }
    const idc = col(model.id)
    const fields = Object.fromEntries(model.keys.map((k) => [k, col(k)]))
    const mysql = is(table, MySqlTable)
    const match = is(table, PgTable) ? ilike : like

    const get = async (id: unknown): Promise<Row | null> => {
      const [r] = await db.select(fields).from(table).where(eq(idc, id)).limit(1)
      return r ?? null
    }

    return {
      exact: true,
      async list(q) {
        const w: (SQL | undefined)[] = []
        if (q.search) {
          const p = `%${escapeLike(q.search.term)}%`
          w.push(or(...q.search.fields.map((f) => match(col(f), p))))
        }
        for (const f in q.filter) w.push(anyOf(col(f), q.filter[f]!))
        const s = col(q.sort.field)
        if (q.after) {
          const cmp = q.sort.dir === "asc" ? gt : lt
          w.push(s === idc ? cmp(idc, q.after.id) : or(cmp(s, q.after.value), and(eq(s, q.after.value), cmp(idc, q.after.id))))
        }
        const dir = q.sort.dir === "asc" ? asc : desc
        return db
          .select(fields)
          .from(table)
          .where(and(...w))
          .orderBy(...(s === idc ? [dir(idc)] : [dir(s), dir(idc)]))
          .limit(q.limit + 1)
      },
      get,
      async create(data) {
        if (!mysql) return (await db.insert(table).values(data).returning(fields))[0]
        const [r] = await db.insert(table).values(data).$returningId()
        return (await get(r?.[model.id] ?? data[model.id]))!
      },
      async update(id, data) {
        if (!Object.keys(data).length) return get(id)
        if (!mysql) return (await db.update(table).set(data).where(eq(idc, id)).returning(fields))[0] ?? null
        await db.update(table).set(data).where(eq(idc, id))
        return get(id)
      },
      async delete(id) {
        if (!mysql) return (await db.delete(table).where(eq(idc, id)).returning({ id: idc })).length > 0
        const r = await db.delete(table).where(eq(idc, id))
        return (r[0]?.affectedRows ?? r.rowsAffected ?? 0) > 0
      },
    }
  }
}
