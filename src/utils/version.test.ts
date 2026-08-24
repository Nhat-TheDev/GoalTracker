import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { getPackageVersion } from './version.js';

describe('getPackageVersion', () => {
  it('reads the real package.json version, not a hardcoded value', () => {
    const expected = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '..', '..', 'package.json'), 'utf-8')
    ).version;
    expect(getPackageVersion()).toBe(expected);
    expect(getPackageVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
