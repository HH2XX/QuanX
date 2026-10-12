/**************************************
@Author: Sliverkiss
@Date: 2023-08-06 19:20:18
@Description:
亚朵酒店 App 签到、抽奖

本仓库仅整理 Quantumult X 配置，原作者：Sliverkiss。

2023.08.08 修复通知提示，新增抽奖任务

Version: 2.0.0
Updated: 2026-09-16
新增凭据校验、签到状态识别、分阶段失败通知。
修复 OPTIONS 预检被误保存为签到参数，并补齐抽奖请求体。
使用教程：
 1.合并 yaduo_signin.conf 中的 Quantumult X 配置
 2.打开亚朵酒店 App 的积分/签到页面并手动进入一次
 3.收到参数获取成功通知后关闭抓取规则

【Loon 参考配置】：
*************************
[Script]
cron "0 8 8 * * *" script-path=https://raw.githubusercontent.com/d539834401/QxSignUp/main/yaduo_signin.js, timeout=300, tag=亚朵酒店签到
http-request ^https:\/\/miniapp\.yaduo\.com\/atourlife\/signIn\/signIn.+ script-path=https://raw.githubusercontent.com/d539834401/QxSignUp/main/yaduo_signin.js, timeout=10, tag=亚朵获取请求参数
*************************

[MITM]
hostname =miniapp.yaduo.com

*************************
⚠️【免责声明】
------------------------------------------
1、此脚本仅用于学习研究，不保证其合法性、准确性、有效性，请根据情况自行判断，本人对此不承担任何保证责任。
2、由于此脚本仅用于学习研究，您必须在下载后 24 小时内将所有内容从您的计算机或手机或任何存储设备中完全删除，若违反规定引起任何事件本人对此均不负责。
3、请勿将此脚本用于任何商业或非法目的，若违反规定请自行对此负责。
4、此脚本涉及应用与本人无关，本人对因此引起的任何隐私泄漏或其他后果不承担任何责任。
5、本人对任何脚本引发的问题概不负责，包括但不限于由脚本错误引起的任何损失和损害。
6、如果任何单位或个人认为此脚本可能涉嫌侵犯其权利，应及时通知并提供身份证明，所有权证明，我们将在收到认证文件确认后删除此脚本。
7、所有直接或间接使用、查看此脚本的人均应该仔细阅读此声明。本人保留随时更改或补充此声明的权利。一旦您使用或复制了此脚本，即视为您已接受此免责声明。

******************************************/

// env.js 全局
const SCRIPT_NAME = "亚朵酒店签到";
const STORE_URL_KEY = "adjd_url";
const STORE_HEADER_KEY = "adjd_header";
const API_BASE = "https://miniapp.yaduo.com";
const SIGN_PATH = "/atourlife/signIn/signIn";
const LOTTERY_PATH = "/atourlife/signIn/lottery";
const $ = new Env(SCRIPT_NAME);

function finish(value) {
    $done(value === undefined ? {} : value);
}

function notify(subtitle, body) {
    $notify(SCRIPT_NAME, subtitle, body);
}

function normalizeHeaders(headers) {
    const result = {};
    Object.keys(headers || {}).forEach(function (key) {
        const value = headers[key];
        result[String(key).toLowerCase()] = Array.isArray(value)
            ? value.join(", ")
            : String(value);
    });
    return result;
}

function requestMethod() {
    return String(($request && $request.method) || "GET").toUpperCase();
}

function hasFreshSignInHeaders(headers) {
    const normalized = normalizeHeaders(headers);
    const required = [
        "at-client-code",
        "at-client-sign",
        "gentime",
        "passtoken",
        "captchaoutput",
        "lotnumber"
    ];
    return required.every(function (key) {
        const value = String(normalized[key] || "").trim();
        return value && !/^(?:undefined|null|none)$/i.test(value);
    });
}

function cleanQueryFromUrl(url) {
    const text = String(url || "").trim();
    const questionIndex = text.indexOf("?");
    if (questionIndex < 0) return "";
    return text.slice(questionIndex + 1).split("#")[0].replace(/^\?+/, "").trim();
}

function queryValue(query, name) {
    const pattern = new RegExp("(?:^|&)" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^&]*)", "i");
    const match = String(query || "").match(pattern);
    if (!match) return "";
    try {
        return decodeURIComponent(match[1].replace(/\+/g, " "));
    } catch (error) {
        return match[1];
    }
}

function readStoredHeaders() {
    const raw = $prefs.valueForKey(STORE_HEADER_KEY);
    if (!raw || /^(?:undefined|null|none)$/i.test(String(raw).trim())) return null;
    try {
        const headers = JSON.parse(raw);
        if (!headers || typeof headers !== "object" || Array.isArray(headers)) return null;
        return normalizeHeaders(headers);
    } catch (error) {
        console.log("[" + SCRIPT_NAME + "] 本地请求头解析失败：" + error);
        return null;
    }
}

