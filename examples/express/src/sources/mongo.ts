import { mongo } from "@sysonejs/mongo"
import { MongoClient, type Db, type Document } from "mongodb"
import type { Binding, Row, Store } from "sysonejs/source"
import type { Seed } from "../api.ts"
import { category, project, secret, task } from "../model.ts"

interface CategoryDoc {
  _id: number
  name: string
  parentId: number | null
  active: boolean
  size: bigint
  createdAt: Date
}
interface ProjectDoc {
  _id: string
  tenantId: string
  ownerId: string
  name: string
  archived: boolean
  createdAt: Date
}
interface TaskDoc {
  _id: number
  projectId: string
  title: string
}
interface SecretDoc {
  _id: number
  value: string
}

let client: MongoClient | undefined
const open = (): Db => (client ??= new MongoClient(process.env.MONGO_URL ?? "mongodb://localhost:27029/sysone")).db()

async function reset<D extends Document>(db: Db, name: string, rows: readonly Row[]) {
  const collection = db.collection<D>(name)
  await collection.deleteMany({})
  if (rows.length) await collection.insertMany(rows.map(({ id, ...r }) => ({ _id: id, ...r }) as never))
  return collection
}

export async function models(s: Seed) {
  const db = open()
  return [
    category.from(mongo(await reset<CategoryDoc>(db, "categories", s.categories.map(({ internal, ...r }) => r)))),
    project.from(mongo(await reset<ProjectDoc>(db, "projects", s.projects))),
    task.from(mongo(await reset<TaskDoc>(db, "tasks", s.tasks))),
    secret.from(mongo(await reset<SecretDoc>(db, "secrets", s.secrets))),
  ] as const
}

export async function item(binding: Binding, seed: readonly Row[]): Promise<Store> {
  return mongo(await reset(open(), "item", seed)).bind(binding)
}
