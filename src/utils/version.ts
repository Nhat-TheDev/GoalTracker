import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Reads the version straight from package.json instead of a hardcoded
 * literal, so the MCP server's self-reported version can never drift from
 * the actual release again. Resolves relative to this module so it works
 * both under tsx (src/utils/version.ts) and after tsc (dist/utils/version.js) —
 * both sit two directories below the package root.
 */
export function getPackageVersion(): string {
  const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version: string };
  return pkg.version;
}
