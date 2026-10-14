/**
 * 华住会每日签到（Quantumult X）
 * Copyright (C) 2026 Dimlitter
 * Copyright (C) 2026 d539834401 — Quantumult X adaptation
 * SPDX-License-Identifier: GPL-3.0-only
 * License: licenses/huazhu-GPL-3.0.txt
 * Adapted from Dimlitter/huazhu-auto-checkin/checkin.py at c4a4497:
 * https://github.com/Dimlitter/huazhu-auto-checkin/tree/c4a4497cbb52274cf1b2251f30342e447c48e08d
 * Version: 20261011.1
 *
 * 合并 huazhu_signin.conf，开启重写和 MitM，打开华住会 App/微信小程序签到页。
 * 从 Cookie 保存 userToken；收到通知后关闭抓取规则，手动运行任务验证。
 * 单账号：huazhu_signin_token；可选多账号：huazhu_signin_tokens，以 & 或换行分隔。
 * 登录凭据只保存在本机 $prefs。多账号列表优先，抓取不会覆盖该列表。
 * 签到前后查询状态；429/5xx/网络异常最多短重试一次，长 Retry-After 留待下次运行。
 * 续发 userToken 仅在服务器实际返回 Set-Cookie 时保存，不保证自动续期。
 * 此移植经过模拟 QX 测试，尚未使用真实账号验证。
 */

const SCRIPT_NAME = "华住会签到";
const STORE_TOKEN = "huazhu_signin_token";
const STORE_TOKENS = "huazhu_signin_tokens";
const STORE_UA = "huazhu_signin_user_agent";
const API_BASE = "https://appgw.huazhu.com";
const DEFAULT_UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/114 Mobile Safari/537.36";
const TASK_BUDGET_MS = 45000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_RETRY_WAIT_MS = 3000;
const RETRY_STATUSES = [429, 500, 502, 503, 504];
const secrets = [];
let deadline = 0;
let finished = false;

function finish() {
  if (finished) return;
  finished = true;
  $done({});
}

