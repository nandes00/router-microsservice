import { Request, Response } from 'express';
import { ParamsDictionary } from 'express-serve-static-core';
import { ZodType } from 'zod';

export default function withSchema<B, P = ParamsDictionary>(schema: ZodType<B>, handler: (req: Request<P, any, B>, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    const parsingResult = schema.safeParse(req.body);
    if (!parsingResult.success) {
      res.status(400);
      res.json(parsingResult.error.issues);
      return;
    }

    req.body = parsingResult.data;
    await handler(req as Request<P, any, B>, res);
  };
}
