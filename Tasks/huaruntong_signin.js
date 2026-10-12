/**
 * 华润通每日签到（Quantumult X）
 *
 * 华润通 H5/微信页面把登录 token 放在 localStorage.uInfo，并在请求体中使用
 * crypto4mid（HMAC-MD5 + AES-CBC + RSA-OAEP）加密。本脚本通过响应重写在页面
 * 同源发出一次带临时请求头的探测请求，让 QX 安全保存 token；定时任务再使用
 * 官方 crypto4mid 库生成与页面相同的请求。
 *
 * [rewrite_local]
 * ^https:\/\/cloud\.huaruntong\.cn\/web\/online\/.*$ url script-response-body https://raw.githubusercontent.com/d539834401/QxSignUp/main/huaruntong_signin.js
 * ^https:\/\/activity\.huaruntong\.cn\/web\/online\/js\/main\.[A-Za-z0-9_-]+\.js$ url script-response-body https://raw.githubusercontent.com/d539834401/QxSignUp/main/huaruntong_signin.js
 * ^https:\/\/(?:cloud|activity)\.huaruntong\.cn\/__qx_hrt_capture(?:\?.*)?$ url script-request-header https://raw.githubusercontent.com/d539834401/QxSignUp/main/huaruntong_signin.js
 *
 * [task_local]
 * 15 7 * * * https://raw.githubusercontent.com/d539834401/QxSignUp/main/huaruntong_signin.js, tag=华润通签到, enabled=true
 *
 * [mitm]
 * hostname = %APPEND% mid.huaruntong.cn cloud.huaruntong.cn activity.huaruntong.cn
 *
 * 首次使用：开启重写和 MitM，打开华润通签到页面（页面加载后会自动保存 token），
 * 收到“参数获取成功”通知后，在 QX 任务列表中手动运行一次测试。
 *
 * Version: 1.0.0
 * Updated: 2026-09-05
 * Live verified: 2026-09-05
 * API reference: https://github.com/Cat-zaizai/ZaiZaiCat-Checkin
 */

const SCRIPT_NAME = "华润通签到";
const STORE_KEY = "huaruntong_signin_profile_v1";
const API_BASE = "https://mid.huaruntong.cn";
const CRYPTO_LIB_URL = "https://activity.huaruntong.cn/web/lib/crypto4mid.min.js";
const OPEN_URL = "https://cloud.huaruntong.cn/web/online/#/signIn";
const APP_ID = "API_AUTH_WEB";
const SECRET = "c274fc67-19f9-47ba-bb84-585a2e3a1f6a";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1 MicroMessenger/8.0.76";
const PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\n" +
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDuAiqDmvn9Rf15o21qkDxN0rUf\n" +
  "ZsX6rVBrtfgY6tamN2Yn+1D3eHZJuKNlucyqeBr6nmfN2srYAX+oyCXr5vWwFclj\n" +
  "PuWh8aSASqyk7MfbAv5Q4VqYS7lsYUQRdw4plZG0NASDeBvHWi3lsHjGfNb7iUvg\n" +
  "rk312EDfBHtRgDvB0QIDAQAB\n" +
  "-----END PUBLIC KEY-----";

function finish(value) {
  $done(value === undefined ? {} : value);
}