function readProfile() {
    const query = String($prefs.valueForKey(STORE_URL_KEY) || "").trim()
        .replace(/^\?+/, "");
    const headers = readStoredHeaders();
    if (!query || !headers) return null;
    return { query: query, headers: headers };
}

function hasCredentialHint(query, headers) {
    const headerKeys = /authorization|token|cookie|session|openid|user[_-]?id|access|jwt|auth|ticket/i;
    const hasHeaderCredential = Object.keys(headers || {}).some(function (key) {
        const value = String(headers[key] || "").trim();
        return headerKeys.test(key) && value &&
            !/^(?:undefined|null|none)$/i.test(value);
    });
    const hasQueryCredential = String(query || "").split("&").some(function (part) {
        const pieces = part.split("=");
        const key = String(pieces.shift() || "");
        const value = pieces.join("=").trim();
        return headerKeys.test(key) && value &&
            !/^(?:undefined|null|none)$/i.test(value);
    });
    return hasHeaderCredential || hasQueryCredential;
}

function profileProblems(profile) {
    const problems = [];
    if (!profile || !String(profile.query || "").trim()) problems.push("URL 参数");
    if (!profile || !profile.headers || !Object.keys(profile.headers).length) {
        problems.push("请求头");
    } else if (!hasCredentialHint(profile.query, profile.headers)) {
        problems.push("Token/Cookie/Authorization");
    } else if (!hasFreshSignInHeaders(profile.headers)) {
        problems.push("Atour动态签名/极验参数");
    }
    return problems;
}

function sameProfile(previous, current) {
    if (!previous || !current) return false;
    return previous.query === current.query &&
        JSON.stringify(previous.headers) === JSON.stringify(current.headers);
}

function captureProfile() {
    // 亚朵签到前会先发 CORS OPTIONS 预检。预检里虽然带有 URL token，
    // 但没有真正签到所需的 At-Client-Sign 和极验参数，不能保存它。
    if (requestMethod() !== "GET") {
        console.log("[" + SCRIPT_NAME + "] 忽略非 GET 请求：" + requestMethod());
        finish({});
        return;
    }

    const url = String($request && $request.url || "");
    const query = cleanQueryFromUrl(url);
    const headers = normalizeHeaders(($request && $request.headers) || {});
    const current = { query: query, headers: headers };
    const problems = profileProblems(current);

    if (problems.length) {
        notify(
            "未获取到真实签到参数 ❌",
            "本次请求缺少：" + problems.join("、") +
            "\n请保持重写和 MitM 开启，完成验证后重新进入亚朵 App 的积分/签到页面"
        );
        finish({});
        return;
    }

    const previous = readProfile();
    const savedUrl = $prefs.setValueForKey(query, STORE_URL_KEY);
    const savedHeaders = $prefs.setValueForKey(JSON.stringify(headers), STORE_HEADER_KEY);
    if (!savedUrl || !savedHeaders) {
        notify(
            "Token保存失败 ❌",
            "已捕获请求，但无法写入 Quantumult X 本地持久化数据"
        );
        finish({});
        return;
    }

    if (!sameProfile(previous, current)) {
        notify(
            "Token获取成功 ✅",
            "亚朵签到请求参数已保存到 QX 本机\n" +
            "已保存 URL 参数和请求头，不会写入仓库"
        );
    } else {
        console.log("[" + SCRIPT_NAME + "] 登录参数未变化，已刷新本地保存");
    }
    finish({});
}

function requestHeaders(headers) {
    const result = {};
    Object.keys(headers || {}).forEach(function (key) {
        if (/^(?:host|content-length|connection|transfer-encoding)$/i.test(key)) return;
        result[key] = headers[key];
    });
    return result;
}

