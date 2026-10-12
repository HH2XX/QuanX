/**
 * 未来荟每日签到（Quantumult X）
 *
 * 功能：
 * 1. 打开微信小程序「未来荟」首页时，自动保存 Wechat JWT 和必要请求头。
 * 2. 定时运行时先查询今日签到状态，已签到则不重复提交。
 * 3. 未签到时执行签到，并复核签到状态与当前积分。
 * 4. 登录凭据只保存在 Quantumult X 本机的 $prefs 中。
 *
 * 将以下内容加入 Quantumult X 配置：
 *
 * [rewrite_local]
 * ^https:\/\/wlhmobile\.crland\.com\.cn\/(?:business\/client\/card\/detail|member\/client\/detail)(?:\?.*)?$ url script-request-header https://raw.githubusercontent.com/d539834401/QxSignUp/main/wentiweilaihui_signin.js
 *
 * [task_local]
 * 5 8 * * * https://raw.githubusercontent.com/d539834401/QxSignUp/main/wentiweilaihui_signin.js, tag=未来荟签到, enabled=true
 *
 * [mitm]
 * hostname = %APPEND% wlhmobile.crland.com.cn
 *
 * 首次使用：开启重写和 MitM，重新打开微信小程序「未来荟」。收到
 * “参数获取成功”通知后，在 Quantumult X 任务列表中手动运行一次测试。
 *
 * Version: 1.0.0
 * Updated: 2026-09-05
 * Live verified: 2026-09-05
 * API reference: https://github.com/Cat-zaizai/ZaiZaiCat-Checkin
 */

const SCRIPT_NAME = "未来荟签到";
const STORE_KEY = "wentiweilaihui_signin_profile_v1";
const API_BASE = "https://wlhmobile.crland.com.cn";
const DEFAULT_APP_ID = "wx020209beec4251e0";
const DEFAULT_PROJECT_UUID = "3a59e62a07f811f1bec0aeefcf2e061a";
const MINI_PROGRAM_HOME = "weixin://";

function finish(value) {
  $done(value === undefined ? {} : value);
}

function notify(subtitle, body, openMiniProgram) {
  const options = openMiniProgram ? { "open-url": MINI_PROGRAM_HOME } : undefined;
  $notify(SCRIPT_NAME, subtitle, body, options);
}

function normalizeHeaders(headers) {
  const result = {};
  Object.keys(headers || {}).forEach(function (key) {
    result[String(key).toLowerCase()] = String(headers[key]);
  });
  return result;
}

function readStore() {
  const value = $prefs.valueForKey(STORE_KEY);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    console.log("[" + SCRIPT_NAME + "] 本地配置解析失败：" + error);
    return null;
  }
}

function writeStore(value) {
  return $prefs.setValueForKey(JSON.stringify(value), STORE_KEY);
}

function normalizedAuthorization(value) {
  const auth = String(value || "").trim();
  if (!auth) return "";
  if (/^Wechat\s+/i.test(auth)) return "Wechat " + auth.replace(/^Wechat\s+/i, "");
  return "Wechat " + auth;
}

function rawToken(authorization) {
  return String(authorization || "").replace(/^Wechat\s+/i, "").trim();
}

function decodeBase64Url(value) {
  let input = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (input.length % 4) input += "=";
  if (typeof atob === "function") return atob(input);

  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let output = "";
  let index = 0;
  while (index < input.length) {
    const enc1 = chars.indexOf(input.charAt(index++));
    const enc2 = chars.indexOf(input.charAt(index++));
    const enc3 = chars.indexOf(input.charAt(index++));
    const enc4 = chars.indexOf(input.charAt(index++));
    output += String.fromCharCode((enc1 << 2) | (enc2 >> 4));
    if (enc3 !== 64) output += String.fromCharCode(((enc2 & 15) << 4) | (enc3 >> 2));
    if (enc4 !== 64) output += String.fromCharCode(((enc3 & 3) << 6) | enc4);
  }
  return output;
}

