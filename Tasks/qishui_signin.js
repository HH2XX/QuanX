/**
 * 汽水音乐签到（Quantumult X，抓取重放版）
 *
 * 公开资料只能确认签到入口位于真实接口 /luna/treasure/ 下，没有公开、可验证的
 * 固定签到提交路径。因此本脚本不使用网上流传但当前不存在的
 * music-api.douyin.com/task/signIn，而是在用户手动签到时保存真实请求，再由定时
 * 任务重放。
 *
 * [rewrite_local]
 * ^https:\/\/(?:api(?:5-lq)?\.qishui\.com|beta-luna\.douyin\.com)\/luna\/treasure\/.*$ url script-response-body https://raw.githubusercontent.com/d539834401/QxSignUp/main/qishui_signin.js
 *
 * [task_local]
 * 35 7 * * * https://raw.githubusercontent.com/d539834401/QxSignUp/main/qishui_signin.js, tag=汽水音乐签到, enabled=true
 *
 * [mitm]
 * hostname = %APPEND% api.qishui.com api5-lq.qishui.com beta-luna.douyin.com
 *
 * 获取请求：开启重写和 MitM，打开汽水音乐“我的 → VIP 天天送/签到入口”，手动
 * 点击当天日期签到。收到“签到请求获取成功”通知后即可手动运行任务测试。
 *
 * 注意：本版本仅重放签到/领取请求，不执行看广告、播放时长、红包雨等任务。若接口
 * 使用短时设备签名，定时运行会提示重新抓取；需通过实机抓包再决定能否动态刷新签名。
 *
 * Version: 0.1.0-experimental
 * Updated: 2026-09-06
 * References:
 * - https://github.com/BOBOLAOSHIV587/Rules/tree/main/JS/SodaMusic
 * - https://github.com/miemiegy/fuckqishuishui-miemie
 */

const SCRIPT_NAME = "汽水音乐签到";
const STORE_KEY = "qishui_signin_request_v1";
const OPEN_URL = "https://www.qishui.com/";
const TREASURE_PATH = "/luna/treasure/";

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

function replayHeaders(headers) {
  const blocked = {
    "content-length": true,
    "host": true,
    "connection": true,
    "proxy-connection": true,
    "accept-encoding": true
  };
  const result = {};
  Object.keys(headers || {}).forEach(function (key) {
    const lower = String(key).toLowerCase();
    if (!blocked[lower]) result[key] = String(headers[key]);
  });
  return result;
}

function parseJson(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch (error) {
    return null;
  }
}

function readStore() {
  const value = $prefs.valueForKey(STORE_KEY);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    console.log("[" + SCRIPT_NAME + "] 本地请求解析失败：" + error);
    return null;
  }
}

function writeStore(value) {
  return $prefs.setValueForKey(JSON.stringify(value), STORE_KEY);
}