function requestApi(method, path, profile, extraQuery) {
    return new Promise(function (resolve, reject) {
        const baseQuery = profile.query ? "?" + profile.query : "";
        const suffix = extraQuery
            ? (baseQuery ? "&" : "?") + extraQuery
            : "";
        const options = {
            url: API_BASE + path + baseQuery + suffix,
            headers: requestHeaders(profile.headers)
        };

        // 当前抓包中的抽奖 POST 会发送 JSON 请求体；仅重放 URL 和请求头
        // 会让签到成功后的抽奖阶段返回业务错误。
        if (String(method).toUpperCase() === "POST" && path === LOTTERY_PATH) {
            const token = queryValue(profile.query, "token");
            if (token) {
                options.body = JSON.stringify({ token: token });
                const hasContentType = Object.keys(options.headers || {}).some(function (key) {
                    return String(key).toLowerCase() === "content-type";
                });
                if (!hasContentType) options.headers["content-type"] = "application/json";
            }
        }

        const callback = function (error, response, data) {
            if (error) {
                reject(new Error("网络请求失败：" + String(error)));
                return;
            }

            const status = Number(response && (response.statusCode || response.status) || 0);
            const raw = typeof data === "string"
                ? data
                : (data && typeof data === "object"
                    ? JSON.stringify(data)
                    : String(response && response.body || ""));
            let body;
            try {
                body = JSON.parse(raw || "{}");
            } catch (parseError) {
                const errorMessage = new Error(
                    "接口返回无法解析（HTTP " + status + "）：" +
                    String(raw || "").slice(0, 120)
                );
                errorMessage.httpStatus = status;
                reject(errorMessage);
                return;
            }

            if (status && (status < 200 || status >= 300)) {
                const errorMessage = new Error(
                    "HTTP " + status + "：" + responseMessage(body)
                );
                errorMessage.httpStatus = status;
                errorMessage.body = body;
                reject(errorMessage);
                return;
            }
            resolve({ status: status, body: body });
        };

        try {
            if (String(method).toUpperCase() === "POST") {
                $.post(options, callback);
            } else {
                $.get(options, callback);
            }
        } catch (error) {
            reject(new Error("请求启动失败：" + String(error)));
        }
    });
}

function responseData(body) {
    if (body && body.result !== undefined) return body.result;
    if (body && body.data !== undefined) return body.data;
    return body || {};
}

function responseCode(body) {
    const data = responseData(body);
    const values = [
        body && body.retcode,
        body && body.code,
        body && body.errcode,
        body && body.errorCode,
        data && !Array.isArray(data) && data.retcode,
        data && !Array.isArray(data) && data.code
    ];
    for (let index = 0; index < values.length; index += 1) {
        if (values[index] !== undefined && values[index] !== null && values[index] !== "") {
            return String(values[index]);
        }
    }
    return "";
}

function responseMessage(body) {
    const data = responseData(body);
    const result = body && body.result;
    const values = [
        body && body.retmsg,
        body && body.msg,
        body && body.message,
        body && body.errmsg,
        body && body.text,
        result && !Array.isArray(result) && result.debrisDesc,
        result && !Array.isArray(result) && result.message,
        data && !Array.isArray(data) && data.debrisDesc,
        data && !Array.isArray(data) && data.message
    ];
    for (let index = 0; index < values.length; index += 1) {
        const text = String(values[index] || "").trim();
        if (text && !/^(?:undefined|null)$/i.test(text)) return text;
    }
    return "未知错误";
}

function safeString(value) {
    try {
        return JSON.stringify(value || {});
    } catch (error) {
        return "";
    }
}

function booleanLike(value) {
    return value === true || value === 1 || value === "1" || /^(?:true|yes)$/i.test(String(value || ""));
}

function isSuccess(body) {
    const code = responseCode(body).toLowerCase();
    return body && (body.success === true || body.ok === true) ||
        code === "0" || code === "200" || code === "s0a00000";
}

function isAuthError(body, status) {
    const code = responseCode(body);
    return status === 401 || status === 403 || status === 419 ||
        /^(?:-?401|-?403|1001)$/i.test(code) ||
        /未登录|需要登录|登录.*(?:失效|过期|拒绝)|token.*(?:失效|过期|拒绝)|cookie.*(?:失效|过期|拒绝)|session.*(?:失效|过期|拒绝)|(?:鉴权|授权|认证).*(?:失败|失效|过期|拒绝|错误)/i.test(responseMessage(body));
}

function isAlreadySigned(body) {
    const data = responseData(body);
    const flags = [
        body && body.isSignedToday,
        body && body.signedToday,
        body && body.isSignIn,
        body && body.isSignin,
        body && body.hasSignIn,
        data && !Array.isArray(data) && data.isSignedToday,
        data && !Array.isArray(data) && data.signedToday,
        data && !Array.isArray(data) && data.isSignIn,
        data && !Array.isArray(data) && data.isSignin,
        data && !Array.isArray(data) && data.hasSignIn
    ];
    if (flags.some(booleanLike)) return true;

    const text = responseMessage(body) + " " + safeString(body);
    return /(?:今日|今天)[^。！？\n]{0,12}(?:已签|签到过|签到完成)|(?:已经|已)签到|重复签到|签到过|请明日再来/i.test(text);
}

