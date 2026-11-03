import express from "express"
import { nodeHandler } from "sysonejs/node"
import { api } from "./api.ts"
import { ctxFrom } from "./model.ts"

const PORT = Number(process.env.PORT ?? 3000)

const app = express()
app.use(express.json())
app.use(nodeHandler(api, { context: (req: express.Request) => ctxFrom((name) => req.get(name)) }))

app.listen(PORT, () => console.log(`sysonejs example (express + nodeHandler) on http://localhost:${PORT}/api/category`))
