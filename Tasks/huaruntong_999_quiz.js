/**
 * 华润通 · 999 每日答题（Quantumult X）
 *
 * 功能：
 * 1. 打开「999会员中心」的健康答题/每日一题页面时，保存独立 token、手机号和必要请求头。
 * 2. 定时运行时获取当天题目，从接口返回的 right 标记中提取正确选项并提交。
 * 3. 登录凭据只保存在 Quantumult X 本机的 $prefs 中。
 *
 * [rewrite_local]
 * ^https:\/\/api4\.jiankangyouyi\.com\/base-data\/v1\/api\/gadgets\/(?:business-knowledge-challenges|knowledge-challenges\/user-choice)(?:\?[^#]*bizType=160107[^#]*)?$ url script-request-header https://raw.githubusercontent.com/d539834401/QxSignUp/main/huaruntong_999_quiz.js
 *
 * [task_local]
 * 25 7 * * * https://raw.githubusercontent.com/d539834401/QxSignUp/main/huaruntong_999_quiz.js, tag=华润通·999答题, enabled=true
 *
 * [mitm]
 * hostname = %APPEND% api4.jiankangyouyi.com
 *
 * 首次使用：开启重写和 MitM，在微信中打开「999会员中心」，进入健康答题或
 * 每日一题页面。收到“参数获取成功”通知后，在任务列表中手动运行一次测试。
 *
 * Version: 1.0.0
 * Updated: 2026-09-06
 * API reference: https://github.com/Cat-zaizai/ZaiZaiCat-Checkin/tree/main/script/huaruntong/999
 */

const SCRIPT_NAME = "华润通·999答题";
const STORE_KEY = "huaruntong_999_quiz_profile_v1";
const API_BASE = "https://api4.jiankangyouyi.com/base-data/v1/api/gadgets";
const BIZ_TYPE = "160107";
const ENTRANCE = "huarun-sj-mryt";
const REWARD_CUSTOMER = "050205";
const REWARD_PARAM = "huarun-sanjiu-prointsRewardScore";
const OPEN_URL = "weixin://";
const DEFAULT_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.76 MiniProgramEnv/iOS";

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
    console.log("[" + SCRIPT_NAME + "] 本地配置解析失败：" + error);
    return null;
  }
}

function writeStore(value) {
  return $prefs.setValueForKey(JSON.stringify(value), STORE_KEY);
}

function validToken(value) {
  const token = String(value || "").trim();
  return token.length >= 8 && !/^(?:undefined|null|none|invalid)$/i.test(token) ? token : "";
}

function validMobile(value) {
  const mobile = String(value || "").replace(/\s+/g, "");
  return /^1\d{10}$/.test(mobile) ? mobile : "";
}

function captureProfile() {
  const headers = normalizeHeaders($request.headers || {});
  const customData = parseJson(headers.customdata) || {};
  const previous = readStore() || {};
  const token = validToken(headers.token || headers.authorization || previous.token);
  const mobile = validMobile(customData.mobile || headers.mobile || previous.mobile);

  if (!token || !mobile) {
    console.log("[" + SCRIPT_NAME + "] 当前请求缺少 token 或手机号，未保存");
    finish({});
    return;
  }

  const profile = {
    token: token,
    mobile: mobile,
    userAgent: headers["user-agent"] || previous.userAgent || DEFAULT_USER_AGENT,
    origin: headers.origin || previous.origin || "https://apps.jiankangyouyi.com",
    referer: headers.referer || previous.referer || "https://apps.jiankangyouyi.com/",
    capturedAt: new Date().toISOString()
  };
  const changed = previous.token !== profile.token || previous.mobile !== profile.mobile;
  writeStore(profile);

  if (changed) {
    notify("参数获取成功 ✅", "999 每日答题凭据已安全保存到本机");
  } else {
    console.log("[" + SCRIPT_NAME + "] 参数未变化，已刷新本地保存时间");
  }
  finish({});
}

function buildHeaders(profile) {
  return {
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "token": profile.token,
    "customdata": JSON.stringify({
      mobile: profile.mobile,
      point: 5,
      entrance: ENTRANCE
    }),
    "Origin": profile.origin || "https://apps.jiankangyouyi.com",
    "Referer": profile.referer || "https://apps.jiankangyouyi.com/",
    "User-Agent": profile.userAgent || DEFAULT_USER_AGENT,
    "Accept-Language": "zh-CN,zh-Hans;q=0.9"
  };
}

function responseCode(response) {
  if (!response || response.resultCode === undefined || response.resultCode === null) return "";
  return String(response.resultCode);
}

function responseMessage(response) {
  return String(response && (response.message || response.msg || response.text) || "未知错误");
}

function isSuccess(response) {
  return responseCode(response) === "0";
}

