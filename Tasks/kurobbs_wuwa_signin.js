/**
 * 库街区 · 鸣潮每日签到（Quantumult X）
 *
 * 功能：
 * 1. 打开库街区 App 的鸣潮签到页面时，自动保存 Token、库街区 UID、
 *    鸣潮角色 UID、服务器 ID 和必要的设备请求头。
 * 2. 定时运行时先查询今天是否已经签到；已签到则不重复提交。
 * 3. 未签到时自动签到，并显示本月签到天数和当天奖励。
 * 4. Token 等凭证只保存在 Quantumult X 的本地 $prefs 中。
 *
 * 将以下内容加入 Quantumult X 配置：
 *
 * [rewrite_local]
 * ^https:\/\/api\.kurobbs\.com\/encourage\/signIn\/(?:initSignInV2|v2)(?:\?.*)?$ url script-request-body https://raw.githubusercontent.com/d539834401/QxSignUp/main/kurobbs_wuwa_signin.js
 *
 * [task_local]
 * 8 0 * * * https://raw.githubusercontent.com/d539834401/QxSignUp/main/kurobbs_wuwa_signin.js, tag=库街区·鸣潮签到, enabled=true
 *
 * [mitm]
 * hostname = %APPEND% api.kurobbs.com
 *
 * 首次使用：开启重写和 MITM，打开「库街区 → 鸣潮 → 签到」页面，
 * 看到“参数获取成功”通知后，在 Quantumult X 任务列表手动运行一次测试。
 *
 * Version: 1.0.0
 * Updated: 2026-09-01
 * Logic reference: https://github.com/ZenmoFeiShi/Qx/blob/main/mixc_signin.js
 * API reference: https://github.com/yongyeym/AutoSign_QingLong/blob/main/kurobbs_sign.py
 */

const SCRIPT_NAME = "库街区·鸣潮签到";
const STORE_KEY = "kurobbs_wuwa_signin_profile_v1";
const GAME_ID = "3";
const API_BASE = "https://api.kurobbs.com";
const API_INIT = API_BASE + "/encourage/signIn/initSignInV2";
const API_SIGN = API_BASE + "/encourage/signIn/v2";
const SIGN_PAGE = "https://web-static.kurobbs.com/events2.0/index.html#/mc-month-sign/home";

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

function notify(subtitle, body, openPage) {
  const options = openPage ? { "open-url": SIGN_PAGE } : undefined;
  $notify(SCRIPT_NAME, subtitle, body, options);
}

function finish(value) {
  $done(value === undefined ? {} : value);
}

function normalizeHeaders(headers) {
  const result = {};
  Object.keys(headers || {}).forEach(function (key) {
    result[String(key).toLowerCase()] = String(headers[key]);
  });
  return result;
}

function decodeComponent(value) {
  try {
    return decodeURIComponent(String(value).replace(/\+/g, " "));
  } catch (error) {
    return String(value);
  }
}

function parseForm(body) {
  const result = {};
  if (!body) return result;
  String(body).split("&").forEach(function (part) {
    const index = part.indexOf("=");
    const key = index >= 0 ? part.slice(0, index) : part;
    const value = index >= 0 ? part.slice(index + 1) : "";
    if (key) result[decodeComponent(key)] = decodeComponent(value);
  });
  return result;
}

function parseRequestBody(body, contentType) {
  const text = String(body || "").trim();
  if (!text) return {};
  if (String(contentType || "").toLowerCase().indexOf("json") >= 0 || text[0] === "{") {
    try {
      return JSON.parse(text);
    } catch (error) {
      console.log("[" + SCRIPT_NAME + "] JSON 请求体解析失败，改用表单解析");
    }
  }
  return parseForm(text);
}

function encodeForm(data) {
  return Object.keys(data).map(function (key) {
    const value = data[key] === undefined || data[key] === null ? "" : data[key];
    return encodeURIComponent(key) + "=" + encodeURIComponent(String(value));
  }).join("&");
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
    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;
    output += String.fromCharCode(chr1);
    if (enc3 !== 64) output += String.fromCharCode(chr2);
    if (enc4 !== 64) output += String.fromCharCode(chr3);
  }
  return output;
}

function userIdFromToken(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return "";
    const payload = JSON.parse(decodeBase64Url(parts[1]));
    return payload.userId === undefined ? "" : String(payload.userId);
  } catch (error) {
    return "";
  }
}