function notify(subtitle, body, openPage) {
  const options = openPage ? { "open-url": OPEN_URL } : undefined;
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

function likelyToken(value) {
  const token = String(value || "").trim();
  return token.length >= 16 && !/^(?:undefined|null|none)$/i.test(token) ? token : "";
}

function captureToken() {
  const headers = normalizeHeaders($request.headers || {});
  const token = likelyToken(
    headers["x-qx-hrt-token"] ||
    headers["x-hrt-token"] ||
    headers.authorization ||
    headers.token
  );
  if (!token) {
    finish({});
    return;
  }

  const previous = readStore() || {};
  const profile = {
    token: token.replace(/^Bearer\s+/i, ""),
    userAgent: headers["user-agent"] || previous.userAgent || DEFAULT_USER_AGENT,
    referer: previous.referer || "https://cloud.huaruntong.cn/",
    appId: APP_ID,
    capturedAt: new Date().toISOString()
  };
  const changed = previous.token !== profile.token;
  writeStore(profile);
  if (changed) notify("参数获取成功 ✅", "华润通登录 token 已安全保存到本机");
  finish({});
}

const INJECT_MARKER = "__QX_HRT_CAPTURE__";
const TOKEN_PROBE = "(function(){var " + INJECT_MARKER + "=1;function p(){try{var r=window.localStorage.getItem('uInfo')||'';var u=JSON.parse(r);var t=u&&u.token;if(typeof t==='string'&&t.length>=16){fetch('https://cloud.huaruntong.cn/__qx_hrt_capture?ts='+Date.now(),{method:'GET',headers:{'X-QX-HRT-Token':t}}).catch(function(){})}}catch(e){}}setTimeout(p,0);setTimeout(p,800);setTimeout(p,2500);})();";

function injectTokenProbe(body) {
  const text = String(body || "");
  if (!text || text.indexOf(INJECT_MARKER) >= 0) return text;
  if (/<html|<body|<script/i.test(text)) {
    const script = "<script>" + TOKEN_PROBE + "</script>";
    return /<\/body>/i.test(text) ? text.replace(/<\/body>/i, script + "</body>") : text + script;
  }
  return text + "\n;" + TOKEN_PROBE;
}

function rewriteResponse() {
  if (!$response || typeof $response.body !== "string") {
    finish({});
    return;
  }
  const body = injectTokenProbe($response.body);
  finish(body === $response.body ? {} : { body: body });
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (char) {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 3) | 8;
    return value.toString(16);
  });
}

function responseData(response) {
  if (response && response.data && typeof response.data === "object") return response.data;
  return response || {};
}

function responseCode(response) {
  if (!response || response.code === undefined || response.code === null) return "";
  return String(response.code);
}

function responseMessage(response) {
  const value = response && (response.msg || response.message || response.text);
  return String(value || "未知错误");
}

function successResponse(response) {
  const code = responseCode(response);
  return code === "S0A00000" || code === "200" || response.success === true;
}

function authError(response) {
  const code = responseCode(response);
  return code === "401" || code === "403" || /登录|token|认证|鉴权|授权|过期|失效/i.test(responseMessage(response));
}

let crypto4midPromise = null;

function loadCrypto4mid() {
  if (crypto4midPromise) return crypto4midPromise;
  crypto4midPromise = (async function () {
    const response = await $task.fetch({ url: CRYPTO_LIB_URL, method: "GET" });
    const status = Number(response.statusCode || response.status || 0);
    if (status && (status < 200 || status >= 300)) throw new Error("加密库加载失败（HTTP " + status + "）");
    if (!response.body) throw new Error("加密库返回为空");

    const module = { exports: {} };
    const browserWindow = {
      crypto: {
        getRandomValues: function (buffer) {
          for (let index = 0; index < buffer.length; index += 1) {
            buffer[index] = Math.floor(Math.random() * 256);
          }
          return buffer;
        }
      }
    };
    const factory = new Function("module", "exports", "process", "window", String(response.body) + "\n;return module.exports;");
    const api = factory(module, module.exports, undefined, browserWindow);
    if (!api || typeof api.crypto4mid !== "function") throw new Error("加密库接口不可用");
    return api.crypto4mid;
  })();
  return crypto4midPromise.catch(function (error) {
    crypto4midPromise = null;
    throw error;
  });
}

function buildHeaders(profile) {
  return {
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json;charset=UTF-8",
    "X-HRT-MID-NEWRISK": "newRisk",
    "X-Hrt-Mid-Appid": APP_ID,
    "Origin": "https://cloud.huaruntong.cn",
    "Referer": profile.referer || "https://cloud.huaruntong.cn/",
    "User-Agent": profile.userAgent || DEFAULT_USER_AGENT
  };
}

async function postEncrypted(path, data, profile) {
  const params = Object.assign({}, data || {}, {
    token: profile.token,
    apiPath: encodeURIComponent(path),
    appId: APP_ID,
    timestamp: Date.now()
  });
  const crypto4mid = await loadCrypto4mid();
  const encrypted = crypto4mid(params, { secret: SECRET, pubKey: PUBLIC_KEY });
  if (!encrypted || !encrypted.key || !encrypted.data) throw new Error("加密请求生成失败");

  const response = await $task.fetch({
    url: API_BASE + path,
    method: "POST",
    headers: buildHeaders(profile),
    body: JSON.stringify(encrypted)
  });
  const status = Number(response.statusCode || response.status || 0);
  let body;
  try {
    body = JSON.parse(response.body || "{}");
  } catch (error) {
    throw new Error("接口返回无法解析（HTTP " + status + "）");
  }
  if (status && (status < 200 || status >= 300)) {
    throw new Error("HTTP " + status + "：" + responseMessage(body));
  }
  return body;
}

