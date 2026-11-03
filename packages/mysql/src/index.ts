import { kind } from "sysonejs"
import type { Row, SourceFactory } from "sysonejs/server"
import type { z } from "zod"

export interface Queryable {
  query(sql: string, values?: unknown[]): Promise<[any, any]>
}

export interface MysqlOptions {
  columns?: Record<string, string>
}

const ident = (s: string) => s.split(".").map((p) => "`" + p.replace(/`/g, "``") + "`").join(".")
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&")

export function mysql(db: Queryable, table: string, opts: MysqlOptions = {}): SourceFactory {
  return (model) => {
    const t = ident(table)
    const c = (k: string) => ident(opts.columns?.[k] ?? k)
    const select = model.keys.map((k) => `${c(k)} AS ${ident(k)}`).join(", ")
    const idc = c(model.id)
    const bools = model.keys.filter((k) => kind(model.schema.shape[k] as z.ZodType) === "boolean")
    const fix = (r: Row) => {
      for (const k of bools) if (typeof r[k] === "number") r[k] = r[k] !== 0
      return r
    }

    const get = async (id: unknown): Promise<Row | null> => {
      const [rows] = await db.query(`SELECT ${select} FROM ${t} WHERE ${idc} = ? LIMIT 1`, [id])
      return rows[0] ? fix(rows[0]) : null
    }

    return {
      exact: true,
      async list(q) {
        const v: unknown[] = []
        const w: string[] = []
        if (q.search) {
          const term = `%${escapeLike(q.search.term)}%`
          w.push(`(${q.search.fields.map((f) => (v.push(term), `${c(f)} LIKE ?`)).join(" OR ")})`)
        }
        for (const f in q.filter) {
          const vs = q.filter[f]!
          const values = vs.filter((x) => x !== null)
          const parts = values.length ? [`${c(f)} IN (${values.map(() => "?").join(", ")})`] : []
          v.push(...values)
          if (values.length < vs.length) parts.push(`${c(f)} IS NULL`)
          w.push(`(${parts.join(" OR ")})`)
        }
        const s = c(q.sort.field)
        const dir = q.sort.dir === "asc" ? "ASC" : "DESC"
        if (q.after) {
          const op = q.sort.dir === "asc" ? ">" : "<"
          if (s === idc) {
            w.push(`${idc} ${op} ?`)
            v.push(q.after.id)
          } else {
            w.push(`(${s} ${op} ? OR (${s} = ? AND ${idc} ${op} ?))`)
            v.push(q.after.value, q.after.value, q.after.id)
          }
        }
        const order = s === idc ? `${idc} ${dir}` : `${s} ${dir}, ${idc} ${dir}`
        const where = w.length ? ` WHERE ${w.join(" AND ")}` : ""
        v.push(q.limit + 1)
        const [rows] = await db.query(`SELECT ${select} FROM ${t}${where} ORDER BY ${order} LIMIT ?`, v)
        return rows.map(fix)
      },
      get,
      async create(data) {
        const ks = Object.keys(data)
        const sql = ks.length
          ? `INSERT INTO ${t} (${ks.map(c).join(", ")}) VALUES (${ks.map(() => "?").join(", ")})`
          : `INSERT INTO ${t} () VALUES ()`
        const [r] = await db.query(sql, ks.map((k) => data[k]))
        return (await get(data[model.id] ?? r.insertId))!
      },
      async update(id, data) {
        const ks = Object.keys(data)
        if (ks.length) await db.query(`UPDATE ${t} SET ${ks.map((k) => `${c(k)} = ?`).join(", ")} WHERE ${idc} = ?`, [...ks.map((k) => data[k]), id])
        return get(id)
      },
      async delete(id) {
        const [r] = await db.query(`DELETE FROM ${t} WHERE ${idc} = ?`, [id])
        return r.affectedRows > 0
      },
    }
  }
}
