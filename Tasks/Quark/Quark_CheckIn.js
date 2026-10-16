/**
 * 夸克网盘自动签到 - Quantumult X
 *
 * 功能:
 * 1. 首次打开夸克网盘 App，自动抓取 kps / sign / vcode 并保存
 * 2. 每日定时任务自动签到（可领成长空间）
 * 3. 通知展示签到结果与容量信息
 *
 * ==================== 配置 ====================
 *
 * [rewrite_local]
 * # 抓取夸克网盘签到参数（打开 App 任意页面即可）
 * ^https:\/\/drive(-h)?\.quark\.cn\/1\/clouddrive\/ url script-request-header https://raw.githubusercontent.com/carlleilzj/Quark_CheckIn_QX/main/Quark_CheckIn.js
 *
 * [task_local]
 * # 每天 9:00 自动签到（可自行改时间）
 * 0 9 * * * https://raw.githubusercontent.com/carlleilzj/Quark_CheckIn_QX/main/Quark_CheckIn.js, tag=夸克网盘签到, img-url=https://qkimg.quark.cn/s/a/i/quark-logo.png, enabled=true
 *
 * [mitm]
 * hostname = drive.quark.cn, drive-h.quark.cn, drive-m.quark.cn
 *
 * ==================== 使用步骤 ====================
 * 1. 把本脚本放到 Quantumult X 可访问位置（本地或远程 raw 链接）
 * 2. 按上面配置写入 rewrite / task / mitm
 * 3. 确保已开启 HTTPS 解密（MITM 证书已信任）
 * 4. 打开「夸克」App，浏览一下文件页 / 我的页面，等待通知「CK 获取成功」
 * 5. 可在任务里点「运行」手动测一次；之后每天定时签到
 *
 * 备注:
 * - kps/sign/vcode 有时效，失效后重新打开夸克 App 即可自动更新
 * - 本脚本仅抓取签到必要参数，不上传任何数据
 */

const SCRIPT_NAME = "夸克网盘签到";
const KEY_AUTH = "Quark_Auth_Params";
const KEY_COOKIE = "Quark_Cookie";
const KEY_LAST = "Quark_Last_Sign";

const HOSTS = {
  info: "https://drive-m.quark.cn/1/clouddrive/capacity/growth/info",
  sign: "https://drive-m.quark.cn/1/clouddrive/capacity/growth/sign",
};

// ===================== 入口 =====================
if (typeof $request !== "undefined") {
  handleRequest();
} else {
  handleTask();
}

// ===================== 抓取 CK =====================
function handleRequest() {
  try {
    const url = $request.url || "";
    const headers = $request.headers || {};

    // 1) 优先从 URL 查询参数提取（App 请求常见）
    const params = extractAuthFromUrl(url);

    // 2) 从 Cookie / 请求头补充
    const cookie =
      headers.Cookie ||
      headers.cookie ||
      headers.COOKIE ||
      "";

    let saved = false;
    let detail = [];

    if (params.kps && params.sign && params.vcode) {
      const payload = {
        kps: params.kps,
        sign: params.sign,
        vcode: params.vcode,
        fr: params.fr || "android",
        pr: params.pr || "ucpro",
        user: params.user || "",
        updatedAt: Date.now(),
      };
      $prefs.setValueForKey(JSON.stringify(payload), KEY_AUTH);
      saved = true;
      detail.push("kps/sign/vcode");
    }

    if (cookie && /__kps|__uid|__puus|__kp/i.test(cookie)) {
      $prefs.setValueForKey(cookie, KEY_COOKIE);
      saved = true;
      detail.push("Cookie");
    }

    // 避免同一页面刷屏：仅在参数有变化时通知
    if (saved) {
      const fingerprint = md5Lite(
        (params.kps || "") + (params.sign || "") + cookie.slice(0, 80)
      );
      const lastFp = $prefs.valueForKey("Quark_Auth_FP") || "";
      if (fingerprint !== lastFp) {
        $prefs.setValueForKey(fingerprint, "Quark_Auth_FP");
        notify(
          SCRIPT_NAME,
          "CK 获取成功 ✅",
          `已保存: ${detail.join(" + ")}\n可在任务中手动运行测签到`
        );
      }
    }
  } catch (e) {
    notify(SCRIPT_NAME, "CK 获取失败", String(e));
  }
  $done({});
}

