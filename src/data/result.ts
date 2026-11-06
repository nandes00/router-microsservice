interface BaseResult<T, E> {
  success: () => this is SuccessResult<T>
  fail: () => this is FailResult<E>
  get result(): T | undefined
  get error(): E | undefined
  get value(): T | E

  unwrap: () => T
}

export class SuccessResult<T> implements BaseResult<T, unknown> {
  constructor(readonly value: T) {}

  get result() {
    return this.value;
  }

  get error() {
    return undefined;
  }

  success(): this is SuccessResult<T> {
    return true;
  }

  fail(): this is FailResult<unknown> {
    return false;
  }

  unwrap(): T {
    return this.value;
  }
}

export class FailResult<E> implements BaseResult<unknown, E> {
  constructor(readonly value: E) {}

  get result() {
    return undefined;
  }

  get error() {
    return this.value;
  }

  success(): this is SuccessResult<unknown> {
    return false;
  }

  fail(): this is FailResult<E> {
    return true;
  }

  unwrap(): never {
    throw this.value as Error;
  }
}

export type Result<T, E = Error> = SuccessResult<T> | FailResult<E>;

export function success<T>(data: T) {
  return new SuccessResult(data);
}

export function fail<E>(error: E) {
  return new FailResult(error);
}
