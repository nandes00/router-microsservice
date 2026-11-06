export function * mapIterator<TInput, TOutput>(
  iter: Iterable<TInput>,
  fn: (x: TInput) => TOutput,
): Generator<TOutput> {
  for (const x of iter) {
    yield fn(x);
  }
}