async function queryWeekSignin(profile) {
  return postEncrypted("/api/points/queryWeekSignin", { transactionUuid: uuid() }, profile);
}

async function querySummary(profile) {
  return postEncrypted("/api/points/querySummary", {
    channelId: "APP",
    sysId: "T0000001",
    transactionUuid: uuid(),
    merchantCode: "1641000001532",
    pointsType: "100000"
  }, profile);
}

async function saveQuestionSignin(profile) {
  return postEncrypted("/api/points/saveQuestionSignin", {
    answerResult: 1,
    channelId: "APP",
    merchantCode: "1641000001532",
    storeCode: "qiandaosonjifen",
    sysId: "T0000001",
    transactionUuid: uuid(),
    inviteCode: ""
  }, profile);
}

function pointsFrom(response) {
  const data = responseData(response);
  const candidates = [
    data.points,
    data.totalPoints,
    data.availablePoints,
    data.cPoints && data.cPoints.availablePoints,
    response && response.point,
    response && response.data && response.data.point
  ];
  for (let index = 0; index < candidates.length; index += 1) {
    const number = Number(candidates[index]);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function signedToday(response) {
  const data = responseData(response);
  return data.isTodaySignin === "S" || data.isSignedToday === true || data.signed === true;
}

function signedDays(response) {
  const data = responseData(response);
  const number = Number(data.signinDays || data.currentCycleSignInCount || 0);
  return Number.isFinite(number) ? number : 0;
}

async function runTask() {
  const profile = readStore();
  if (!profile || !profile.token) {
    notify("尚未获取登录参数 ❌", "请开启重写与 MitM，重新打开华润通签到页面", true);
    finish();
    return;
  }

  try {
    const before = await queryWeekSignin(profile);
    if (authError(before)) {
      notify("登录状态已失效 ❌", "请重新打开华润通签到页面刷新 token", true);
      finish();
      return;
    }
    if (!successResponse(before)) {
      notify("查询签到状态失败 ❌", "code=" + responseCode(before) + " " + responseMessage(before), true);
      finish();
      return;
    }

    if (signedToday(before)) {
      const lines = ["连续签到：" + signedDays(before) + " 天"];
      try {
        const summary = await querySummary(profile);
        const points = pointsFrom(summary);
        if (points !== null) lines.push("当前积分：" + points);
      } catch (error) {
        console.log("[" + SCRIPT_NAME + "] 积分查询失败：" + error);
      }
      notify("今日已签到 ✅", lines.join("\n"));
      finish();
      return;
    }

    const signed = await saveQuestionSignin(profile);
    if (authError(signed)) {
      notify("登录状态已失效 ❌", "请重新打开华润通签到页面刷新 token", true);
      finish();
      return;
    }
    if (!successResponse(signed) && !/已经签到|已签到|重复签到/.test(responseMessage(signed))) {
      notify("签到失败 ❌", "code=" + responseCode(signed) + " " + responseMessage(signed), true);
      finish();
      return;
    }

    const after = await queryWeekSignin(profile);
    const signedPoint = pointsFrom(signed);
    const lines = ["获得积分：" + (signedPoint === null ? "接口未返回" : signedPoint)];
    lines.push("连续签到：" + signedDays(after) + " 天");
    try {
      const summary = await querySummary(profile);
      const points = pointsFrom(summary);
      if (points !== null) lines.push("当前积分：" + points);
    } catch (error) {
      console.log("[" + SCRIPT_NAME + "] 签到后的积分查询失败：" + error);
    }
    notify("签到成功 🎉", lines.join("\n"));
    finish();
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (/HTTP (401|403)|登录|token|认证|鉴权|授权|过期|失效/i.test(message)) {
      notify("登录状态已失效 ❌", "请重新打开华润通签到页面刷新 token", true);
    } else {
      notify("请求异常 ❌", message, true);
    }
    finish();
  }
}

if (typeof $response !== "undefined" && $response && typeof $response.body === "string") {
  rewriteResponse();
} else if (typeof $request !== "undefined" && $request && $request.url && /\/__qx_hrt_capture(?:\?|$)/.test($request.url)) {
  captureToken();
} else {
  runTask();
}