const HEADER_ALLOWLIST = [
  "accept",
  "accept-language",
  "source",
  "user-agent",
  "origin",
  "referer",
  "x-requested-with",
  "devcode",
  "distinct_id",
  "channelid",
  "channel",
  "version",
  "versioncode",
  "countrycode",
  "ip",
  "lang",
  "model",
  "osversion"
];

function pickHeaders(headers) {
  const result = {};
  HEADER_ALLOWLIST.forEach(function (key) {
    if (headers[key]) result[key] = headers[key];
  });
  return result;
}

function sameProfile(previous, current) {
  if (!previous) return false;
  return previous.token === current.token &&
    previous.userId === current.userId &&
    previous.roleId === current.roleId &&
    previous.serverId === current.serverId;
}

function captureProfile() {
  const headers = normalizeHeaders($request.headers || {});
  const params = parseRequestBody($request.body || "", headers["content-type"] || "");
  const previous = readStore() || {};
  const token = headers.token || headers.authorization || previous.token || "";
  const profile = {
    token: token.replace(/^Bearer\s+/i, ""),
    userId: String(params.userId || previous.userId || userIdFromToken(token) || ""),
    roleId: String(params.roleId || previous.roleId || ""),
    serverId: String(params.serverId || previous.serverId || ""),
    gameId: String(params.gameId || previous.gameId || GAME_ID),
    headers: Object.assign({}, previous.headers || {}, pickHeaders(headers)),
    capturedAt: new Date().toISOString()
  };

  if (profile.gameId !== GAME_ID) {
    finish({});
    return;
  }

  const missing = [];
  if (!profile.token) missing.push("Token");
  if (!profile.userId) missing.push("库街区UID");
  if (!profile.roleId) missing.push("角色UID");
  if (!profile.serverId) missing.push("服务器ID");

  if (missing.length) {
    console.log("[" + SCRIPT_NAME + "] 当前请求缺少：" + missing.join("、"));
    finish({});
    return;
  }

  const changed = !sameProfile(previous, profile);
  writeStore(profile);
  if (changed) {
    notify(
      "参数获取成功 ✅",
      "角色UID：" + profile.roleId + "\nToken、库街区UID和服务器信息已保存到本机"
    );
  } else {
    console.log("[" + SCRIPT_NAME + "] 参数未变化，已刷新本地保存时间");
  }
  finish({});
}

function buildHeaders(profile) {
  const saved = profile.headers || {};
  const headers = Object.assign({}, saved, {
    "accept": saved.accept || "application/json, text/plain, */*",
    "accept-language": saved["accept-language"] || "zh-CN,zh-Hans;q=0.9",
    "content-type": "application/x-www-form-urlencoded",
    "source": saved.source || "ios",
    "user-agent": saved["user-agent"] || "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) KuroGameBox/3.1.4",
    "origin": saved.origin || "https://web-static.kurobbs.com",
    "token": profile.token
  });
  delete headers.authorization;
  return headers;
}

