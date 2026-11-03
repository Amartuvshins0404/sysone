import type { Row, SourceFactory } from "sysonejs/server"

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>
}

export interface PgOptions {
  columns?: Record<string, string>
}

const ident = (s: string) => s.split(".").map((p) => `"${p.replace(/"/g, '""')}"`).join(".")
const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&")

export function pg(db: Queryable, table: string, opts: PgOptions = {}): SourceFactory {
  return (model) => {
    const t = ident(table)
    const c = (k: string) => ident(opts.columns?.[k] ?? k)
    const select = model.keys.map((k) => `${c(k)} AS ${ident(k)}`).join(", ")
    const idc = c(model.id)

    const get = async (id: unknown): Promise<Row | null> =>
      (await db.query(`SELECT ${select} FROM ${t} WHERE ${idc} = $1 LIMIT 1`, [id])).rows[0] ?? null

    return {
      exact: true,
      async list(q) {
        const v: unknown[] = []
        const p = (x: unknown) => `$${v.push(x)}`
        const w: string[] = []
        if (q.search) {
          const term = p(`%${escapeLike(q.search.term)}%`)
          w.push(`(${q.search.fields.map((f) => `${c(f)} ILIKE ${term}`).join(" OR ")})`)
        }
        for (const f in q.filter) {
          const vs = q.filter[f]!
          const values = vs.filter((x) => x !== null)
          const parts = values.length ? [`${c(f)} = ANY(${p(values)})`] : []
          if (values.length < vs.length) parts.push(`${c(f)} IS NULL`)
          w.push(`(${parts.join(" OR ")})`)
        }
        const s = c(q.sort.field)
        const dir = q.sort.dir === "asc" ? "ASC" : "DESC"
        if (q.after) {
          const op = q.sort.dir === "asc" ? ">" : "<"
          w.push(s === idc ? `${idc} ${op} ${p(q.after.id)}` : `(${s}, ${idc}) ${op} (${p(q.after.value)}, ${p(q.after.id)})`)
        }
        const order = s === idc ? `${idc} ${dir}` : `${s} ${dir}, ${idc} ${dir}`
        const where = w.length ? ` WHERE ${w.join(" AND ")}` : ""
        return (await db.query(`SELECT ${select} FROM ${t}${where} ORDER BY ${order} LIMIT ${p(q.limit + 1)}`, v)).rows
      },
      get,
      async create(data) {
        const ks = Object.keys(data)
        const sql = ks.length
          ? `INSERT INTO ${t} (${ks.map(c).join(", ")}) VALUES (${ks.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING ${select}`
          : `INSERT INTO ${t} DEFAULT VALUES RETURNING ${select}`
        return (await db.query(sql, ks.map((k) => data[k]))).rows[0]
      },
      async update(id, data) {
        const ks = Object.keys(data)
        if (!ks.length) return get(id)
        const set = ks.map((k, i) => `${c(k)} = $${i + 1}`).join(", ")
        const sql = `UPDATE ${t} SET ${set} WHERE ${idc} = $${ks.length + 1} RETURNING ${select}`
        return (await db.query(sql, [...ks.map((k) => data[k]), id])).rows[0] ?? null
      },
      async delete(id) {
        return ((await db.query(`DELETE FROM ${t} WHERE ${idc} = $1`, [id])).rowCount ?? 0) > 0
      },
    }
  }
}
