import { NextFunction, Request, Response } from 'express';

export default function asyncHandler(handler: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch((e) => {
      console.error(e);
      next(e);
    });
  };
}