function urlPath(url) {
  const match = String(url || "").match(/^https?:\/\/[^/]+([^?#]*)/i);
  return match ? match[1] : "";
}

function isMutation(method) {
  return !/^(?:GET|HEAD|OPTIONS)$/i.test(String(method || "GET"));
}

function isExcludedAction(url) {
  const value = String(url || "").toLowerCase();
  return /(?:^|[\/_-])(ad|ads|video|watch|report|event|track|log|red.?packet)(?:[\/_-]|$)/i.test(value);
}

function candidateScore(url, responseText) {
  const value = (String(url || "") + " " + String(responseText || "")).toLowerCase();
  let score = 1;
  if (/sign|check.?in|attendance|clock/.test(value)) score += 100;
  if (/签到|打卡/.test(value)) score += 100;
  if (/claim|receive|reward|award|领取|奖励/.test(value)) score += 50;
  if (/daily|task|日期|今日/.test(value)) score += 20;
  return score;
}

function responseMessage(body, fallback) {
  if (!body || typeof body !== "object") return String(fallback || "未知响应");
  const info = body.status_info || body.statusInfo || {};
  return String(
    body.status_msg || body.statusMessage || body.message || body.msg ||
    info.status_msg || info.message || fallback || "未知响应"
  );
}

function responseCode(body) {
  if (!body || typeof body !== "object") return "";
  const values = [body.status_code, body.statusCode, body.code, body.err_no, body.errNo];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== undefined && values[index] !== null) return String(values[index]);
  }
  return "";
}

function isSuccess(body, status) {
  const code = responseCode(body);
  if (body && body.success === true) return true;
  if (code) return code === "0" || code === "1000";
  return status >= 200 && status < 300;
}

function isAlreadyDone(body) {
  return /已签|已经签到|已打卡|已经打卡|已领取|重复|今日.*(?:完成|领取)/i.test(responseMessage(body, ""));
}

function isAuthError(body, status) {
  const code = responseCode(body);
  return status === 401 || status === 403 || code === "1000003" ||
    /未登录|登录.*失效|cookie|session|认证|鉴权|token.*(?:失效|过期)/i.test(responseMessage(body, ""));
}

function isSignatureError(body) {
  return /signature|签名|x-gorgon|x-khronos|x-ladon|timestamp|时间戳|过期请求/i.test(responseMessage(body, ""));
}

function captureRequest() {
  const request = $request || {};
  const url = String(request.url || "");
  const method = String(request.method || "GET").toUpperCase();
  const path = urlPath(url);

  if (path.indexOf(TREASURE_PATH) !== 0 || !isMutation(method) || isExcludedAction(path)) {
    finish({});
    return;
  }

  const responseText = String($response && $response.body || "");
  const current = readStore();
  const score = candidateScore(url, responseText);
  if (current && Number(current.score) > score && current.path !== path) {
    finish({});
    return;
  }

  const headers = normalizeHeaders(request.headers || {});
  const hasLogin = Boolean(headers.cookie || headers.authorization || headers["x-tt-token"] || headers["x-token"]);
  if (!hasLogin) {
    console.log("[" + SCRIPT_NAME + "] 候选请求缺少登录凭据，未保存：" + path);
    finish({});
    return;
  }

  const saved = {
    url: url,
    path: path,
    method: method,
    headers: replayHeaders(request.headers || {}),
    body: request.body === undefined || request.body === null ? "" : String(request.body),
    score: score,
    capturedAt: new Date().toISOString()
  };
  const changed = !current || current.url !== saved.url || current.body !== saved.body;
  writeStore(saved);

  if (changed) {
    const parsed = parseJson(responseText);
    notify(
      "签到请求获取成功 ✅",
      method + " " + path + "\n响应：" + responseMessage(parsed, "已保存，请手动运行测试")
    );
  }
  finish({});
}

function compactResponse(body, raw) {
  const message = responseMessage(body, "");
  if (message) return message;
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  return text.length > 180 ? text.slice(0, 180) + "…" : text || "接口未返回说明";
}

async function runTask() {
  const saved = readStore();
  if (!saved || !saved.url || !saved.method || !saved.headers) {
    notify(
      "尚未获取签到请求 ❌",
      "请开启重写和 MitM，进入汽水音乐“我的 → VIP 天天送”，手动点击当天日期签到",
      true
    );
    finish();
    return;
  }

  try {
    const request = {
      url: saved.url,
      method: saved.method,
      headers: replayHeaders(saved.headers)
    };
    if (saved.body) request.body = saved.body;

    const response = await $task.fetch(request);
    const status = Number(response.statusCode || response.status || 0);
    const raw = String(response.body || "");
    const body = parseJson(raw);

    if (isAuthError(body, status)) {
      notify("登录状态已失效 ❌", "请重新打开汽水音乐并手动签到一次以刷新请求", true);
    } else if (isSignatureError(body)) {
      notify("请求签名已过期 ❌", "该接口使用短时设备签名，需要重新抓包后再分析", true);
    } else if (isAlreadyDone(body)) {
      notify("今日已签到 ✅", compactResponse(body, raw));
    } else if (isSuccess(body, status)) {
      notify("签到请求执行成功 ✅", compactResponse(body, raw));
    } else {
      notify(
        "签到结果未确认 ⚠️",
        "HTTP " + status + (responseCode(body) ? " code=" + responseCode(body) : "") +
          "\n" + compactResponse(body, raw),
        true
      );
    }
  } catch (error) {
    notify("请求异常 ❌", String(error && error.message ? error.message : error), true);
  }
  finish();
}

if (typeof $request !== "undefined" && typeof $response !== "undefined") {
  captureRequest();
} else {
  runTask();
}
