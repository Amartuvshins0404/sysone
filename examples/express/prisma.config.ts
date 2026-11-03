import { defineConfig } from "prisma/config"

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.PG_URL ?? "postgres://postgres:dev@localhost:54329/sysone" },
})