function isAuthError(response) {
  const code = responseCode(response);
  return code === "100402" || code === "401" || code === "403" ||
    /token|登录|鉴权|授权|认证|过期|失效/i.test(responseMessage(response));
}

function isAlreadyCompleted(response) {
  return /已答|已经|重复|今日.*完成|已完成|已领取|不能重复/i.test(responseMessage(response));
}

async function postApi(path, data, profile) {
  const response = await $task.fetch({
    url: API_BASE + path + "?bizType=" + BIZ_TYPE,
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
    const httpError = new Error("HTTP " + status + "：" + responseMessage(body));
    httpError.response = body;
    throw httpError;
  }
  return body;
}

function questionData(response) {
  return response && response.data && response.data.knowledgeQuestionData || null;
}

function questionText(question) {
  const contents = question && question.question && question.question.questionContents;
  return Array.isArray(contents) && contents.length ? String(contents[0]) : "今日题目";
}

function optionIsRight(option) {
  const value = option && option.right;
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function correctOptions(question) {
  const options = question && question.question && question.question.options;
  if (!Array.isArray(options)) return [];
  return options.filter(optionIsRight).map(function (option) {
    return {
      code: String(option.optionCode || ""),
      text: Array.isArray(option.optionContents) && option.optionContents.length
        ? String(option.optionContents[0])
        : ""
    };
  }).filter(function (option) {
    return option.code;
  });
}

function rewardPoints(response) {
  const data = response && response.data;
  const candidates = [
    data && data.points,
    data && data.point,
    data && data.score,
    data && data.rewardScore,
    response && response.points,
    response && response.point
  ];
  for (let index = 0; index < candidates.length; index += 1) {
    const number = Number(candidates[index]);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

async function getQuestion(profile) {
  return postApi("/business-knowledge-challenges", {
    userId: profile.mobile,
    strategy: "1",
    customerParams: [REWARD_PARAM],
    customers: [REWARD_CUSTOMER],
    configId: ""
  }, profile);
}

async function submitAnswer(questionId, optionCodes, profile) {
  return postApi("/knowledge-challenges/user-choice", {
    userId: profile.mobile,
    questionId: questionId,
    userOptionCodes: optionCodes,
    customerParams: [REWARD_PARAM],
    mobile: profile.mobile,
    configId: ""
  }, profile);
}

async function runTask() {
  const profile = readStore();
  if (!profile || !validToken(profile.token) || !validMobile(profile.mobile)) {
    notify(
      "尚未获取登录参数 ❌",
      "请开启重写与 MitM，然后进入微信小程序「999会员中心」的健康答题/每日一题页面",
      true
    );
    finish();
    return;
  }

  try {
    const questionResponse = await getQuestion(profile);
    if (isAuthError(questionResponse)) {
      notify("登录状态已失效 ❌", "请重新进入 999 每日答题页面刷新参数", true);
      finish();
      return;
    }
    if (isAlreadyCompleted(questionResponse)) {
      notify("今日已完成 ✅", responseMessage(questionResponse));
      finish();
      return;
    }
    if (!isSuccess(questionResponse)) {
      notify("获取题目失败 ❌", "code=" + responseCode(questionResponse) + " " + responseMessage(questionResponse), true);
      finish();
      return;
    }

    const question = questionData(questionResponse);
    if (!question || !question.questionId) {
      notify("暂无可答题目", responseMessage(questionResponse));
      finish();
      return;
    }

    const answers = correctOptions(question);
    if (!answers.length) {
      notify("未找到正确答案 ❌", questionText(question), true);
      finish();
      return;
    }

    const submitted = await submitAnswer(
      String(question.questionId),
      answers.map(function (answer) { return answer.code; }),
      profile
    );
    if (isAuthError(submitted)) {
      notify("登录状态已失效 ❌", "请重新进入 999 每日答题页面刷新参数", true);
      finish();
      return;
    }
    if (isAlreadyCompleted(submitted)) {
      notify("今日已完成 ✅", responseMessage(submitted));
      finish();
      return;
    }
    if (!isSuccess(submitted)) {
      notify("提交答案失败 ❌", "code=" + responseCode(submitted) + " " + responseMessage(submitted), true);
      finish();
      return;
    }

    const points = rewardPoints(submitted);
    const lines = [questionText(question)];
    lines.push("答案：" + answers.map(function (answer) {
      return answer.code + (answer.text ? " " + answer.text : "");
    }).join("、"));
    lines.push("奖励：" + (points === null ? "以华润通到账为准" : points + " 积分"));
    notify("答题成功 🎉", lines.join("\n"));
    finish();
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (/HTTP (401|403)|token|登录|鉴权|授权|认证|过期|失效/i.test(message)) {
      notify("登录状态已失效 ❌", "请重新进入 999 每日答题页面刷新参数", true);
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