function isAlreadyLottery(body) {
    const data = responseData(body);
    const flags = [
        body && body.isDrawToday,
        body && body.drawnToday,
        body && body.isLotteryToday,
        data && !Array.isArray(data) && data.isDrawToday,
        data && !Array.isArray(data) && data.drawnToday,
        data && !Array.isArray(data) && data.isLotteryToday
    ];
    if (flags.some(booleanLike)) return true;

    const text = responseMessage(body) + " " + safeString(body);
    return /(?:今日|今天)[^。！？\n]{0,12}(?:已抽|抽奖.*完成|抽奖过|已领取)|(?:已经|已)抽奖|重复抽奖|抽奖过/i.test(text);
}

function resultCodeText(body, status) {
    const code = responseCode(body);
    return "HTTP " + (status || 0) +
        (code ? " code=" + code : "") +
        "：" + responseMessage(body);
}

function signDescription(body) {
    const data = responseData(body);
    const result = body && body.result;
    const values = [
        result && !Array.isArray(result) && result.debrisDesc,
        result && !Array.isArray(result) && result.signDesc,
        data && !Array.isArray(data) && data.debrisDesc,
        data && !Array.isArray(data) && data.signDesc,
        body && body.rewardDesc
    ];
    for (let index = 0; index < values.length; index += 1) {
        const text = String(values[index] || "").trim();
        if (text) return text;
    }
    return "接口返回成功";
}

function lotteryItems(body) {
    const data = responseData(body);
    const candidates = [
        body && body.result,
        data,
        data && !Array.isArray(data) && data.list,
        data && !Array.isArray(data) && data.prizes,
        data && !Array.isArray(data) && data.lotteryList,
        data && !Array.isArray(data) && data.awards
    ];
    for (let index = 0; index < candidates.length; index += 1) {
        if (Array.isArray(candidates[index])) return candidates[index];
    }
    return [];
}

function lotteryPrize(body) {
    const data = responseData(body);
    const direct = data && !Array.isArray(data) && (
        data.prizeName || data.name || data.prizeDesc
    );
    if (direct) return String(direct);

    const items = lotteryItems(body);
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index] || {};
        if (booleanLike(item.selected) || booleanLike(item.isSelected) ||
            booleanLike(item.chosen) || booleanLike(item.choose)) {
            return String(item.prizeName || item.name || item.prizeDesc || "中奖结果未命名");
        }
    }
    return "";
}

function drawIndex() {
    const configured = String($.getdata("adjd_draw") || "").trim();
    if (/^[0-5]$/.test(configured)) return Number(configured);
    return Math.floor(Math.random() * 6);
}

function stageResult(kind, detail, body, status) {
    return {
        kind: kind,
        detail: detail || "",
        code: responseCode(body),
        status: status || 0
    };
}

async function signIn(profile) {
    const response = await requestApi("GET", SIGN_PATH, profile);
    if (isAuthError(response.body, response.status)) {
        return stageResult("auth", responseMessage(response.body), response.body, response.status);
    }
    if (isAlreadySigned(response.body)) {
        return stageResult("already", responseMessage(response.body), response.body, response.status);
    }
    if (!isSuccess(response.body)) {
        return stageResult("failed", resultCodeText(response.body, response.status), response.body, response.status);
    }
    return stageResult("success", signDescription(response.body), response.body, response.status);
}

async function lottery(profile) {
    const response = await requestApi("POST", LOTTERY_PATH, profile, "code=" + drawIndex());
    if (isAuthError(response.body, response.status)) {
        return stageResult("auth", responseMessage(response.body), response.body, response.status);
    }
    if (isAlreadyLottery(response.body)) {
        return stageResult("already", responseMessage(response.body), response.body, response.status);
    }
    if (!isSuccess(response.body)) {
        return stageResult("failed", resultCodeText(response.body, response.status), response.body, response.status);
    }

    const prize = lotteryPrize(response.body);
    if (!prize) {
        return stageResult(
            "failed",
            "接口返回成功，但未找到中奖结果（可能接口结构已变化）",
            response.body,
            response.status
        );
    }
    return stageResult("success", prize, response.body, response.status);
}

function errorDetail(error) {
    const text = String(error && error.message ? error.message : error);
    return text.length > 240 ? text.slice(0, 240) + "…" : text;
}

function signLine(result) {
    if (result.kind === "already") return "签到：今日已签到";
    return "签到：成功" + (result.detail ? "（" + result.detail + "）" : "");
}

function lotteryLine(result) {
    if (result.kind === "already") return "抽奖：今日已抽奖";
    return "抽奖：成功，奖品：" + result.detail;
}

