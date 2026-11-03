import { defineModel } from "sysonejs"
import { z } from "zod"

const fields = {
  name: z.string().min(1),
  active: z.boolean(),
  createdAt: z.date(),
}

const input = z.object({
  name: z.string().min(1),
  parentId: z.number().int().nullable().optional(),
  active: z.boolean().optional(),
})

export const category = defineModel({
  name: "category",
  schema: z.object({ id: z.number().int(), parentId: z.number().int().nullable(), ...fields }),
  search: ["name"],
  filter: ["parentId", "active"],
  sort: ["name", "createdAt"],
  defaultSort: "name",
  create: input,
})

export const categoryDoc = defineModel({
  name: "category",
  schema: z.object({ id: z.string(), parentId: z.string().nullable(), ...fields }),
  search: ["name"],
  filter: ["parentId", "active"],
  sort: ["name", "createdAt"],
  defaultSort: "name",
  create: input.extend({ parentId: z.string().nullable().optional() }),
})
