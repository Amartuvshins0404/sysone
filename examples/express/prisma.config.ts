import { defineConfig } from "prisma/config"

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: process.env.PG_URL },
})
