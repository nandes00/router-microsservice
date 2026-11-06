import { describe, expect, it } from '@jest/globals';
import { expectDefined } from './expect';

describe('#expectDefined', () => {
  it('returns value when its given a defined value', () => {
    const value = 'hello';
    expect(expectDefined(value, 'This should not throw')).toBe(value);
  });

  it('throws with the given message when its given undefined', () => {
    const message = 'hello';
    expect(() => expectDefined(undefined, message)).toThrowError(
      new Error(message),
    );
  });
});