function extractAuthFromUrl(url) {
  const out = {};
  try {
    const qIndex = url.indexOf("?");
    if (qIndex < 0) return out;
    const query = url.slice(qIndex + 1);
    query.split("&").forEach((pair) => {
      const i = pair.indexOf("=");
      if (i < 0) return;
      const k = decodeURIComponent(pair.slice(0, i));
      const v = decodeURIComponent(pair.slice(i + 1) || "");
      out[k] = v;
    });
  } catch (_) {}
  return out;
}

// ===================== 定时签到 =====================
async function handleTask() {
  try {
    const auth = loadAuth();
    if (!auth) {
      notify(
        SCRIPT_NAME,
        "尚未获取 CK",
        "请先打开夸克 App，确保 rewrite/mitm 已开启，抓取成功后再运行"
      );
      return $done();
    }

    // 防重复：同一天成功签过可跳过（仍会查 info）
    const today = formatDate(new Date());
    const last = $prefs.valueForKey(KEY_LAST) || "";

    const info = await getGrowthInfo(auth);
    if (info.code !== 0) {
      // 参数失效
      if (isAuthError(info)) {
        clearAuth();
        notify(
          SCRIPT_NAME,
          "登录参数已失效 ⚠️",
          "请重新打开夸克 App 自动更新 CK 后重试"
        );
      } else {
        notify(SCRIPT_NAME, "查询失败", prettyError(info));
      }
      return $done();
    }

    const data = info.data || {};
    const cap = data.cap_sign || {};
    const alreadySigned = !!cap.sign_daily;

    let signMsg = "";
    if (alreadySigned) {
      signMsg = "今日已签到";
      $prefs.setValueForKey(today, KEY_LAST);
    } else {
      const signRes = await doSign(auth);
      if (signRes.code === 0) {
        const reward = signRes.data && signRes.data.sign_daily_reward;
        const mb = reward != null ? bytesToMB(reward) : null;
        signMsg = mb != null ? `签到成功 +${mb}MB` : "签到成功";
        $prefs.setValueForKey(today, KEY_LAST);
      } else if (
        /已经签到|已签到|重复/.test(JSON.stringify(signRes)) ||
        signRes.code === 20009
      ) {
        signMsg = "今日已签到";
        $prefs.setValueForKey(today, KEY_LAST);
      } else if (isAuthError(signRes)) {
        clearAuth();
        notify(
          SCRIPT_NAME,
          "登录参数已失效 ⚠️",
          "请重新打开夸克 App 自动更新 CK 后重试"
        );
        return $done();
      } else {
        notify(SCRIPT_NAME, "签到失败", prettyError(signRes));
        return $done();
      }

      // 签到后再拉一次 info 刷新展示
      const info2 = await getGrowthInfo(auth);
      if (info2.code === 0) Object.assign(data, info2.data || {});
    }

    const body = buildSummary(data, signMsg, last === today && alreadySigned);
    notify(SCRIPT_NAME, signMsg, body);
  } catch (e) {
    notify(SCRIPT_NAME, "运行异常", String(e && e.message ? e.message : e));
  }
  $done();
}

function loadAuth() {
  // 优先使用 URL 参数模式
  const raw = $prefs.valueForKey(KEY_AUTH);
  if (raw) {
    try {
      const obj = JSON.parse(raw);
      if (obj.kps && obj.sign && obj.vcode) return { type: "params", ...obj };
    } catch (_) {}
  }

  // 兼容 Cookie 模式（部分抓包环境）
  const cookie = $prefs.valueForKey(KEY_COOKIE);
  if (cookie) return { type: "cookie", cookie };

  return null;
}

function clearAuth() {
  $prefs.removeValueForKey(KEY_AUTH);
  $prefs.removeValueForKey(KEY_COOKIE);
  $prefs.removeValueForKey("Quark_Auth_FP");
}

function commonQuery(auth) {
  if (auth.type === "params") {
    return {
      pr: auth.pr || "ucpro",
      fr: auth.fr || "android",
      kps: auth.kps,
      sign: auth.sign,
      vcode: auth.vcode,
    };
  }
  return { pr: "ucpro", fr: "pc" };
}