async function runTask() {
    const profile = readProfile();
    const problems = profileProblems(profile);
    if (problems.length) {
        notify(
            "未获取到Token/登录参数 ❌",
            "缺少：" + problems.join("、") +
            "\n请开启重写和 MitM，重新打开亚朵 App 的积分/签到页面"
        );
        finish();
        return;
    }

    let signResult;
    try {
        signResult = await signIn(profile);
    } catch (error) {
        notify("签到失败 ❌", "原因：" + errorDetail(error) + "\n请先确认登录参数仍有效");
        finish();
        return;
    }

    if (signResult.kind === "auth") {
        notify(
            "Token已失效 ❌",
            "签到接口拒绝请求：" + signResult.detail +
            "\n请重新打开亚朵 App 的积分/签到页面抓取参数"
        );
        finish();
        return;
    }

    if (signResult.kind === "failed") {
        notify("签到失败 ❌", "原因：" + signResult.detail);
        finish();
        return;
    }

    let lotteryResult;
    try {
        lotteryResult = await lottery(profile);
    } catch (error) {
        lotteryResult = stageResult("failed", "原因：" + errorDetail(error), null, 0);
    }

    const signText = signLine(signResult);
    if (lotteryResult.kind === "auth") {
        notify(
            signResult.kind === "already"
                ? "今日已签到，但抽奖失败 ⚠️"
                : "签到成功，但抽奖失败 ⚠️",
            signText +
            "\n抽奖：Token/登录状态失效" +
            (lotteryResult.detail ? "（" + lotteryResult.detail + "）" : "") +
            "\n请重新打开亚朵 App 的积分/签到页面抓取参数"
        );
        finish();
        return;
    }

    if (lotteryResult.kind === "failed") {
        notify(
            signResult.kind === "already"
                ? "今日已签到，但抽奖失败 ⚠️"
                : "签到成功，但抽奖失败 ⚠️",
            signText + "\n抽奖失败：" + lotteryResult.detail
        );
        finish();
        return;
    }

    notify(
        signResult.kind === "already" ? "今日已签到 ✅" : "签到成功 🎉",
        signText + "\n" + lotteryLine(lotteryResult)
    );
    finish();
}

if (typeof $request !== "undefined" && $request && $request.url) {
    captureProfile();
} else {
    runTask();
}

/** ---------------------------------固定不动区域----------------------------------------- */

