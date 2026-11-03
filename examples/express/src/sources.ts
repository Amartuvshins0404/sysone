import { PrismaPg } from "@prisma/adapter-pg"
import { drizzle as drizzleSource } from "@sysonejs/drizzle"
import { mongo } from "@sysonejs/mongo"
import { mysql } from "@sysonejs/mysql"
import { pg } from "@sysonejs/pg"
import { prisma } from "@sysonejs/prisma"
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2"
import { boolean as myBoolean, int, mysqlTable, timestamp as myTimestamp, varchar } from "drizzle-orm/mysql-core"
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres"
import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core"
import { MongoClient } from "mongodb"
import { createPool } from "mysql2/promise"
import pgLib from "pg"
import { memory, type SourceFactory } from "sysonejs/server"
import { PrismaClient } from "./generated/prisma/client.ts"
import { category, categoryDoc } from "./model.ts"

const PG_URL = process.env.PG_URL ?? "postgres://postgres:dev@localhost:54329/sysone"
const MYSQL_URL = process.env.MYSQL_URL ?? "mysql://root:dev@localhost:33069/sysone"
const MONGO_URL = process.env.MONGO_URL ?? "mongodb://localhost:27029"

const pgCategories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
})

const myCategories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  parentId: int("parent_id"),
  active: myBoolean("active").notNull().default(true),
  createdAt: myTimestamp("created_at").notNull().defaultNow(),
})

const columns = { parentId: "parent_id", createdAt: "created_at" }

const seed = Array.from({ length: 45 }, (_, i) => ({
  name: `Category ${String(i + 1).padStart(2, "0")}${i % 7 === 0 ? " 100%_off" : ""}`,
  parentId: i < 5 ? null : (i % 5) + 1,
  active: i % 3 !== 0,
  createdAt: new Date(Date.UTC(2026, 0, 1 + (i % 10))),
}))

async function pgPool() {
  const pool = new pgLib.Pool({ connectionString: PG_URL })
  await pool.query(`DROP TABLE IF EXISTS categories`)
  await pool.query(
    `CREATE TABLE categories (id serial primary key, name text not null, parent_id int, active boolean not null default true, created_at timestamp not null default now())`,
  )
  for (const r of seed)
    await pool.query(`INSERT INTO categories (name, parent_id, active, created_at) VALUES ($1, $2, $3, $4)`, [r.name, r.parentId, r.active, r.createdAt])
  return pool
}

async function mysqlPool() {
  const pool = createPool({ uri: MYSQL_URL, timezone: "Z" })
  await pool.query(`DROP TABLE IF EXISTS categories`)
  await pool.query(
    `CREATE TABLE categories (id int auto_increment primary key, name varchar(255) not null, parent_id int null, active boolean not null default true, created_at timestamp not null default current_timestamp)`,
  )
  for (const r of seed)
    await pool.query(`INSERT INTO categories (name, parent_id, active, created_at) VALUES (?, ?, ?, ?)`, [r.name, r.parentId, r.active, r.createdAt])
  return pool
}

async function mongoCollection() {
  const client = await new MongoClient(MONGO_URL).connect()
  const col = client.db("sysone").collection("categories")
  await col.deleteMany({})
  const { insertedIds } = await col.insertMany(seed.slice(0, 5).map((r) => ({ ...r })))
  const parents = Object.values(insertedIds)
  await col.insertMany(seed.slice(5).map((r) => ({ ...r, parentId: parents[(r.parentId ?? 1) - 1] })))
  return col
}

export async function source(name: string): Promise<{ model: typeof category | typeof categoryDoc; source: SourceFactory }> {
  if (name === "memory") return { model: category, source: memory(seed.map((r, i) => ({ id: i + 1, ...r }))) }
  if (name === "pg") return { model: category, source: pg(await pgPool(), "categories", { columns }) }
  if (name === "drizzle-pg") return { model: category, source: drizzleSource(drizzlePg(await pgPool()), pgCategories) }
  if (name === "prisma") {
    await pgPool()
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: PG_URL }) })
    return { model: category, source: prisma(client.category) }
  }
  if (name === "mysql") return { model: category, source: mysql(await mysqlPool(), "categories", { columns }) }
  if (name === "drizzle-mysql") return { model: category, source: drizzleSource(drizzleMysql(await mysqlPool()), myCategories) }
  if (name === "mongo") return { model: categoryDoc, source: mongo(await mongoCollection(), { objectIds: ["id", "parentId"] }) }
  throw new Error(`Unknown SOURCE "${name}"`)
}
