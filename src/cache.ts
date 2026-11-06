/**
 * 简单的文件缓存。
 *
 * 全市场扫描要抓几十个请求、跑 45 秒。同一天内重复跑没有意义，
 * 缓存到本地后第二次扫描是毫秒级。
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * 缓存目录优先级：环境变量 > ~/.cache/cnstock > 当前目录下的 .cnstock-cache。
 *
 * 最后一级是为受限环境准备的：某些沙箱不允许写 home 目录，
 * 此时退回到当前工作目录，保证缓存仍然可用。
 */
function resolveCacheDir(): string {
  if (process.env.CNSTOCK_CACHE_DIR) return process.env.CNSTOCK_CACHE_DIR;
  const home = join(homedir(), ".cache", "cnstock");
  try {
    mkdirSync(home, { recursive: true });
    return home;
  } catch {
    return join(process.cwd(), ".cnstock-cache");
  }
}

const CACHE_DIR = resolveCacheDir();

export function cachePath(key: string): string {
  return join(CACHE_DIR, `${key}.json`);
}

export interface CacheOptions {
  /** 缓存有效期（毫秒），默认 12 小时 */
  ttlMs?: number;
}

export function readCache<T>(key: string, opts: CacheOptions = {}): T | null {
  const { ttlMs = 12 * 60 * 60 * 1000 } = opts;
  const file = cachePath(key);
  if (!existsSync(file)) return null;
  try {
    if (Date.now() - statSync(file).mtimeMs > ttlMs) return null;
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): boolean {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath(key), JSON.stringify(value));
    return true;
  } catch {
    // 缓存失败不影响主流程，只是下次还要重新抓
    return false;
  }
}

export { CACHE_DIR };
