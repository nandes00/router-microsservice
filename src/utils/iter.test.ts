import { describe, expect, it } from '@jest/globals';
import { mapIterator } from './iter';

describe('#mapIterator', () => {
  it('returns a new iterator that returns transformed elements', () => {
    const iterable = [1, 2, 3, 4, 5];

    const mappedIter = mapIterator(iterable, (x) => 2 * x);

    expect([...mappedIter]).toEqual([2, 4, 6, 8, 10]);
  });
});
