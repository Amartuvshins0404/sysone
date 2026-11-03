import { PrismaPg } from "@prisma/adapter-pg"
import { prisma } from "@sysonejs/prisma"
import type { Binding, Row, Store } from "sysonejs/source"
import type { Seed } from "../api.ts"
import { PrismaClient } from "../generated/prisma/client.ts"
import { category, project, secret, task } from "../model.ts"

let client: PrismaClient | undefined

function open() {
  const url = process.env.PG_URL
  if (!url) throw new Error("set PG_URL and run `prisma db push` to run the example on Prisma")
  return (client ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }))
}

async function restartIds(db: PrismaClient, tables: readonly string[]) {
  for (const t of tables) await db.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), coalesce(max(id), 0) + 1, false) FROM ${t}`)
}

export async function models(s: Seed) {
  const db = open()
  await db.$executeRawUnsafe("TRUNCATE categories, projects, tasks, secrets")
  await db.category.createMany({ data: s.categories.map(({ internal, ...r }) => r) })
  await db.project.createMany({ data: s.projects })
  await db.task.createMany({ data: s.tasks })
  await db.secret.createMany({ data: s.secrets })
  await restartIds(db, ["categories", "tasks", "secrets"])
  return [category.from(prisma(db.category)), project.from(prisma(db.project)), task.from(prisma(db.task)), secret.from(prisma(db.secret))] as const
}

export async function item(binding: Binding, seed: readonly Row[]): Promise<Store> {
  const db = open()
  await db.$executeRawUnsafe("TRUNCATE item")
  await db.item.createMany({ data: seed as never })
  await restartIds(db, ["item"])
  return prisma(db.item).bind(binding)
}
