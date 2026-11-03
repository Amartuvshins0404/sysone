import { escapeLike, expandAfter, type Binding, type Cond, type Store, type Row, type Source } from "sysonejs/source"

export interface Delegate<R> {
  findMany(args: object): Promise<R[]>
  findFirst(args: object): Promise<R | null>
  create(args: object): Promise<R>
  updateMany(args: object): Promise<{ count: number }>
  deleteMany(args: object): Promise<{ count: number }>
}

export interface PrismaOptions {
  readonly provider?: "postgresql" | "mysql"
}

type Where = { readonly [key: string]: unknown }

export function prisma<R extends object>(delegate: Delegate<R>, options: PrismaOptions = {}): Source<R> {
  const insensitive = (options.provider ?? "postgresql") === "postgresql"
  return { name: "prisma", bind: (binding) => prismaStore(delegate as unknown as Delegate<Row>, binding, insensitive) }
}

function prismaStore(delegate: Delegate<Row>, binding: Binding, insensitive: boolean): Store {
  const selectOf = (fields: readonly string[]) => Object.fromEntries(fields.map((f) => [f, true]))
  const every = selectOf(binding.fields.map((f) => f.name))
  const first = (where: Where) => delegate.findFirst({ where, select: every })
  return {
    find: (plan) =>
      delegate.findMany({
        where: plan.where ? toWhere(plan.where, insensitive) : undefined,
        orderBy: plan.sort.map((k) => ({ [k.field]: k.dir })),
        take: plan.take,
        select: plan.select.length === binding.fields.length ? every : selectOf(plan.select),
      }),
    insert: (row) => delegate.create({ data: row, select: every }),
    async update(cond, patch) {
      const where = toWhere(cond, insensitive)
      if (Object.keys(patch).length) await delegate.updateMany({ where, data: patch })
      return first(where)
    },
    async remove(cond) {
      return (await delegate.deleteMany({ where: toWhere(cond, insensitive) })).count > 0
    },
  }
}

function toWhere(cond: Cond, insensitive: boolean): Where {
  switch (cond.op) {
    case "and":
      return { AND: cond.of.map((c) => toWhere(c, insensitive)) }
    case "or":
      return { OR: cond.of.map((c) => toWhere(c, insensitive)) }
    case "eq":
      return { [cond.field]: { equals: cond.value } }
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return { [cond.field]: { [cond.op]: cond.value } }
    case "in":
      return { [cond.field]: { in: cond.values } }
    case "null":
      return { [cond.field]: null }
    case "contains": {
      const match = insensitive ? { contains: escapeLike(cond.term), mode: "insensitive" } : { contains: escapeLike(cond.term) }
      return { OR: cond.fields.map((f) => ({ [f]: match })) }
    }
    case "after":
      return toWhere(expandAfter(cond), insensitive)
    default:
      return cond satisfies never
  }
}