//From chavyleung's Env.js
function Env(name, opts) {
    class Http {
        constructor(env) {
            this.env = env;
        }

        send(opts, method = "GET") {
            opts = typeof opts === "string" ? { url: opts } : opts;
            let sender = this.get;
            if (method === "POST") {
                sender = this.post;
            }
            return new Promise((resolve, reject) => {
                sender.call(this, opts, (err, resp, body) => {
                    if (err) reject(err);
                    else resolve(resp);
                });
            });
        }

        get(opts) {
            return this.send.call(this.env, opts);
        }

        post(opts) {
            return this.send.call(this.env, opts, "POST");
        }
    }

    return new (class {
        constructor(name, opts) {
            this.name = name;
            this.http = new Http(this);
            this.data = null;
            this.dataFile = "box.dat";
            this.logs = [];
            this.isMute = false;
            this.isNeedRewrite = false;
            this.logSeparator = "\n";
            this.startTime = new Date().getTime();
            Object.assign(this, opts);
            this.log("", `🔔${this.name}, 开始!`);
        }

        isNode() {
            return "undefined" !== typeof module && !!module.exports;
        }

        isQuanX() {
            return "undefined" !== typeof $task;
        }

        isSurge() {
            return "undefined" !== typeof $httpClient && "undefined" === typeof $loon;
        }

        isLoon() {
            return "undefined" !== typeof $loon;
        }

        toObj(str, defaultValue = null) {
            try {
                return JSON.parse(str);
            } catch {
                return defaultValue;
            }
        }

        toStr(obj, defaultValue = null) {
            try {
                return JSON.stringify(obj);
            } catch {
                return defaultValue;
            }
        }

        getjson(key, defaultValue) {
            let json = defaultValue;
            const val = this.getdata(key);
            if (val) {
                try {
                    json = JSON.parse(this.getdata(key));
                } catch { }
            }
            return json;
        }

        setjson(val, key) {
            try {
                return this.setdata(JSON.stringify(val), key);
            } catch {
                return false;
            }
        }

        getScript(url) {
            return new Promise((resolve) => {
                this.get({ url }, (err, resp, body) => resolve(body));
            });
        }

        runScript(script, runOpts) {
            return new Promise((resolve) => {
                let httpapi = this.getdata("@chavy_boxjs_userCfgs.httpapi");
                httpapi = httpapi ? httpapi.replace(/\n/g, "").trim() : httpapi;
                let httpapi_timeout = this.getdata(
                    "@chavy_boxjs_userCfgs.httpapi_timeout"
                );
                httpapi_timeout = httpapi_timeout ? httpapi_timeout * 1 : 20;
                httpapi_timeout =
                    runOpts && runOpts.timeout ? runOpts.timeout : httpapi_timeout;
                const [key, addr] = httpapi.split("@");
                const opts = {
                    url: `http://${addr}/v1/scripting/evaluate`,
                    body: {
                        script_text: script,
                        mock_type: "cron",
                        timeout: httpapi_timeout,
                    },
                    headers: { "X-Key": key, Accept: "*/*" },
                };
                this.post(opts, (err, resp, body) => resolve(body));
            }).catch((e) => this.logErr(e));
        }

        loaddata() {
            if (this.isNode()) {
                this.fs = this.fs ? this.fs : require("fs");
                this.path = this.path ? this.path : require("path");
                const curDirDataFilePath = this.path.resolve(this.dataFile);
                const rootDirDataFilePath = this.path.resolve(
                    process.cwd(),
                    this.dataFile
                );
                const isCurDirDataFile = this.fs.existsSync(curDirDataFilePath);
                const isRootDirDataFile =
                    !isCurDirDataFile && this.fs.existsSync(rootDirDataFilePath);
                if (isCurDirDataFile || isRootDirDataFile) {
                    const datPath = isCurDirDataFile
                        ? curDirDataFilePath
                        : rootDirDataFilePath;
                    try {
                        return JSON.parse(this.fs.readFileSync(datPath));
                    } catch (e) {
                        return {};
                    }
                } else return {};
            } else return {};
        }

        writedata() {
            if (this.isNode()) {
                this.fs = this.fs ? this.fs : require("fs");
                this.path = this.path ? this.path : require("path");
                const curDirDataFilePath = this.path.resolve(this.dataFile);
                const rootDirDataFilePath = this.path.resolve(
                    process.cwd(),
                    this.dataFile
                );
                const isCurDirDataFile = this.fs.existsSync(curDirDataFilePath);
                const isRootDirDataFile =
                    !isCurDirDataFile && this.fs.existsSync(rootDirDataFilePath);
                const jsondata = JSON.stringify(this.data);
                if (isCurDirDataFile) {
                    this.fs.writeFileSync(curDirDataFilePath, jsondata);
                } else if (isRootDirDataFile) {
                    this.fs.writeFileSync(rootDirDataFilePath, jsondata);
                } else {
                    this.fs.writeFileSync(curDirDataFilePath, jsondata);
                }
            }
        }

        lodash_get(source, path, defaultValue = undefined) {
            const paths = path.replace(/\[(\d+)\]/g, ".$1").split(".");
            let result = source;
            for (const p of paths) {
                result = Object(result)[p];
                if (result === undefined) {
                    return defaultValue;
                }
            }
            return result;
        }

        lodash_set(obj, path, value) {
            if (Object(obj) !== obj) return obj;
            if (!Array.isArray(path)) path = path.toString().match(/[^.[\]]+/g) || [];
            path
                .slice(0, -1)
                .reduce(
                    (a, c, i) =>
                        Object(a[c]) === a[c]
                            ? a[c]
                            : (a[c] = Math.abs(path[i + 1]) >> 0 === +path[i + 1] ? [] : {}),
                    obj
                )[path[path.length - 1]] = value;
            return obj;
        }

        getdata(key) {
            let val = this.getval(key);
            // 如果以 @
            if (/^@/.test(key)) {
                const [, objkey, paths] = /^@(.*?)\.(.*?)$/.exec(key);
                const objval = objkey ? this.getval(objkey) : "";
                if (objval) {
                    try {
                        const objedval = JSON.parse(objval);
                        val = objedval ? this.lodash_get(objedval, paths, "") : val;
                    } catch (e) {
                        val = "";
                    }
                }
            }
            return val;
        }

        setdata(val, key) {
            let issuc = false;
            if (/^@/.test(key)) {
                const [, objkey, paths] = /^@(.*?)\.(.*?)$/.exec(key);
                const objdat = this.getval(objkey);
                const objval = objkey
                    ? objdat === "null"
                        ? null
                        : objdat || "{}"
                    : "{}";
                try {
                    const objedval = JSON.parse(objval);
                    this.lodash_set(objedval, paths, val);
                    issuc = this.setval(JSON.stringify(objedval), objkey);
                } catch (e) {
                    const objedval = {};
                    this.lodash_set(objedval, paths, val);
                    issuc = this.setval(JSON.stringify(objedval), objkey);
                }
            } else {
                issuc = this.setval(val, key);
            }
            return issuc;
        }

        getval(key) {
            if (this.isSurge() || this.isLoon()) {
                return $persistentStore.read(key);
            } else if (this.isQuanX()) {
                return $prefs.valueForKey(key);
            } else if (this.isNode()) {
                this.data = this.loaddata();
                return this.data[key];
            } else {
                return (this.data && this.data[key]) || null;
            }
        }

        setval(val, key) {
            if (this.isSurge() || this.isLoon()) {
                return $persistentStore.write(val, key);
            } else if (this.isQuanX()) {
                return $prefs.setValueForKey(val, key);
            } else if (this.isNode()) {
                this.data = this.loaddata();
                this.data[key] = val;
                this.writedata();
                return true;
            } else {
                return (this.data && this.data[key]) || null;
            }
        }

        initGotEnv(opts) {
            this.got = this.got ? this.got : require("got");
            this.cktough = this.cktough ? this.cktough : require("tough-cookie");
            this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar();
            if (opts) {
                opts.headers = opts.headers ? opts.headers : {};
                if (undefined === opts.headers.Cookie && undefined === opts.cookieJar) {
                    opts.cookieJar = this.ckjar;
                }
            }
        }

        get(opts, callback = () => { }) {
            if (opts.headers) {
                delete opts.headers["Content-Type"];
                delete opts.headers["Content-Length"];
            }
            if (this.isSurge() || this.isLoon()) {
                if (this.isSurge() && this.isNeedRewrite) {
                    opts.headers = opts.headers || {};
                    Object.assign(opts.headers, { "X-Surge-Skip-Scripting": false });
                }
                $httpClient.get(opts, (err, resp, body) => {
                    if (!err && resp) {
                        resp.body = body;
                        resp.statusCode = resp.status;
                    }
                    callback(err, resp, body);
                });
            } else if (this.isQuanX()) {
                if (this.isNeedRewrite) {
                    opts.opts = opts.opts || {};
                    Object.assign(opts.opts, { hints: false });
                }
                $task.fetch(opts).then(
                    (resp) => {
                        const { statusCode: status, statusCode, headers, body } = resp;
                        callback(null, { status, statusCode, headers, body }, body);
                    },
                    (err) => callback(err)
                );
            } else if (this.isNode()) {
                this.initGotEnv(opts);
                this.got(opts)
                    .on("redirect", (resp, nextOpts) => {
                        try {
                            if (resp.headers["set-cookie"]) {
                                const ck = resp.headers["set-cookie"]
                                    .map(this.cktough.Cookie.parse)
                                    .toString();
                                if (ck) {
                                    this.ckjar.setCookieSync(ck, null);
                                }
                                nextOpts.cookieJar = this.ckjar;
                            }
                        } catch (e) {
                            this.logErr(e);
                        }
                        // this.ckjar.setCookieSync(resp.headers['set-cookie'].map(Cookie.parse).toString())
                    })
                    .then(
                        (resp) => {
                            const { statusCode: status, statusCode, headers, body } = resp;
                            callback(null, { status, statusCode, headers, body }, body);
                        },
                        (err) => {
                            const { message: error, response: resp } = err;
                            callback(error, resp, resp && resp.body);
                        }
                    );
            }
        }

        post(opts, callback = () => { }) {
            // 如果指定了请求体, 但没指定`Content-Type`, 则自动生成
            if (opts.body && opts.headers && !opts.headers["Content-Type"]) {
                opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
            }
            if (opts.headers) delete opts.headers["Content-Length"];
            if (this.isSurge() || this.isLoon()) {
                if (this.isSurge() && this.isNeedRewrite) {
                    opts.headers = opts.headers || {};
                    Object.assign(opts.headers, { "X-Surge-Skip-Scripting": false });
                }
                $httpClient.post(opts, (err, resp, body) => {
                    if (!err && resp) {
                        resp.body = body;
                        resp.statusCode = resp.status;
                    }
                    callback(err, resp, body);
                });
            } else if (this.isQuanX()) {
                opts.method = "POST";
                if (this.isNeedRewrite) {
                    opts.opts = opts.opts || {};
                    Object.assign(opts.opts, { hints: false });
                }
                $task.fetch(opts).then(
                    (resp) => {
                        const { statusCode: status, statusCode, headers, body } = resp;
                        callback(null, { status, statusCode, headers, body }, body);
                    },
                    (err) => callback(err)
                );
            } else if (this.isNode()) {
                this.initGotEnv(opts);
                const { url, ..._opts } = opts;
                this.got.post(url, _opts).then(
                    (resp) => {
                        const { statusCode: status, statusCode, headers, body } = resp;
                        callback(null, { status, statusCode, headers, body }, body);
                    },
                    (err) => {
                        const { message: error, response: resp } = err;
                        callback(error, resp, resp && resp.body);
                    }
                );
            }
        }
        /**
         *
         * 示例:$.time('yyyy-MM-dd qq HH:mm:ss.S')
         *    :$.time('yyyyMMddHHmmssS')
         *    y:年 M:月 d:日 q:季 H:时 m:分 s:秒 S:毫秒
         *    其中y可选0-4位占位符、S可选0-1位占位符，其余可选0-2位占位符
         * @param {string} fmt 格式化参数
         * @param {number} 可选: 根据指定时间戳返回格式化日期
         *
         */
        time(fmt, ts = null) {
            const date = ts ? new Date(ts) : new Date();
            let o = {
                "M+": date.getMonth() + 1,
                "d+": date.getDate(),
                "H+": date.getHours(),
                "m+": date.getMinutes(),
                "s+": date.getSeconds(),
                "q+": Math.floor((date.getMonth() + 3) / 3),
                S: date.getMilliseconds(),
            };
            if (/(y+)/.test(fmt))
                fmt = fmt.replace(
                    RegExp.$1,
                    (date.getFullYear() + "").substr(4 - RegExp.$1.length)
                );
            for (let k in o)
                if (new RegExp("(" + k + ")").test(fmt))
                    fmt = fmt.replace(
                        RegExp.$1,
                        RegExp.$1.length == 1
                            ? o[k]
                            : ("00" + o[k]).substr(("" + o[k]).length)
                    );
            return fmt;
        }

        /**
         * 系统通知
         *
         * > 通知参数: 同时支持 QuanX 和 Loon 两种格式, EnvJs根据运行环境自动转换, Surge 环境不支持多媒体通知
         *
         * 示例:
         * $.msg(title, subt, desc, 'twitter://')
         * $.msg(title, subt, desc, { 'open-url': 'twitter://', 'media-url': 'https://github.githubassets.com/images/modules/open_graph/github-mark.png' })
         * $.msg(title, subt, desc, { 'open-url': 'https://bing.com', 'media-url': 'https://github.githubassets.com/images/modules/open_graph/github-mark.png' })
         *
         * @param {*} title 标题
         * @param {*} subt 副标题
         * @param {*} desc 通知详情
         * @param {*} opts 通知参数
         *
         */
        msg(title = name, subt = "", desc = "", opts) {
            const toEnvOpts = (rawopts) => {
                if (!rawopts) return rawopts;
                if (typeof rawopts === "string") {
                    if (this.isLoon()) return rawopts;
                    else if (this.isQuanX()) return { "open-url": rawopts };
                    else if (this.isSurge()) return { url: rawopts };
                    else return undefined;
                } else if (typeof rawopts === "object") {
                    if (this.isLoon()) {
                        let openUrl = rawopts.openUrl || rawopts.url || rawopts["open-url"];
                        let mediaUrl = rawopts.mediaUrl || rawopts["media-url"];
                        return { openUrl, mediaUrl };
                    } else if (this.isQuanX()) {
                        let openUrl = rawopts["open-url"] || rawopts.url || rawopts.openUrl;
                        let mediaUrl = rawopts["media-url"] || rawopts.mediaUrl;
                        return { "open-url": openUrl, "media-url": mediaUrl };
                    } else if (this.isSurge()) {
                        let openUrl = rawopts.url || rawopts.openUrl || rawopts["open-url"];
                        return { url: openUrl };
                    }
                } else {
                    return undefined;
                }
            };
            if (!this.isMute) {
                if (this.isSurge() || this.isLoon()) {
                    $notification.post(title, subt, desc, toEnvOpts(opts));
                } else if (this.isQuanX()) {
                    $notify(title, subt, desc, toEnvOpts(opts));
                }
            }
            if (!this.isMuteLog) {
                let logs = ["", "==============📣系统通知📣=============="];
                logs.push(title);
                subt ? logs.push(subt) : "";
                desc ? logs.push(desc) : "";
                console.log(logs.join("\n"));
                this.logs = this.logs.concat(logs);
            }
        }

        log(...logs) {
            if (logs.length > 0) {
                this.logs = [...this.logs, ...logs];
            }
            console.log(logs.join(this.logSeparator));
        }

        logErr(err, msg) {
            const isPrintSack = !this.isSurge() && !this.isQuanX() && !this.isLoon();
            if (!isPrintSack) {
                this.log("", `❗️${this.name}, 错误!`, err);
            } else {
                this.log("", `❗️${this.name}, 错误!`, err.stack);
            }
        }

        wait(time) {
            return new Promise((resolve) => setTimeout(resolve, time));
        }

        done(val = {}) {
            const endTime = new Date().getTime();
            const costTime = (endTime - this.startTime) / 1000;
            this.log("", `🔔${this.name}, 结束! 🕛 ${costTime} 秒`);
            this.log();
            if (this.isSurge() || this.isQuanX() || this.isLoon()) {
                $done(val);
            }
        }
    })(name, opts);
}
