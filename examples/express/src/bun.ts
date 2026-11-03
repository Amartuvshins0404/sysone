import { fetchHandler } from "sysonejs"
import { api } from "./api.ts"
import { ctxFrom } from "./model.ts"

declare const Bun: { serve(options: { port: number; fetch: (request: Request) => Promise<Response> }): unknown }
declare const process: { env: { [name: string]: string | undefined } }

const port = Number(process.env.PORT ?? 3000)

Bun.serve({ port, fetch: fetchHandler(api, { context: (req) => ctxFrom((name) => req.headers.get(name)) }) })
console.log(`sysonejs example (Bun + fetchHandler) on http://localhost:${port}/api/category`)
