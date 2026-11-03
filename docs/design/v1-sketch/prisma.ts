import type { Cond, Source } from "./source"

export interface Delegate<R> {
  findMany(args: object): Promise<R[]>
  findFirst(args: object): Promise<R | null>
  create(args: object): Promise<R>
  updateMany(args: object): Promise<{ count: number }>
  deleteMany(args: object): Promise<{ count: number }>
}

export interface PrismaOptions {
  readonly provider?: "postgresql" | "mysql" | "mongodb" | "sqlite" | "sqlserver" | "cockroachdb"
}

export function prisma<R extends object>(delegate: Delegate<R>, options?: PrismaOptions): Source<R> {
  throw new Error("not implemented")
}

function toWhere(cond: Cond, insensitive: boolean): object {
  throw new Error("not implemented")
}
