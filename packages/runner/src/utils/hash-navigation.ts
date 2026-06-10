import type { Page } from "playwright";

export interface SplitHashUrlResult {
  pageUrl: string;
  hash: string;
}

export function splitHashUrl(urlValue: string): SplitHashUrlResult {
  const trimmed = String(urlValue || "").trim();
  const lastHashIndex = trimmed.lastIndexOf("#");
  if (lastHashIndex < 0) {
    const url = new URL(trimmed);
    return {
      pageUrl: `${url.origin}${url.pathname}${url.search}`,
      hash: ""
    };
  }

  const pagePart = trimmed.slice(0, lastHashIndex);
  const hash = trimmed.slice(lastHashIndex);
  const firstHashIndex = pagePart.indexOf("#");
  const cleanPageUrl = firstHashIndex >= 0 ? pagePart.slice(0, firstHashIndex) : pagePart;

  return {
    pageUrl: cleanPageUrl,
    hash
  };
}

export function normalizeHashRoute(hash: string): string {
  const trimmed = String(hash || "").trim();
  if (!trimmed) {
    return "";
  }
  const withoutHash = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  const routePath = (withoutHash.split("?")[0] || "/").trim();
  const normalizedPath = routePath.startsWith("/") ? routePath : `/${routePath}`;
  return `#${normalizedPath}${withoutHash.includes("?") ? `?${withoutHash.split("?").slice(1).join("?")}` : ""}`;
}

export function normalizeHashPath(hash: string): string {
  const trimmed = String(hash || "").trim().replace(/^#/, "");
  const path = (trimmed.split("?")[0] || "/").trim();
  return path.startsWith("/") ? path : `/${path}`;
}

export function hashRouteMatches(currentHash: string, expectedHash: string): boolean {
  return normalizeHashPath(currentHash) === normalizeHashPath(expectedHash);
}

function sameAppOrigin(currentUrl: string, pageUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const target = new URL(pageUrl);
    return current.origin === target.origin && current.pathname === target.pathname;
  } catch {
    return false;
  }
}

function isLikelyLoggedInSpaUrl(url: string): boolean {
  const { hash } = splitHashUrl(url);
  const path = normalizeHashPath(hash);
  return path !== "/login" && path !== "/register" && path !== "/404" && path !== "/";
}

export async function waitForHashRoute(page: Page, expectedHash: string, timeoutMs: number): Promise<void> {
  const normalizedHash = normalizeHashRoute(expectedHash);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const { hash } = splitHashUrl(page.url());
    if (hashRouteMatches(hash, normalizedHash)) {
      return;
    }
    await page.waitForTimeout(200);
  }

  throw new Error(`等待 hash 路由超时：期望 ${normalizedHash}，当前 ${page.url()}`);
}

async function waitForSpaReady(page: Page, timeoutMs: number): Promise<void> {
  const budget = Math.min(timeoutMs, 15_000);
  await page.waitForSelector("#app", { state: "attached", timeout: budget }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: Math.min(budget, 8_000) }).catch(() => undefined);
  await page.waitForTimeout(300);
}

async function applyHashRoute(page: Page, normalizedHash: string): Promise<void> {
  await page.evaluate(`(targetHash) => {
    const targetPath = String(targetHash || "").replace(/^#/, "") || "/";
    const router =
      window.__VUE_ROUTER__ ||
      (window.app && window.app.config && window.app.config.globalProperties && window.app.config.globalProperties.$router);
    if (router && typeof router.push === "function") {
      router.push(targetPath).catch(() => {
        window.location.replace(window.location.pathname + window.location.search + targetHash);
      });
      return;
    }
    if (window.location.hash !== targetHash) {
      window.location.replace(window.location.pathname + window.location.search + targetHash);
    }
  }`, normalizedHash);
}

export function buildHashNavigationUrl(pageUrl: string, normalizedHash: string): string {
  return `${pageUrl}${normalizedHash}`;
}

export async function navigatePage(page: Page, urlValue: string, timeoutMs: number): Promise<void> {
  const { pageUrl, hash } = splitHashUrl(urlValue);
  if (!hash) {
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    return;
  }

  const normalizedHash = normalizeHashRoute(hash);
  const fullUrl = buildHashNavigationUrl(pageUrl, normalizedHash);
  const currentUrl = page.url();

  // 已登录 SPA 内跳转：优先 router.push，避免冷启动时动态路由未注册落到 404
  if (sameAppOrigin(currentUrl, pageUrl) && isLikelyLoggedInSpaUrl(currentUrl)) {
    await waitForSpaReady(page, Math.min(timeoutMs, 10_000));
    await applyHashRoute(page, normalizedHash);
    try {
      await waitForHashRoute(page, normalizedHash, Math.min(timeoutMs, 15_000));
      if (!normalizeHashPath(splitHashUrl(page.url()).hash).includes("404")) {
        return;
      }
    } catch {
      // fall through to cold navigation
    }
  }

  // Hash 模式 SPA 若先打开无 hash 的入口，常会先落到 /login，再改 hash 容易被守卫打回。
  // 首次导航必须带上 hash，让应用在启动时直接进入目标路由。
  await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForSpaReady(page, timeoutMs);

  const perAttemptTimeout = Math.max(5_000, Math.min(timeoutMs, 15_000));
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / perAttemptTimeout));
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { hash: currentHash } = splitHashUrl(page.url());
    if (!hashRouteMatches(currentHash, normalizedHash)) {
      await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: perAttemptTimeout }).catch(() => undefined);
      await applyHashRoute(page, normalizedHash);
    }

    try {
      await waitForHashRoute(page, normalizedHash, perAttemptTimeout);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await waitForSpaReady(page, 2_000);
    }
  }

  throw lastError ?? new Error(`无法导航到 ${normalizedHash}，当前 ${page.url()}`);
}