function safeText(value) {
  let text = String(value === undefined || value === null ? "" : value);
  secrets.forEach(function (token) { text = text.split(token).join("[REDACTED]"); });
  return text.replace(/(userToken\s*[=:]\s*)[^;,\s"']+/gi, "$1[REDACTED]")
    .replace(/[\r\n]+/g, " ").slice(0, 180);
}

function notify(subtitle, body) {
  $notify(SCRIPT_NAME, subtitle, body);
}

function failure(kind, message) {
  const error = new Error(message);
  error.kind = kind;
  return error;
}

function header(headers, name) {
  const key = Object.keys(headers || {}).find(function (key) {
    return key.toLowerCase() === name.toLowerCase();
  });
  return key === undefined ? "" : headers[key];
}

function validToken(token) {
  return !!token && !/[^\x21-\x7e]|[;,&"\\]/.test(token);
}

function cookieToken(cookie) {
  const match = String(cookie || "").match(/(?:^|;\s*)userToken=([^;]*)/i);
  const token = match ? match[1].trim() : "";
  return validToken(token) ? token : "";
}

function captureToken() {
  const url = String($request.url || "");
  const method = String($request.method || "GET").toUpperCase();
  if (method === "OPTIONS" || !/^https:\/\/(?:appgw\.huazhu\.com\/game\/(?:sign_header|sign_in)|hweb-personalcenter\.huazhu\.com\/login\/autoLogin)(?:\?.*)?$/i.test(url)) return;
  const token = cookieToken(header($request.headers, "cookie"));
  if (!token) {
    console.log("[华住会] 请求已命中，但 Cookie 中没有 userToken；请进入签到页。");
    return;
  }
  const previous = $prefs.valueForKey(STORE_TOKEN);
  if (!$prefs.setValueForKey(token, STORE_TOKEN)) {
    notify("Token保存失败 ❌", "本机存储写入失败，请重新获取。");
    return;
  }
  const userAgent = String(header($request.headers, "user-agent") || "");
  if (userAgent && !/[\r\n]/.test(userAgent)) $prefs.setValueForKey(userAgent, STORE_UA);
  if (previous !== token) {
    const multi = String($prefs.valueForKey(STORE_TOKENS) || "").trim();
    notify("Token获取成功 ✅", multi
      ? "已保存单账号Token；任务仍优先使用手动多账号列表。"
      : "已保存到本机，请关闭抓取规则并手动运行一次签到任务。");
  }
}

function readStore() {
  const multi = String($prefs.valueForKey(STORE_TOKENS) || "");
  const key = multi.trim() ? STORE_TOKENS : STORE_TOKEN;
  const raw = String($prefs.valueForKey(key) || "");
  const tokens = raw.split(/[&\r\n]+/).map(function (token) { return token.trim(); })
    .filter(function (token, index, all) { return token && all.indexOf(token) === index; });
  tokens.forEach(function (token) { secrets.push(token); });
  if (tokens.some(function (token) { return !validToken(token); })) {
    throw failure("config", "本地Token格式不正确，请只填写 userToken 的值；多账号用 & 或换行分隔。");
  }
  const userAgent = String($prefs.valueForKey(STORE_UA) || "");
  return { key: key, raw: raw, tokens: tokens, userAgent: userAgent && !/[\r\n]/.test(userAgent) ? userAgent : DEFAULT_UA };
}

function refreshedToken(headers) {
  const value = header(headers, "set-cookie");
  const cookies = Array.isArray(value) ? value : [value];
  for (let index = 0; index < cookies.length; index += 1) {
    const match = String(cookies[index] || "").match(/(?:^|[,;]\s*)userToken=([^;,\s]+)/i);
    if (match && validToken(match[1])) return match[1];
  }
  return "";
}

function saveRenewedToken(response, account, store) {
  const token = response.freshToken;
  if (!token || token === account.token) return;
  secrets.push(token);
  account.token = token;
  // 不覆盖任务执行期间被用户/抓取脚本修改过的凭据。
  if (String($prefs.valueForKey(store.key) || "") !== store.raw) {
    console.log("[华住会] 本地凭据已变化，未覆盖；本次继续使用服务器续发Token。");
    return;
  }
  const next = store.tokens.slice();
  next[account.index] = token;
  const raw = next.join("&");
  if ($prefs.setValueForKey(raw, store.key)) {
    store.tokens = next;
    store.raw = raw;
    console.log("[华住会] 已保存服务器续发Token。");
  } else {
    account.notes.push("服务器续发Token未能保存，请重新抓取登录凭据。");
  }
}

function remainingTime() {
  return deadline - Date.now();
}

function timedFetch(options) {
  const timeout = Math.min(REQUEST_TIMEOUT_MS, remainingTime());
  if (timeout < 1000) return Promise.reject(failure("budget", "执行时间不足，请稍后手动运行未完成的账号。"));
  return new Promise(function (resolve, reject) {
    let settled = false;
    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      reject(failure("network", "请求超时，请在App核对签到状态后重试。"));
    }, timeout);
    Promise.resolve().then(function () { return $task.fetch(options); }).then(function (response) {
      if (settled) return;
      settled = true;
      if (typeof clearTimeout === "function") clearTimeout(timer);
      resolve(response);
    }, function () {
      if (settled) return;
      settled = true;
      if (typeof clearTimeout === "function") clearTimeout(timer);
      reject(failure("network", "网络请求失败，请稍后重试。"));
    });
  });
}

function retryDelay(headers) {
  const value = String(header(headers, "retry-after") || "").trim();
  let milliseconds = 1000;
  if (/^\d+$/.test(value)) milliseconds = Math.max(milliseconds, Number(value) * 1000);
  else if (value && !Number.isNaN(Date.parse(value))) milliseconds = Math.max(milliseconds, Date.parse(value) - Date.now());
  return milliseconds <= MAX_RETRY_WAIT_MS ? milliseconds : null;
}

async function requestApi(path, account, store) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await timedFetch({
        url: API_BASE + path,
        method: "GET",
        headers: {
          Cookie: "userToken=" + account.token,
          "User-Agent": store.userAgent,
          Referer: "https://cdn.huazhu.com/hzapp-signinfe/",
          Origin: "https://cdn.huazhu.com",
          Accept: "application/json, text/plain, */*"
        },
        opts: { redirection: false, "auto-cookie": false }
      });
    } catch (error) {
      if (error.kind !== "network" || attempt !== 0 || remainingTime() < 2000) throw error;
      await new Promise(function (resolve) { setTimeout(resolve, 1000); });
      continue;
    }
    const status = Number(response.statusCode || response.status || 0);
    if (RETRY_STATUSES.indexOf(status) !== -1) {
      const wait = retryDelay(response.headers);
      if (attempt === 0 && wait !== null && remainingTime() > wait + 1000) {
        await new Promise(function (resolve) { setTimeout(resolve, wait); });
        continue;
      }
      throw failure("http", "HTTP " + status + (status === 429 ? "：签到服务限流，请稍后重试。" : "：签到服务暂时不可用，请稍后重试。"));
    }
    if (status === 401 || status === 403) throw failure("auth", "登录已失效，请重新获取Token。");
    if (status < 200 || status >= 300) throw failure("http", "HTTP " + status + "：请求失败，请稍后重试。");
    let body;
    try { body = JSON.parse(response.body); } catch (error) {
      throw failure("format", "接口返回无法解析，请在App核对状态；可能需要更新脚本。");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw failure("format", "接口返回结构发生变化，请更新脚本。");
    if (isAuthError(body)) throw failure("auth", "登录已失效，请重新获取Token。");
    return { body: body, freshToken: refreshedToken(response.headers) };
  }
}

