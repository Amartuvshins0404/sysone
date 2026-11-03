import { drizzle } from "@sysonejs/drizzle"
import { sql, type Table } from "drizzle-orm"
import { drizzle as mysqlDb } from "drizzle-orm/mysql2"
import * as my from "drizzle-orm/mysql-core"
import { drizzle as pgDb } from "drizzle-orm/node-postgres"
import * as pg from "drizzle-orm/pg-core"
import { createPool } from "mysql2/promise"
import type { Binding, Row, Store } from "sysonejs/source"
import type { Seed } from "../api.ts"
import { category, project, secret, task } from "../model.ts"

const pgTables = {
  categories: pg.pgTable("categories", {
    id: pg.serial().primaryKey(),
    name: pg.text().notNull(),
    parentId: pg.integer("parent_id"),
    active: pg.boolean().notNull(),
    size: pg.bigint({ mode: "bigint" }).notNull(),
    createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }),
  projects: pg.pgTable("projects", {
    id: pg.text().primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: pg.text("tenant_id").notNull(),
    ownerId: pg.text("owner_id").notNull(),
    name: pg.text().notNull(),
    archived: pg.boolean().notNull().default(false),
    createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  }),
  tasks: pg.pgTable("tasks", { id: pg.serial().primaryKey(), projectId: pg.text("project_id").notNull(), title: pg.text().notNull() }),
  secrets: pg.pgTable("secrets", { id: pg.serial().primaryKey(), value: pg.text().notNull() }),
  item: pg.pgTable("item", {
    id: pg.serial().primaryKey(),
    name: pg.text().notNull(),
    tag: pg.text(),
    n: pg.integer().notNull(),
    at: pg.timestamp({ withTimezone: true }).notNull(),
    flag: pg.boolean().notNull(),
  }),
}

const pgDdl = `
  DROP TABLE IF EXISTS categories, projects, tasks, secrets, item;
  CREATE TABLE categories (id serial primary key, name text not null, parent_id int, active boolean not null, size bigint not null, created_at timestamptz not null default now());
  CREATE TABLE projects (id text primary key, tenant_id text not null, owner_id text not null, name text not null, archived boolean not null default false, created_at timestamptz not null default now());
  CREATE TABLE tasks (id serial primary key, project_id text not null, title text not null);
  CREATE TABLE secrets (id serial primary key, value text not null);
  CREATE TABLE item (id serial primary key, name text not null, tag text, n int not null, at timestamptz not null, flag boolean not null);`

const myTables = {
  categories: my.mysqlTable("categories", {
    id: my.int().autoincrement().primaryKey(),
    name: my.varchar({ length: 80 }).notNull(),
    parentId: my.int("parent_id"),
    active: my.boolean().notNull(),
    size: my.bigint({ mode: "bigint" }).notNull(),
    createdAt: my.datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(sql`(now(3))`),
  }),
  projects: my.mysqlTable("projects", {
    id: my.varchar({ length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: my.varchar("tenant_id", { length: 36 }).notNull(),
    ownerId: my.varchar("owner_id", { length: 36 }).notNull(),
    name: my.varchar({ length: 120 }).notNull(),
    archived: my.boolean().notNull().default(false),
    createdAt: my.datetime("created_at", { mode: "date", fsp: 3 }).notNull().default(sql`(now(3))`),
  }),
  tasks: my.mysqlTable("tasks", { id: my.int().autoincrement().primaryKey(), projectId: my.varchar("project_id", { length: 36 }).notNull(), title: my.text().notNull() }),
  secrets: my.mysqlTable("secrets", { id: my.int().autoincrement().primaryKey(), value: my.text().notNull() }),
  item: my.mysqlTable("item", {
    id: my.int().autoincrement().primaryKey(),
    name: my.varchar({ length: 80 }).notNull(),
    tag: my.varchar({ length: 80 }),
    n: my.int().notNull(),
    at: my.datetime({ mode: "date", fsp: 3 }).notNull(),
    flag: my.boolean().notNull(),
  }),
}

const myDdl = [
  "DROP TABLE IF EXISTS categories, projects, tasks, secrets, item",
  "CREATE TABLE categories (id int auto_increment primary key, name varchar(80) not null, parent_id int, active boolean not null, size bigint not null, created_at datetime(3) not null default (now(3)))",
  "CREATE TABLE projects (id varchar(36) primary key, tenant_id varchar(36) not null, owner_id varchar(36) not null, name varchar(120) not null, archived boolean not null default false, created_at datetime(3) not null default (now(3)))",
  "CREATE TABLE tasks (id int auto_increment primary key, project_id varchar(36) not null, title text not null)",
  "CREATE TABLE secrets (id int auto_increment primary key, value text not null)",
  "CREATE TABLE item (id int auto_increment primary key, name varchar(80) not null, tag varchar(80), n int not null, at datetime(3) not null, flag boolean not null)",
]

const env = (name: string) => process.env[name] ?? fail(`set ${name} to run the example on this source`)
const fail = (message: string): never => {
  throw new Error(message)
}

const once = <T>(make: () => T) => {
  let value: T | undefined
  return () => (value ??= make())
}
const pgOpen = once(() => pgDb(env("PG_URL")))
const myOpen = once(() => mysqlDb(createPool({ uri: env("MYSQL_URL"), timezone: "Z", supportBigNumbers: true })))

async function pgReset(tables: readonly [Table, readonly Row[]][]) {
  const db = pgOpen()
  await db.$client.query(pgDdl)
  for (const [t, rows] of tables) if (rows.length) await db.insert(t as pg.PgTable).values(rows)
  for (const t of ["categories", "tasks", "secrets", "item"]) await db.$client.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), coalesce(max(id), 0) + 1, false) FROM ${t}`)
  return db
}

async function myReset(tables: readonly [Table, readonly Row[]][]) {
  const db = myOpen()
  for (const statement of myDdl) await db.execute(sql.raw(statement))
  for (const [t, rows] of tables) if (rows.length) await db.insert(t as my.MySqlTable).values(rows)
  return db
}

const seedRows = (s: Seed, t: typeof pgTables | typeof myTables): [Table, readonly Row[]][] => [
  [t.categories, s.categories],
  [t.projects, s.projects],
  [t.tasks, s.tasks],
  [t.secrets, s.secrets],
]

export async function pgModels(s: Seed) {
  const db = await pgReset(seedRows(s, pgTables))
  return [
    category.from(drizzle(db, pgTables.categories)),
    project.from(drizzle(db, pgTables.projects)),
    task.from(drizzle(db, pgTables.tasks)),
    secret.from(drizzle(db, pgTables.secrets)),
  ] as const
}

export async function mysqlModels(s: Seed) {
  const db = await myReset(seedRows(s, myTables))
  return [
    category.from(drizzle(db, myTables.categories)),
    project.from(drizzle(db, myTables.projects)),
    task.from(drizzle(db, myTables.tasks)),
    secret.from(drizzle(db, myTables.secrets)),
  ] as const
}

export async function pgItem(binding: Binding, seed: readonly Row[]): Promise<Store> {
  return drizzle(await pgReset([[pgTables.item, seed]]), pgTables.item).bind(binding)
}

export async function mysqlItem(binding: Binding, seed: readonly Row[]): Promise<Store> {
  return drizzle(await myReset([[myTables.item, seed]]), myTables.item).bind(binding)
}
