import type { NextFunction, Request, Response } from "express"
import { createHandler, type Endpoint } from "sysonejs/server"

export interface Options<C> {
  context?: (req: Request) => C | Promise<C>
}

async function readJson(req: Request): Promise<unknown> {
  let s = ""
  for await (const c of req) s += c
  try {
    return s ? JSON.parse(s) : undefined
  } catch {
    return undefined
  }
}

export function sysone<C = unknown>(endpoints: Endpoint[], opts: Options<C> = {}) {
  const handle = createHandler(endpoints)
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const url = req.url
      const i = url.indexOf("?")
      const r = await handle({
        method: req.method,
        path: i < 0 ? url : url.slice(0, i),
        query: new URLSearchParams(i < 0 ? "" : url.slice(i + 1)),
        body: () => (req.body !== undefined ? req.body : readJson(req)),
        ctx: () => opts.context?.(req),
      })
      if (!r) return next()
      res.status(r.status)
      r.body === undefined ? res.end() : res.json(r.body)
    } catch (err) {
      next(err)
    }
  }
}