function isAuthError(body) {
  const codes = [String(body.code), String(body.businessCode)];
  return codes.some(function (code) { return ["401", "403", "1003"].indexOf(code) !== -1; }) ||
    /unauthorized|token.{0,8}(失效|过期|错误)|未登录|未授权|重新登录|登录.{0,6}(失效|过期)/i.test(String(body.message || body.responseDes || body.error || ""));
}

function isSuccess(body) {
  return String(body.code) === "200" || String(body.businessCode) === "1000";
}

function isAlreadySigned(body) {
  return String(body.code) === "5004" || String(body.businessCode) === "5010" ||
    /今日已签到|今天已签到|已经签到|重复签到|请勿重复签到/.test(String(body.message || body.responseDes || ""));
}

function signedToday(content) {
  return content.signToday === true || content.signToday === 1 || content.signToday === "1" || content.signToday === "true";
}

async function queryStatus(account, store) {
  const response = await requestApi("/game/sign_header", account, store);
  const body = response.body;
  if (!isSuccess(body) || !body.content || typeof body.content !== "object" || Array.isArray(body.content)) {
    throw failure("business", "签到状态查询失败：" + safeText(body.message || body.responseDes || "接口返回未知状态"));
  }
  saveRenewedToken(response, account, store);
  return body.content;
}

function summary(content) {
  const lines = [];
  if (content.memberPoint !== undefined && content.memberPoint !== null) lines.push("当前积分：" + safeText(content.memberPoint));
  if (content.yearSignInCount !== undefined && content.yearSignInCount !== null) lines.push("今年累计签到：" + safeText(content.yearSignInCount) + "天");
  return lines;
}

async function signAccount(account, store) {
  const before = await queryStatus(account, store);
  if (signedToday(before)) return { title: "今日已签到 ✅", ok: true, lines: summary(before) };
  const response = await requestApi("/game/sign_in?date=" + Math.floor(Date.now() / 1000), account, store);
  const body = response.body;
  const already = isAlreadySigned(body);
  if (!already && !isSuccess(body)) throw failure("business", "签到失败：" + safeText(body.message || body.responseDes || "接口返回未知状态"));
  saveRenewedToken(response, account, store);
  let after;
  try { after = await queryStatus(account, store); } catch (error) {
    return { title: already ? "今日已签到 ✅" : "结果待确认 ⚠️", ok: already,
      lines: [already ? "接口确认今日已签到。" : "签到接口已返回，但无法复核签到状态，请在App核对。", safeText(error.message)] };
  }
  if (!signedToday(after)) return { title: "结果待确认 ⚠️", ok: false, lines: ["签到接口已返回，但状态未确认今日已签，请在App核对。"].concat(summary(after)) };
  const content = body.content || {};
  const lines = summary(after);
  if (!already && content.signResult !== false && content.point !== undefined && content.point !== null) lines.unshift("本次签到积分：" + safeText(content.point));
  return { title: already || content.signResult === false ? "今日已签到 ✅" : "签到成功 🎉", ok: true, lines: lines };
}

async function runTask() {
  deadline = Date.now() + TASK_BUDGET_MS;
  const store = readStore();
  if (!store.tokens.length) {
    notify("尚未获取Token ❌", "请开启重写和MitM，进入华住会App/微信小程序签到页，等待Token获取成功通知。");
    return;
  }
  const results = [];
  for (let index = 0; index < store.tokens.length; index += 1) {
    if (remainingTime() < 1000) {
      results.push({ title: "执行时间不足 ⚠️", ok: false, lines: ["剩余 " + (store.tokens.length - index) + " 个账号未执行，请稍后手动运行。"] });
      break;
    }
    const account = { token: store.tokens[index], index: index, notes: [] };
    let result;
    try { result = await signAccount(account, store); } catch (error) {
      result = { title: error.kind === "auth" ? "登录已失效 ❌" : "签到失败 ❌", ok: false, lines: [safeText(error.message)] };
    }
    result.lines = result.lines.concat(account.notes);
    result.number = index + 1;
    results.push(result);
  }
  if (store.tokens.length === 1) notify(results[0].title, results[0].lines.join("\n"));
  else notify(results.every(function (result) { return result.ok; }) ? "全部账号已完成 ✅" : "部分账号需关注 ⚠️",
    results.map(function (result) { return (result.number ? "账号" + result.number + "：" : "") + result.title + "\n" + result.lines.join("\n"); }).join("\n\n"));
}

if (typeof $request !== "undefined" && $request) {
  try { captureToken(); } catch (error) { notify("Token获取失败 ❌", "请重新打开签到页，检查本机存储和脚本配置。"); }
  finally { finish(); }
} else {
  runTask().catch(function (error) { notify("任务未完成 ❌", safeText(error.message)); }).finally(finish);
}