function tokenPayload(authorization) {
  try {
    const parts = rawToken(authorization).split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(decodeBase64Url(parts[1]));
  } catch (error) {
    return null;
  }
}

function tokenExpiresAt(authorization) {
  const payload = tokenPayload(authorization);
  return payload && Number(payload.exp) > 0 ? Number(payload.exp) * 1000 : 0;
}

function tokenOpenId(authorization) {
  const payload = tokenPayload(authorization);
  return payload && payload.openid ? String(payload.openid) : "";
}

function captureProfile() {
  const headers = normalizeHeaders($request.headers || {});
  const previous = readStore() || {};
  const authorization = normalizedAuthorization(headers.authorization || previous.authorization);
  const profile = {
    authorization: authorization,
    appId: headers.appid || previous.appId || DEFAULT_APP_ID,
    projectUuid: headers.projectuuid || previous.projectUuid || DEFAULT_PROJECT_UUID,
    userAgent: headers["user-agent"] || previous.userAgent || "",
    referer: headers.referer || previous.referer || "",
    expiresAt: tokenExpiresAt(authorization),
    capturedAt: new Date().toISOString()
  };

  if (!profile.authorization) {
    console.log("[" + SCRIPT_NAME + "] 当前请求缺少 Authorization，未保存");
    finish({});
    return;
  }

  const changed = previous.authorization !== profile.authorization ||
    previous.appId !== profile.appId ||
    previous.projectUuid !== profile.projectUuid;
  writeStore(profile);

  if (changed) {
    const expires = profile.expiresAt
      ? "\n有效期至：" + new Date(profile.expiresAt).toLocaleString()
      : "";
    notify("参数获取成功 ✅", "Wechat JWT 已安全保存到本机" + expires);
  } else {
    console.log("[" + SCRIPT_NAME + "] 参数未变化，已刷新本地保存时间");
  }
  finish({});
}

function buildHeaders(profile) {
  const headers = {
    "Accept": "*/*",
    "Content-Type": "application/json",
    "Authorization": normalizedAuthorization(profile.authorization),
    "appId": profile.appId || DEFAULT_APP_ID,
    "projectUuid": profile.projectUuid || DEFAULT_PROJECT_UUID,
    "User-Agent": profile.userAgent || "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.76 MiniProgramEnv/iOS",
    "Accept-Language": "zh-CN,zh-Hans;q=0.9"
  };
  if (profile.referer) headers.Referer = profile.referer;
  return headers;
}

async function postApi(path, data, profile) {
  const response = await $task.fetch({
    url: API_BASE + path,
    method: "POST",
    headers: buildHeaders(profile),
    body: JSON.stringify(data || {})
  });
  const status = Number(response.statusCode || response.status || 0);
  let body;
  try {
    body = JSON.parse(response.body || "{}");
  } catch (error) {
    throw new Error("接口返回无法解析（HTTP " + status + "）");
  }
  if (status && (status < 200 || status >= 300)) {
    const message = body.text || body.message || body.msg || "请求失败";
    const httpError = new Error("HTTP " + status + "：" + message);
    httpError.response = body;
    throw httpError;
  }
  return body;
}

function apiMessage(response) {
  if (!response) return "未知错误";
  if (typeof response.result === "string" && response.result) return response.result;
  return String(response.text || response.message || response.msg || "未知错误");
}

function isSuccess(response) {
  return Number(response && response.code) === 200;
}

function isLoginExpired(response) {
  const code = Number(response && response.code);
  return code === 401 || code === 403 || code === 1001 ||
    /token|jwt|登录|鉴权|授权|认证/i.test(apiMessage(response));
}

function profileMissing(profile) {
  return !profile || !profile.authorization || !profile.appId || !profile.projectUuid;
}

