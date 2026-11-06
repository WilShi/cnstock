/**
 * Package version, read at runtime from package.json.
 *
 * Bundled output lives one directory below the package root (dist/*.js), so the
 * relative path resolves correctly both when running from src/ and from dist/.
 */

import { createRequire } from "node:module";

export const VERSION: string = (() => {
  try {
    return createRequire(import.meta.url)("../package.json").version as string;
  } catch {
    return "0.0.0";
  }
})();