async function postApi(path, data, profile) {
  const response = await $task.fetch({
    url: API_BASE + path,
    method: "POST",
    headers: buildHeaders(profile),
    body: encodeForm(data)
  });
  const status = Number(response.statusCode || response.status || 0);
  if (status && (status < 200 || status >= 300)) {
    throw new Error("HTTP " + status + "：" + String(response.body || "").slice(0, 120));
  }
  try {
    return JSON.parse(response.body || "{}");
  } catch (error) {
    throw new Error("接口返回无法解析：" + String(response.body || "").slice(0, 120));
  }
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatGoods(goods) {
  if (!goods) return "";
  const name = goods.goodsName || goods.name || "未知奖励";
  const count = goods.goodsNum === undefined ? goods.num : goods.goodsNum;
  return "「" + name + "」" + (count === undefined ? "" : "×" + count);
}

function rewardForToday(data, alreadySigned) {
  if (!data) return "";
  const signedCount = numberValue(data.sigInNum, 0);
  const targetSerial = alreadySigned ? Math.max(0, signedCount - 1) : signedCount;
  const rewards = Array.isArray(data.signInGoodsConfigs) ? data.signInGoodsConfigs : [];
  const normal = rewards.find(function (item) {
    return numberValue(item.serialNum, -1) === targetSerial;
  });
  const result = [];
  const normalText = formatGoods(normal);
  if (normalText) result.push(normalText);

  if (Array.isArray(data.signLoopGoodsList) && data.signLoopGoodsList.length) {
    const loopCount = numberValue(data.loopSignNum, 0) + (alreadySigned ? 0 : 1);
    const loopReward = data.signLoopGoodsList.find(function (item) {
      return numberValue(item.serialNum, -1) === Math.max(0, loopCount - 1);
    });
    const loopText = formatGoods(loopReward);
    if (loopText) result.push((data.loopSignName || "限时签到") + " " + loopText);
  }
  return result.join("，");
}

function monthFromStatus(data) {
  const serverTime = data && String(data.nowServerTimes || "");
  const match = serverTime.match(/^\d{4}-(\d{2})-/);
  if (match) return match[1];
  const month = new Date().getMonth() + 1;
  return month < 10 ? "0" + month : String(month);
}

function profileMissing(profile) {
  return !profile || !profile.token || !profile.userId || !profile.roleId || !profile.serverId;
}

function apiMessage(response) {
  return String((response && (response.msg || response.message)) || "未知错误");
}

function tokenExpired(response) {
  return Number(response && response.code) === 220 || /token|登录.*(失效|过期)|cookie.*过期/i.test(apiMessage(response));
}

async function queryStatus(profile) {
  return postApi("/encourage/signIn/initSignInV2", {
    gameId: GAME_ID,
    serverId: profile.serverId,
    roleId: profile.roleId,
    userId: profile.userId
  }, profile);
}

async function runTask() {
  const profile = readStore();
  if (profileMissing(profile)) {
    notify(
      "尚未获取签到参数 ❌",
      "请开启 Quantumult X 重写与 MITM，然后打开库街区 App 的鸣潮签到页面",
      true
    );
    finish();
    return;
  }

  try {
    const statusResponse = await queryStatus(profile);
    if (tokenExpired(statusResponse)) {
      notify("登录状态已失效 ❌", "请重新打开库街区鸣潮签到页面刷新参数", true);
      finish();
      return;
    }
    if (Number(statusResponse.code) !== 200 || !statusResponse.data) {
      notify(
        "查询签到状态失败 ❌",
        "code=" + statusResponse.code + " " + apiMessage(statusResponse),
        true
      );
      finish();
      return;
    }

    const status = statusResponse.data;
    const alreadySigned = status.isSigIn === true || status.isSignIn === true;
    const reward = rewardForToday(status, alreadySigned) || "奖励信息未返回";
    const signedDays = numberValue(status.sigInNum, 0);

    if (alreadySigned) {
      notify(
        "今日已签到 ✅",
        "本月已签到 " + signedDays + " 天\n今日奖励：" + reward
      );
      finish();
      return;
    }

    const signResponse = await postApi("/encourage/signIn/v2", {
      gameId: GAME_ID,
      serverId: profile.serverId,
      roleId: profile.roleId,
      userId: profile.userId,
      reqMonth: monthFromStatus(status)
    }, profile);

    if (tokenExpired(signResponse)) {
      notify("登录状态已失效 ❌", "请重新打开库街区鸣潮签到页面刷新参数", true);
      finish();
      return;
    }

    if (Number(signResponse.code) === 1511 || /重复签到|已经签到|已签到/.test(apiMessage(signResponse))) {
      notify(
        "今日已签到 ✅",
        "本月已签到 " + signedDays + " 天\n今日奖励：" + reward
      );
      finish();
      return;
    }

    if (Number(signResponse.code) !== 200 || signResponse.success === false) {
      notify(
        "签到失败 ❌",
        "code=" + signResponse.code + " " + apiMessage(signResponse),
        true
      );
      finish();
      return;
    }

    let finalDays = signedDays + 1;
    let finalReward = formatGoods(signResponse.data && signResponse.data.todayList) || reward;
    try {
      const confirmed = await queryStatus(profile);
      if (Number(confirmed.code) === 200 && confirmed.data) {
        finalDays = numberValue(confirmed.data.sigInNum, finalDays);
        finalReward = rewardForToday(confirmed.data, true) || finalReward;
      }
    } catch (error) {
      console.log("[" + SCRIPT_NAME + "] 签到成功后的状态复核失败：" + error);
    }

    notify(
      "签到成功 🎉",
      "本月已签到 " + finalDays + " 天\n今日奖励：" + (finalReward || "奖励信息未返回")
    );
    finish();
  } catch (error) {
    notify("请求异常 ❌", String(error), true);
    finish();
  }
}

if (typeof $request !== "undefined" && $request && $request.url) {
  captureProfile();
} else {
  runTask();
}
