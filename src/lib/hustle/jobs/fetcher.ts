/**
 * 公開ページの取得（手順書の fetch_page と、ai_lookup の出典確認で使う）。
 *
 * 守ること:
 * - robots.txt を読む。4xx（無い）は慣習どおり許可、5xx・通信失敗は「分からないので叩かない」
 * - 身元を名乗る User-Agent。偽装しない
 * - 同じサイトには間隔を空ける（最低1秒、Crawl-delay があればそれに従う）
 * - 社内・ローカルのアドレスには行かない。URLはAIが書くことがあるので、
 *   ここで塞がないとサーバーの内側を覗く踏み台になる
 * - サイズと時間に上限を掛ける
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { parseRobots, isAllowed, type Robots } from "../agent/robots";
import { stripHtml } from "../dataops/extract";

export const FETCH_UA = "hustle-pipeline/1.0 (personal side-job assistant; contact via app owner)";
const MAX_BYTES = 2_000_000;
const MAX_TEXT = 20_000;
const TIMEOUT_MS = 15_000;
const MIN_INTERVAL_MS = 1_000;

export interface PageResult {
  ok: boolean;
  url: string;
  text: string;
  reason: string;
}

export type PageFetcher = (url: string) => Promise<PageResult>;

/** 社内・ローカル・予約済みのアドレスか。 */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::1" || x === "::") return true;
    if (x.startsWith("::ffff:")) return isPrivateAddress(x.slice(7));
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x);
  }
  return true;
}

export interface FetcherDeps {
  fetchImpl?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function createPageFetcher(deps: FetcherDeps = {}): PageFetcher {
  const doFetch = deps.fetchImpl ?? fetch;
  const resolve = deps.resolve ?? (async (host: string) => (await dnsLookup(host, { all: true })).map((r) => r.address));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => Date.now());
  const robotsCache = new Map<string, Robots | null>();
  const lastHit = new Map<string, number>();
  const pageCache = new Map<string, PageResult>();

  async function safeTarget(raw: string): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      return { ok: false, reason: "URLとして読めません" };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "http/https 以外のURLです" };
    if (url.username || url.password) return { ok: false, reason: "認証情報入りのURLは扱いません" };
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return { ok: false, reason: "ローカルのアドレスには行きません" };
    const addrs = isIP(host) ? [host] : await resolve(host).catch(() => [] as string[]);
    if (addrs.length === 0) return { ok: false, reason: "ホスト名を引けません" };
    if (addrs.some(isPrivateAddress)) return { ok: false, reason: "社内・ローカルのアドレスには行きません" };
    return { ok: true, url };
  }

  async function politeWait(origin: string, delaySec: number | null) {
    const interval = Math.max(MIN_INTERVAL_MS, (delaySec ?? 0) * 1000);
    const last = lastHit.get(origin);
    if (last !== undefined) {
      const wait = last + interval - now();
      if (wait > 0) await sleep(wait);
    }
    lastHit.set(origin, now());
  }

  async function get(url: URL, accept: string): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await doFetch(url.toString(), {
        headers: { "User-Agent": FETCH_UA, Accept: accept },
        redirect: "manual",
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function robotsFor(url: URL): Promise<Robots | null> {
    const origin = url.origin;
    if (robotsCache.has(origin)) return robotsCache.get(origin) ?? null;
    let robots: Robots | null = null;
    try {
      await politeWait(origin, null);
      const res = await get(new URL("/robots.txt", origin), "text/plain, */*;q=0.8");
      if (res.status >= 200 && res.status < 300) robots = parseRobots(await res.text());
      else if (res.status >= 400 && res.status < 500) robots = parseRobots(""); // 無い = 制限なし（RFC 9309）
    } catch {
      robots = null;
    }
    robotsCache.set(origin, robots);
    return robots;
  }

  return async function fetchPage(raw: string): Promise<PageResult> {
    const cached = pageCache.get(raw);
    if (cached) return cached;
    let current = raw;
    for (let hop = 0; hop < 4; hop++) {
      const target = await safeTarget(current);
      if (!target.ok) return { ok: false, url: current, text: "", reason: target.reason };
      const url = target.url;
      const robots = await robotsFor(url);
      const verdict = isAllowed(robots, url.pathname + url.search, FETCH_UA);
      if (!verdict.allowed) return { ok: false, url: current, text: "", reason: `robots.txt により取得しません（${verdict.rule}）` };
      await politeWait(url.origin, verdict.crawlDelaySec);
      let res: Response;
      try {
        res = await get(url, "text/html, text/plain;q=0.9, */*;q=0.1");
      } catch (e) {
        return { ok: false, url: current, text: "", reason: `取得に失敗しました（${e instanceof Error ? e.name : "通信エラー"}）` };
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, url: current, text: "", reason: "転送先がありません" };
        current = new URL(loc, url).toString();
        continue;
      }
      if (!res.ok) return { ok: false, url: current, text: "", reason: `HTTP ${res.status}` };
      const type = res.headers.get("content-type") ?? "";
      if (type && !/text\/|html|xml/i.test(type)) return { ok: false, url: current, text: "", reason: `文章ではないファイルです（${type.slice(0, 40)}）` };
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_BYTES) return { ok: false, url: current, text: "", reason: "ページが大きすぎます" };
      const body = (await res.text()).slice(0, MAX_BYTES);
      const text = (/<[a-z!/]/i.test(body) ? stripHtml(body) : body).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
      const result = { ok: true, url: current, text, reason: "" };
      pageCache.set(raw, result);
      return result;
    }
    return { ok: false, url: current, text: "", reason: "転送が多すぎます" };
  };
}
