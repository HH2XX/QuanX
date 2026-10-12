/*
 * TapTap《鸣潮》活动签到（Quantumult X）
 *
 * 重写模式：打开 TapTap 签到活动页时，保存 dynamic_data 请求所需的本地凭据。
 * 定时模式：执行签到，并自动领取所有已解锁且尚未领取的签到礼包。
 *
 * 凭据只保存在 Quantumult X 的本地持久化存储中。
 */

const NAME = "TapTap 鸣潮签到";
const STORE_KEY = "codex_taptap_mingchao_request_v1";
const DEFAULT_EVENT_URL = "https://www.taptap.cn/events/game-sign/frndkdpd";

if (typeof $request !== "undefined") {
  captureRequest();
} else {
  runTask()
    .catch((error) => notify("执行失败", error.message || String(error)))
    .finally(() => $done());
}

function captureRequest() {
  try {
    const match = $request.url.match(/\/dynamic_data\/([^/?]+)/);
    if (!match) return $done({});

    const headers = cleanHeaders($request.headers || {});
    const saved = {
      activityCode: decodeURIComponent(match[1]),
      dynamicUrl: $request.url,
      headers,
      capturedAt: new Date().toISOString(),
    };

    const ok = $prefs.setValueForKey(JSON.stringify(saved), STORE_KEY);
    notify(ok ? "凭据获取成功" : "凭据保存失败", `活动代码：${saved.activityCode}`);
  } catch (error) {
    notify("凭据获取失败", error.message || String(error));
  }
  $done({});
}

async function runTask() {
  const raw = $prefs.valueForKey(STORE_KEY);
  if (!raw) {
    notify("尚未获取凭据", "请先按 README 打开一次 TapTap 签到活动页。", DEFAULT_EVENT_URL);
    return;
  }

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch (_) {
    throw new Error("本地凭据格式损坏，请重新打开活动页获取");
  }

  if (!saved.activityCode || !saved.dynamicUrl || !saved.headers) {
    throw new Error("本地凭据不完整，请重新打开活动页获取");
  }

  const query = saved.dynamicUrl.includes("?")
    ? `?${saved.dynamicUrl.split("?").slice(1).join("?")}`
    : "";
  const base = "https://www.taptap.cn/webapiv2/event/game-sign";
  const headers = cleanHeaders(saved.headers);
  const cookie = findHeader(headers, "cookie") || "";
  const xsrf = getCookie(cookie, "XSRF-TOKEN");
  if (xsrf && !findHeader(headers, "x-xsrf-token")) {
    headers["X-XSRF-TOKEN"] = safeDecode(xsrf);
  }
  headers["Content-Type"] = "application/x-www-form-urlencoded";
  headers["X-Requested-With"] = "XMLHttpRequest";

  const smfp = findHeader(headers, "x-smfp") || "";
  let signBody = `activity_code=${encodeURIComponent(saved.activityCode)}`;
  if (smfp) signBody += `&smfp=${encodeURIComponent(smfp)}`;

  let signMessage = "";
  try {
    const response = await fetchRequest({
      url: `${base}/check_in${query}`,
      method: "POST",
      headers,
      body: signBody,
    });
    const result = unwrap(response.body);
    signMessage = result.ok
      ? "签到成功"
      : result.message || `签到返回 HTTP ${response.statusCode}`;
  } catch (error) {
    signMessage = `签到请求失败：${error.message || error}`;
  }

  const dynamicResponse = await fetchRequest({
    url: saved.dynamicUrl,
    method: "GET",
    headers: cleanHeaders(headers),
  });
  const dynamicResult = unwrap(dynamicResponse.body);
  if (!dynamicResult.ok) {
    throw new Error(dynamicResult.message || "读取签到状态失败，可能需要重新获取凭据");
  }

  const daily = dynamicResult.data && dynamicResult.data.daily_check_in;
  if (!daily) throw new Error("签到状态响应缺少 daily_check_in");

  const days = Number(
    daily.check_in_log && daily.check_in_log.total_check_in_days
      ? daily.check_in_log.total_check_in_days
      : 0,
  );
  const awards = Array.isArray(daily.award_list) ? daily.award_list : [];
  const claimable = awards.filter((item) => Number(item.status) === 1 && item.award_id);
  const claimed = [];
  const claimFailed = [];

  for (const award of claimable) {
    let body = `award_id=${encodeURIComponent(award.award_id)}`;
    if (smfp) body += `&smfp=${encodeURIComponent(smfp)}`;
    try {
      const response = await fetchRequest({
        url: `${base}/v2/check-in-accept-award${query}`,
        method: "POST",
        headers,
        body,
      });
      const result = unwrap(response.body);
      if (!result.ok) {
        claimFailed.push(`${award.content || award.label || award.award_id}：${result.message || "领取失败"}`);
        continue;
      }

      const prize = result.data || {};
      const title =
        (prize.prize && prize.prize.title) ||
        award.content ||
        award.label ||
        String(award.award_id);
      const code = prize.code || prize.sn || "";
      claimed.push(code ? `${title}｜兑换码 ${code}` : title);
    } catch (error) {
      claimFailed.push(`${award.content || award.label || award.award_id}：${error.message || error}`);
    }
  }

  const lines = [`累计签到：${days} 天`, signMessage];
  if (claimed.length) lines.push(`已领取：\n${claimed.join("\n")}`);
  if (claimFailed.length) {
    lines.push(`未能自动领取：\n${claimFailed.join("\n")}\n如提示验证码，请回活动页手动领取。`);
  }
  if (!claimable.length) lines.push("当前没有待领取礼包");
  notify("执行完成", lines.join("\n"), DEFAULT_EVENT_URL);
}

function cleanHeaders(input) {
  const result = {};
  const blocked = new Set([
    "content-length",
    "host",
    "connection",
    "accept-encoding",
    ":authority",
    ":method",
    ":path",
    ":scheme",
  ]);
  Object.keys(input || {}).forEach((key) => {
    if (!blocked.has(key.toLowerCase())) result[key] = input[key];
  });
  return result;
}

function findHeader(headers, name) {
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : "";
}

function getCookie(cookie, name) {
  const match = String(cookie).match(new RegExp(`(?:^|;\\s*)${escapeRegExp(name)}=([^;]*)`));
  return match ? match[1] : "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

function unwrap(body) {
  let json;
  try {
    json = JSON.parse(body || "{}");
  } catch (_) {
    return { ok: false, message: "服务器未返回 JSON，登录凭据可能已过期" };
  }
  if (json.success === true) return { ok: true, data: json.data };
  const data = json.data || {};
  return {
    ok: false,
    data,
    message: data.msg || data.error_description || json.msg || json.message || "服务返回失败",
  };
}

function fetchRequest(options) {
  return $task.fetch(options);
}

function notify(subtitle, body, url) {
  const options = url ? { "open-url": url } : undefined;
  $notify(NAME, subtitle, body, options);
}