function buildUrl(base, query) {
  const qs = Object.keys(query)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");
  return `${base}?${qs}`;
}

function requestHeaders(auth) {
  const h = {
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 QuarkPC/1.0",
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
  };
  if (auth.type === "cookie") {
    h.Cookie = auth.cookie;
    h["User-Agent"] =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  }
  return h;
}

function getGrowthInfo(auth) {
  const url = buildUrl(HOSTS.info, commonQuery(auth));
  return http({
    url,
    method: "GET",
    headers: requestHeaders(auth),
  });
}

function doSign(auth) {
  const url = buildUrl(HOSTS.sign, commonQuery(auth));
  return http({
    url,
    method: "POST",
    headers: requestHeaders(auth),
    body: JSON.stringify({ sign_cyclic: true }),
  });
}

function http(opts) {
  return new Promise((resolve, reject) => {
    const request = {
      url: opts.url,
      method: (opts.method || "GET").toUpperCase(),
      headers: opts.headers || {},
    };
    if (opts.body) request.body = opts.body;

    // Quantumult X
    if (typeof $task !== "undefined" && $task.fetch) {
      $task.fetch(request).then(
        (resp) => {
          try {
            const body = resp.body || "";
            resolve(typeof body === "object" ? body : JSON.parse(body || "{}"));
          } catch (e) {
            reject(new Error("响应解析失败: " + (resp.body || "").slice(0, 200)));
          }
        },
        (err) => reject(err)
      );
      return;
    }

    // Surge / Loon 兼容
    if (typeof $httpClient !== "undefined") {
      const method = (opts.method || "GET").toLowerCase();
      const cb = (err, resp, data) => {
        if (err) return reject(err);
        try {
          resolve(typeof data === "object" ? data : JSON.parse(data || "{}"));
        } catch (e) {
          reject(new Error("响应解析失败"));
        }
      };
      if (method === "post") $httpClient.post(request, cb);
      else $httpClient.get(request, cb);
      return;
    }

    reject(new Error("当前环境不支持网络请求"));
  });
}

// ===================== 展示 =====================
function buildSummary(data, signMsg, skipped) {
  const capSign = data.cap_sign || {};
  const capComposition = data.cap_composition || {};
  const capTotal = data.total_capacity ?? data.cap_total;
  const lines = [];

  lines.push(signMsg + (skipped ? "（跳过重复执行）" : ""));

  // 连续签到
  if (capSign.sign_progress != null && capSign.sign_target != null) {
    lines.push(`连续签到: ${capSign.sign_progress}/${capSign.sign_target} 天`);
  }

  // 今日奖励
  if (capSign.sign_daily_reward != null) {
    lines.push(`今日奖励: ${bytesToMB(capSign.sign_daily_reward)} MB`);
  }

  // 成长容量
  if (capComposition.sign_reward != null) {
    lines.push(`签到累计: ${bytesToGB(capComposition.sign_reward)} GB`);
  }
  if (capTotal != null) {
    lines.push(`总容量: ${bytesToGB(capTotal)} GB`);
  }

  // 会员/其他奖励简述
  if (data.member_type) {
    lines.push(`会员: ${data.member_type}`);
  }

  return lines.join("\n");
}

function isAuthError(res) {
  if (!res) return true;
  const code = res.code;
  const msg = JSON.stringify(res);
  return (
    code === 31001 ||
    code === 14001 ||
    code === 401 ||
    /登录|login|auth|token|过期|失效|未登录|invalid/i.test(msg)
  );
}

function prettyError(res) {
  if (!res) return "未知错误";
  if (res.message) return `${res.code || ""} ${res.message}`.trim();
  if (res.msg) return `${res.code || ""} ${res.msg}`.trim();
  return JSON.stringify(res).slice(0, 180);
}

function bytesToMB(b) {
  return (Number(b) / (1024 * 1024)).toFixed(0);
}

function bytesToGB(b) {
  return (Number(b) / (1024 * 1024 * 1024)).toFixed(2);
}

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function notify(title, subtitle, body) {
  if (typeof $notify === "function") {
    $notify(title, subtitle || "", body || "");
  } else if (typeof $notification !== "undefined") {
    $notification.post(title, subtitle || "", body || "");
  }
}

// 轻量指纹，避免依赖外部库
function md5Lite(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return String(h);
}