function profileTokenExpired(profile) {
  const expiresAt = Number(profile && (profile.expiresAt || tokenExpiresAt(profile.authorization))) || 0;
  return expiresAt > 0 && Date.now() >= expiresAt - 60000;
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function signSummary(record) {
  const count = numberValue(record && record.currentCycleSignInCount, 0);
  const cycleDays = numberValue(record && (record.rewardCycleDays || record.cycleDays), 0);
  const reward = numberValue(record && record.rewardPoint, NaN);
  const lines = ["本周期已签到 " + count + (cycleDays ? "/" + cycleDays : "") + " 天"];
  if (Number.isFinite(reward) && reward > 0) lines.push("本次奖励：" + reward + " 积分");
  return lines;
}

async function querySignRecord(profile) {
  return postApi("/marketing/client/task/sign-in/record", {
    projectUuid: profile.projectUuid
  }, profile);
}

async function queryPoints(profile) {
  const openId = tokenOpenId(profile.authorization);
  if (!openId) return null;
  const response = await postApi("/member/client/detail", {
    projectUuid: profile.projectUuid,
    openId: openId
  }, profile);
  if (!isSuccess(response) || !response.result) return null;
  const points = Number(response.result.points);
  return Number.isFinite(points) ? points : null;
}

async function runTask() {
  const profile = readStore();
  if (profileMissing(profile)) {
    notify(
      "尚未获取登录参数 ❌",
      "请开启重写与 MitM，然后重新打开微信小程序「未来荟」首页",
      true
    );
    finish();
    return;
  }
  if (profileTokenExpired(profile)) {
    notify("登录状态已过期 ❌", "请重新打开微信小程序「未来荟」刷新参数", true);
    finish();
    return;
  }

  try {
    const before = await querySignRecord(profile);
    if (isLoginExpired(before)) {
      notify("登录状态已失效 ❌", "请重新打开微信小程序「未来荟」刷新参数", true);
      finish();
      return;
    }
    if (!isSuccess(before) || !before.result || typeof before.result !== "object") {
      notify("查询签到状态失败 ❌", "code=" + before.code + " " + apiMessage(before), true);
      finish();
      return;
    }

    if (before.result.isSignedToday === true) {
      const lines = signSummary(before.result);
      try {
        const points = await queryPoints(profile);
        if (points !== null) lines.push("当前积分：" + points);
      } catch (error) {
        console.log("[" + SCRIPT_NAME + "] 积分查询失败：" + error);
      }
      notify("今日已签到 ✅", lines.join("\n"));
      finish();
      return;
    }

    const signed = await postApi("/marketing/client/task/daily/sign-in", {
      projectUuid: profile.projectUuid
    }, profile);
    if (isLoginExpired(signed)) {
      notify("登录状态已失效 ❌", "请重新打开微信小程序「未来荟」刷新参数", true);
      finish();
      return;
    }
    if (!isSuccess(signed) && !/已经签到|已签到|重复签到/.test(apiMessage(signed))) {
      notify("签到失败 ❌", "code=" + signed.code + " " + apiMessage(signed), true);
      finish();
      return;
    }

    const after = await querySignRecord(profile);
    const record = isSuccess(after) && after.result ? after.result : before.result;
    const lines = signSummary(record);
    try {
      const points = await queryPoints(profile);
      if (points !== null) lines.push("当前积分：" + points);
    } catch (error) {
      console.log("[" + SCRIPT_NAME + "] 签到成功后的积分查询失败：" + error);
    }
    notify("签到成功 🎉", lines.join("\n"));
    finish();
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (/HTTP (401|403)|token|jwt|登录|鉴权|授权|认证/i.test(message)) {
      notify("登录状态已失效 ❌", "请重新打开微信小程序「未来荟」刷新参数", true);
    } else {
      notify("请求异常 ❌", message, true);
    }
    finish();
  }
}

if (typeof $request !== "undefined" && $request && $request.url) {
  captureProfile();
} else {
  runTask();
}
