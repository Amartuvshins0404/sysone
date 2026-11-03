import { NOT_FOUND, type AnyApp, type AppCtx } from "./app"

export interface NodeRequest extends AsyncIterable<unknown> {
  readonly method?: string | undefined
  readonly url?: string | undefined
  readonly originalUrl?: string | undefined
  readonly body?: unknown
}

export interface NodeResponse {
  statusCode: number
  setHeader(name: string, value: string): unknown
  end(chunk?: string): unknown
}

export type NodeNext = (err?: unknown) => void

async function readJson(req: NodeRequest): Promise<unknown> {
  const decoder = new TextDecoder()
  let s = ""
  for await (const chunk of req) s += typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array, { stream: true })
  s += decoder.decode()
  try {
    return s ? JSON.parse(s) : undefined
  } catch {
    return undefined
  }
}

export function nodeHandler<A extends AnyApp, Req extends NodeRequest = NodeRequest>(
  app: A,
  options: { readonly context: (req: Req) => AppCtx<A> | Promise<AppCtx<A>> },
): (req: Req, res: NodeResponse, next?: NodeNext) => void {
  return (req, res, next) => {
    const url = req.originalUrl ?? req.url ?? "/"
    const q = url.indexOf("?")
    app
      .handle({
        method: req.method ?? "GET",
        path: q < 0 ? url : url.slice(0, q),
        query: new URLSearchParams(q < 0 ? "" : url.slice(q + 1)),
        body: () => (req.body !== undefined ? Promise.resolve(req.body) : readJson(req)),
        ctx: () => options.context(req),
      })
      .then(
        (out) => {
          if (!out && next) return next()
          const status = out?.status ?? 404
          const body = out ? out.body : NOT_FOUND
          res.statusCode = status
          if (body === undefined) return void res.end()
          res.setHeader("content-type", "application/json")
          res.end(JSON.stringify(body))
        },
        (err: unknown) => {
          if (next) return next(err)
          res.statusCode = 500
          res.end()
        },
      )
  }
}
