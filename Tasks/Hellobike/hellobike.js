/*
------------------------------------------
@Date: 2026.10.10
@Description: 哈啰单车签到
------------------------------------------
new Env("哈啰单车签到");
cron 0 9 * * * hellobike.js

脚本兼容：Surge、QuantumultX、Loon、Shadowrocket、Stash、青龙(Node.js)

[rewrite_local]
^https?:\/\/(api|marketingapi)\.hellobike\.com\/api\?(user\.taurus\.pointInfo|common\.welfare\.sign|common\.welfare\.subsidy\.detail) url script-request-body https://fastly.jsdelivr.net/gh/mikasangF1/hellobike@v3/hellobike.js
# 响应抓取：从用户信息/福利首页响应体补全 userGuid/userNewId（ticket 在加密流量里抓不到）
^https?:\/\/(api|marketingapi)\.hellobike\.com\/api\?(user\.taurus\.userInfo|user\.profile\.query|common\.welfare\.home|common\.welfare\.taurus\.task) url script-response-body https://fastly.jsdelivr.net/gh/mikasangF1/hellobike@v3/hellobike.js

[MITM]
hostname = api.hellobike.com, marketingapi.hellobike.com

【抓包说明 / token 获取】
打开哈啰 App → 进入「签到 / 金币」页面（触发 pointInfo/sign）或「福利中心 → 补贴页」
（触发 subsidy.detail，能一并抓到 deviceHash/hello_token），rewrite 命中后本脚本自动从
请求体抓取 token（32 位十六进制），去重后弹通知并持久化。
通知内容只有一行，直接复制到青龙环境变量 hl_data：
  hl_data=<token>|<deviceHash>|<hello_token>|<ticket>|<userGuid>|<userNewId>
（只进签到页时抓不到设备段，通知里就是纯 token，同样可用；
 ticket 在 App 加密流量里 QX 抓不到，需要补贴任务时从抓包值手动补第三段）
打开签到页 = 触发抓取，无需额外操作。token 失效后重新打开签到页抓一次即可。

【多账号配置（统一变量名 hl_data）】
QX / Surge / Loon / Stash：走 rewrite 抓包，token 自动存入 hl_data（JSON 数组）。
青龙(Node)：填环境变量 hl_data，多账号用 & 或 @ 分隔（两种分隔符都兼容；旧 hl_token 也能读）。
  例：hl_data="aaaa32位@bbbb32位&cccc32位"
手机端 rewrite 抓到新 token 时自动多账户化：同 token 更新、新 token 追加，格式统一为 [{userName, token}]。

【平台常量】
systemCode：61 = iOS，62 = Android。按抓 token 时的来源平台填写。
version   ：抓包看到的 App 版本号（当前 7.0.53），随 App 升级同步更新。

⚠️【免责声明】
------------------------------------------
1、此脚本仅用于学习研究，不保证其合法性、准确性、有效性，请根据情况自行判断，本人对此不承担任何保证责任。
2、由于此脚本仅用于学习研究，您必须在下载后 24 小时内将所有内容从您的计算机或手机或任何存储设备中完全删除，若违反规定引起任何事件本人对此均不负责。
3、请勿将此脚本用于任何商业或非法目的，若违反规定请自行对此负责。
4、此脚本涉及应用与本人无关，本人对因此引起的任何隐私泄漏或其他后果不承担任何责任。
5、本人对任何脚本引发的问题概不负责，包括但不限于由脚本错误引起的任何损失和损害。
6、如果任何单位或个人认为此脚本可能涉嫌侵犯其权利，应及时通知并提供身份证明，所有权证明，我们将在收到认证文件确认后删除此脚本。
7、所有直接或间接使用、查看此脚本的人均应该仔细阅读此声明。本人保留随时更改或补充此声明的权利。一旦您使用或复制了此脚本，即视为您已接受此免责声明。
*/
// 【诊断探针】QX 触发本脚本必弹此通知；若没有它 = 脚本根本没被 QX 加载（检查脚本名/rewrite引用名一致性）
if (typeof $request !== "undefined") { try { $notify("哈啰诊断", "脚本已被触发", ($request.method||"") + " " + ($request.url||"").substring(0,80)); } catch(e) {} }
// 响应模式探针：script-response-body 触发时 $response 有 body
if (typeof $response !== "undefined") { try { $notify("哈啰诊断", "响应抓取触发", ($request.url||"").substring(0,80)); } catch(e) {} }
const $ = new Env("哈啰单车签到");
//notify（Node 下 sendNotify 缺失时降级为仅控制台输出）
const notify = $.isNode() ? (() => {
    try {
        return require('./sendNotify');
    } catch (e) {
        $.log(`[sendNotify 未安装，降级仅控制台输出]`);
        return { sendNotify: (title, msg) => $.log(`${title}\n${msg}`) };
    }
})() : '';
const ckName = "hl_data";           // 统一持久化键(全平台hl_data)
const tokenEnv = "hl_data";         // Node 环境变量名：多账号 & 或 @ 分隔(兼容hl_token回退)
//多账号来源：Node 读环境变量切分，非 Node 读持久化 JSON 数组（统一键 hl_data）
// 键名统一：全平台 hl_data。旧 hl_token 键自动迁移到 hl_data（2026-10-11）
function migrateOldData() {
    if ($.isNode()) return []; // Node 走环境变量，无持久化
    let migrated = [];
    try {
        const oldKey = 'hl_token';
        const old = $.toObj($.getdata(oldKey)) || ($.getdata(oldKey) ? String($.getdata(oldKey)).split(/[@&]/).filter(Boolean) : []);
        if (old.length) {
            const cur = $.toObj($.getdata(ckName)) || [];
            const curTokens = new Set(cur.map(o => (o && o.token) || o));
            for (const o of old) {
                const t = (o && o.token) || o;
                if (t && !curTokens.has(t)) { cur.push(typeof o === 'string' ? { token: t, userName: `哈啰${maskString(t)}` } : o); migrated.push(t); }
            }
            if (migrated.length) $.setjson(cur, ckName);
        }
    } catch (e) { console.log(`[hellobike][migrate] ${e.message || e}`); }
    if (migrated.length) console.log(`[hellobike][migrate] 旧键 hl_token 迁移 ${migrated.length} 个账号 → hl_data`);
    return migrated;
}
// Node 环境变量 hl_data 优先，hl_token 回退兼容
function getEnvByNode() {
    let ckList = (process.env[tokenEnv] || process.env['hl_token'] || '');
    return ckList.split(/[@&]/).map(e => {
        e = e.trim();
        if (!e) return null;
        // 支持管道格式 token|deviceHash|hello_token|ticket|userGuid|userNewId
        if (e.includes('|')) {
            const parts = e.split('|');
            return { token: parts[0] || '', deviceHash: parts[1] || '', hello_token: parts[2] || '', ticket: parts[3] || '', userGuid: parts[4] || '', userNewId: parts[5] || '' };
        }
        // JSON 格式 [{"token":...}]
        if (e.startsWith('[') || e.startsWith('{')) {
            try { const j = JSON.parse(e); if (Array.isArray(j)) return j; return [j]; } catch (_) {}
        }
        return { token: e };
    }).filter(Boolean).flatMap(e => Array.isArray(e) ? e : [e]);
}
const userCookie = $.isNode() ? getEnvByNode() : (() => { migrateOldData(); return $.toObj($.getdata(ckName)) || []; })();
//用户多账号配置
$.userIdx = 0, $.userList = [], $.notifyMsg = [];
//成功个数
$.succCount = 0;
//debug
$.is_debug = ($.isNode() ? (process.env.IS_DEBUG || process.env.IS_DEDUG) : $.getdata('is_debug')) || 'false'; // IS_DEDUG为历史拼写,兼容保留

// ─── 业务常量（改这里即可）────────────────────────────────
const SYSTEM_CODE = 61;            // 61=iOS, 62=Android；按抓 token 的来源平台填写
const VERSION = "7.0.53";          // 抓包看到的 App 版本，随 App 升级更新
const FROM_CHANNEL = "h5";         // 固定 h5
const PLATFORM = 4;                // 固定 4
// 风控/条件类错误码：「今天做不了但 token 没坏」，单独提示，不当 token 过期处理。
const RISK_CODES = new Set(["485", "711070002", "711020001", "711020004", "711020005"]);
const TOKEN_RE = /^[0-9a-f]{32}$/; // 32 位十六进制 token 校验
// ─── 任务系统常量 ──────────────────────────────────────────
// 接任务/跳转事件走 marketingapi 域（不是 api 域）；场景码按 HAR 实测填写
const MARKETING_HOSTNAME = "marketingapi.hellobike.com";
const MARKETING_HOST = "https://" + MARKETING_HOSTNAME;
const AD_CODE = "410102";   // 城市 adCode（默认郑州，接任务实测成功那组；换城市按抓包改）
const CITY_CODE = "0371";   // 城市 cityCode（默认郑州）
const CITY_LAT = 34.82299207899305;   // 郑州纬度（补贴任务 adx.ssp.show 的 device.geo 用，HAR 实证此坐标返回广告物料）
const CITY_LON = 113.54194417317709;   // 郑州经度
const TASK_LIST_SCENE = { sceneNameEn: "platform_points", subSceneNameEn: "platform_points_order_return" }; // 查列表（api 域）
const ACCEPT_SCENE = { sceneNameEn: "platform_points", subSceneNameEn: "platform_points_pointshp" };          // 接任务（marketingapi 域）
const JUMP_SCENE = { sceneNameEn: "weekly_cash", subSceneNameEn: "weekly_cash_app" };                          // 跳转上报（marketingapi 域）
const TASK_SYSTEM_ENABLED = true; // 任务系统总开关（默认开；设 false 只拉列表不接任务）
const TASK_MAX_ROUNDS = 15;       // 轮次上限（照 hldc）：每轮重新拉列表，列表空则自然退出
const TASK_MIN_DELAY = 2000;      // 请求间随机延时下限（毫秒）
const TASK_MAX_DELAY = 5000;      // 请求间随机延时上限（毫秒）
const TASK_TRY_CREATE_ORDER = true; // 是否探测 createOrder（2026 HAR 中 0 次出现，保留以拿到如实结论）
// 任务分类：HAR 实测「出过奖」的跳转/浏览类优先做；视频壳/真实下单/系统权限类 jumpEvent 无法推进，排除
// 实测 createOrder 可完成的 plan（拿到 orderNo → completedOrder code=0）优先；跳转浏览类次之
const TASK_PRIORITY = ["order_cross_money", "order_cross_game", "order_jump_cross", "mutil_trace", "true_order_jump_cross", "weibo_browse", "pp_or_single_task"];
const TASK_EXCLUDE_PLANS = new Set([
    // 视频/激励广告壳（jumpEvent 无法完成「观看」）
    "ylh", "yhc", "motivate_video", "incentive_video_scheme", "pp_browse", "pp_order_slowly", "pp_no_button_puw",
    // 需真实下单（充值/充电/租车/电商返佣）
    "order_completion_task", "rebate_commodity", "pp_order_award",
    // 系统权限/聚合占位
    "remind", "pp_widget", "comm_dynamic_reward"
]);
// ─── 福利宝箱常量（HAR+实测：明文 token 调用，boxType:1 = +5 币/次）──────────
// ⚠ 服务端强制冷却：单次 open.treasure.box 后 status → COOLING，nextAvailableTime
//    实测约 +71 分钟（见 video_task_deep_dive.txt【7】）。因此单次运行只开 1 个，
//    连开会被冷却拒绝且每发都是 mutating 请求——这里把上限钉死为 1。
// ⚠ boxType:2（看视频版，+10 币）需先调 report.video.treasure.box，未实测，不要开。
const TREASURE_BOX_ENABLED = false;       // 宝箱开关（默认关；实测为 +5 币/~71 分钟，收益小）
const TREASURE_BOX_MAX_OPENS = 1;         // 单次运行开箱上限（服务端 ~71 分钟冷却，连开必失败）
const TREASURE_BOX_DELAY_MIN = 30000;     // 查状态 → 开箱间隔（防风控）
const TREASURE_BOX_DELAY_MAX = 45000;

// ─── 补贴任务（看广告领币）常量（HAR 实抓 2026-10-12 还原）──────────────
// 真实链路（明文，全走 api.hellobike.com/api，无 AES 加密、无头六件套）：
//   1. common.welfare.subsidy.detail → 查补贴详情（餐贴/睡贴，需 deviceHash+hello_token+riskParams）
//   2. adx.ssp.show    → 拉广告（明文，必须用有广告库存的 geo 才返回 adm 非空）
//   3. adx.ssp.callback → 完成上报（callBackType=SHOWED，服务端据此发币）
//   4. user.platform.event.upload → 事件上报（eventType=8000，服务端记账）
// ⚠️ 不存在 adx.ssp.reward.show 和 adx.client.bidding（HAR 2942 条全量无此二 action）
// ⚠️ adx.ssp.* 请求全为明文 JSON，无需 AES/HMAC/头六件套
const SUBSIDY_TASK_ENABLED = false;         // 补贴任务开关（默认关；需配置设备凭据后开启）
const SUBSIDY_MAX_TASKS = 3;               // 单次运行最多处理任务数
const SUBSIDY_DELAY_MIN = 5000;           // 请求间延时下限（毫秒，广告场景防风控）
const SUBSIDY_DELAY_MAX = 10000;           // 请求间延时上限
// 补贴查询 action（HAR 实证）：common.welfare.subsidy.detail
const SUBSIDY_TASK_ACTION = "common.welfare.subsidy.detail";
// 补贴任务类型（HAR 实证）：meal_subsidy=餐贴，sleeping_subsidy=睡贴
const SUBSIDY_TYPES = ["meal_subsidy", "sleeping_subsidy"];
//------------------------------------------
async function main() {
    for (let user of $.userList) {
        $.log(`\n------------- 账号${user.index} -------------\n`)
        try {
            // token 制：token 即凭证，无需 login
            let pointF = await user.getPoint() ?? null;
            await user.signin();
            let pointE = await user.getPoint() ?? null;
            if (pointF != null && pointE != null) {
                let delta = pointE - pointF;
                $.notifyMsg.push(`[${user.userName}] 金币:${pointF}${delta >= 0 ? "+" : ""}${delta} → ${pointE}`);
            }
            // 任务系统：拉列表 → 接任务 + jumpEvent 尝试 → 复查进度（失败不影响签到主流程）
            await user.runTaskSystem();
            // 福利宝箱：明文开箱，5 币/个（HAR 实测），独立开关，失败不影响主流程
            await user.runTreasureBox();
            // 补贴任务（看广告领币）：adx.ssp 链路，frida hook 实抓，独立开关，失败不影响主流程
            await user.runSubsidyTask();
            // 复测金币，给出任务+宝箱+补贴的总增量
            const pointFinal = await user.getPoint() ?? null;
            if (pointF != null && pointFinal != null) {
                let delta = pointFinal - pointF;
                $.notifyMsg.push(`[${user.userName}] 全链金币:${pointF}${delta >= 0 ? "+" : ""}${delta} → ${pointFinal}`);
                $.log(`[${user.userName}] ═══ 全链结算 ═══ 金币 ${pointF} → ${pointFinal}（${delta >= 0 ? "+" : ""}${delta}）`);
            }
            if (user.ckStatus) $.succCount++;
        } catch (e) {
            throw e
        }
    }
    $.title = `共${$.userList.length}个账号,有效${$.succCount}个,失效${$.userList.length - 0 - $.succCount}个`
    //notify
    await sendMsg($.notifyMsg.join("\n"));
}


//用户
class UserInfo {
    constructor(user) {
        //-------------------------- 固定不动区域 ---------------------------------
        this.index = ++$.userIdx;
        this.ckStatus = true;
        this.token = "" || (user && user.token) || user;
        this.userName = (user && user.userName) || `哈啰${maskString(this.token)}`;
        // 设备级凭据（补贴任务需要，从 hl_data 管道格式 token|deviceHash|hello_token|ticket|userGuid|userNewId 解析）
        // Node 环境变量已按管道拆好；QX 抓取时存 hl_wl_dev 全局键（单设备），此处兼容两路径
        this.deviceHash = (user && user.deviceHash) || "";
        this.hello_token = (user && user.hello_token) || "";
        this.ticket = (user && user.ticket) || "";
        this.userGuid = (user && user.userGuid) || "";
        this.userNewId = (user && user.userNewId) || "";
        //-------------------------- 请求封装区域 ---------------------------------
        //请求封装
        this.baseUrl = `https://api.hellobike.com`;
        this.headers = {
            'Connection': `keep-alive`,
            'Accept-Encoding': `gzip, deflate, br`,
            'Accept-Language': `zh-CN,zh-Hans;q=0.9`,
            'Content-Type': `application/json`,
            'Host': `api.hellobike.com`,
            'Origin': `https://m.hellobike.com`,
            'Referer': `https://m.hellobike.com/`,
            'User-Agent': `Mozilla/5.0 (iPhone; CPU iPhone OS 16_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/20D67 Ariver/1.0.15  NebulaSDK; app=easybike; version=${VERSION} WK RVKType(1) NebulaX/1.0.0`,
            'Accept': `application/json, text/plain, */*`
        };
        //
        return createProxy(this, this.handleError); // 使用 Proxy 包装实例
    }
    //-------------------------- 工具函数区域 ---------------------------------
    // 通用错误处理方法
    handleError(error) {
        this.ckStatus = false;
        $.error(`[${this.userName}] 发生错误：${error.message}`);
    }
    // 通用请求方法（每次请求注入新的 requestId 头）
    async fetch(o) {
        const options = typeof o === 'string' ? { url: o } : o;
        const url = new URL(options.url || '', this.baseUrl).href;
        let res = await Request({
            ...options,
            headers: { ...this.headers, ...options.headers, requestId: randomRequestId() },
            url: url
        });
        debug(res, url.includes('?') ? url.slice(url.indexOf('?') + 1) : url.split('/').pop());
        return res;
    }
    //-------------------------- 脚本函数区域 ---------------------------------
    // 签到
    async signin() {
        const opts = {
            "url": "/api?common.welfare.sign",
            "type": "post",
            "dataType": "json",
            "body": {
                "from": FROM_CHANNEL,
                "systemCode": SYSTEM_CODE,
                "platform": PLATFORM,
                "version": VERSION,
                "action": "common.welfare.sign",
                "token": this.token,
                "newWelfare": true
            }
        }
        let res = await this.fetch(opts);
        const code = res && res.code;
        const msg = (res && res.msg) || "";
        if (code === 0) {
            const didSign = !!(res && res.data && res.data.didSignToday);
            const bounty = ((res && res.data && res.data.bountyCountToday) ?? (res && res.data && res.data.bonusList && res.data.bonusList[0] && res.data.bonusList[0].bonusCount) ?? 0);
            const title = (res && res.data && res.data.title) || "";
            if (didSign) {
                $.info(`[${this.userName}] 已连签 ✅ 金币🪙+${bounty}${title ? "｜" + title : ""}`);
                $.notifyMsg.push(`[${this.userName}] 已连签 ✅ 金币🪙+${bounty}${title ? "｜" + title : ""}`);
            } else {
                $.info(`[${this.userName}] 今日未签到（可能已签过或时间问题）`);
                $.notifyMsg.push(`[${this.userName}] 今日未签到（可能已签过或时间问题）`);
            }
            return res;
        }
        if (RISK_CODES.has(String(code))) {
            $.warn(`[${this.userName}] 签到风控/条件码 ${code}：${msg}（token 有效，换时段重试）`);
            $.notifyMsg.push(`[${this.userName}] 风控码${code}：${msg}（token 有效）`);
            return res;
        }
        // 其他非 0 码：token 失效
        this.ckStatus = false;
        $.error(`[${this.userName}] 签到失败 code=${code} msg=${msg}，token 已失效`);
        $.notifyMsg.push(`[${this.userName}] token 已失效（code=${code}）`);
        return res;
    }
    // 查询金币（pointType:1 = 全部金币）
    async getPoint() {
        const opts = {
            "url": "/api?user.taurus.pointInfo",
            "type": "post",
            "dataType": "json",
            "body": {
                "from": FROM_CHANNEL,
                "systemCode": SYSTEM_CODE,
                "platform": PLATFORM,
                "version": VERSION,
                "action": "user.taurus.pointInfo",
                "token": this.token,
                "pointType": 1
            }
        }
        let res = await this.fetch(opts);
        const code = res && res.code;
        if (code === 0) {
            const points = (res && res.data && res.data.points) ?? 0;
            const amount = (res && res.data && res.data.amount) ?? 0;
            $.info(`[${this.userName}] 金币🪙${points}，可抵扣${amount}元`);
            return points;
        }
        const msg = (res && res.msg) || "";
        if (RISK_CODES.has(String(code))) {
            $.warn(`[${this.userName}] 金币查询风控/条件码 ${code}：${msg}（token 有效）`);
        } else {
            $.error(`[${this.userName}] 金币查询失败 code=${code} msg=${msg}`);
        }
        return null;
    }
    //-------------------------- 任务系统区域 ---------------------------------
    // 拉取任务列表（明文，api 域）
    async getTaskList() {
        const opts = {
            "url": "/api?common.welfare.taurus.task",
            "type": "post",
            "dataType": "json",
            "body": {
                "from": FROM_CHANNEL,
                "systemCode": SYSTEM_CODE,
                "platform": PLATFORM,
                "version": VERSION,
                "action": "common.welfare.taurus.task",
                "token": this.token,
                "channelId": 4,
                "sceneNameEn": TASK_LIST_SCENE.sceneNameEn,
                "subSceneNameEn": TASK_LIST_SCENE.subSceneNameEn,
                "taskStatusList": ["INIT", "RUNNING"],
                "queryUnrewardedTasks": true,
                "newWelfare": true,
                "cityCode": CITY_CODE,
                "adCode": AD_CODE,
                "entranceSource": null,
                "rebateModuleKey": "welfare_takeout_rebate_module"
            }
        }
        const res = await this.fetch(opts);
        if (res && res.code === 0) return res;
        const msg = (res && res.msg) || "";
        $.warn(`[${this.userName}] 任务列表查询 code=${res && res.code} msg=${msg}`);
        return null;
    }
    // 解析任务列表 → 扁平任务数组（实测结构：data.taskGroupInfoDTOS[].taskCouponList[]）
    parseTasks(res) {
        const groups = (res && res.data && res.data.taskGroupInfoDTOS) || [];
        const out = [];
        for (const g of groups) {
            // HAR 实测字段是 taskCouponList；保留 taskShowDTOS/taskShowDTOs 兜底兼容
            const shows = g.taskCouponList || g.taskShowDTOS || g.taskShowDTOs || [];
            const gName = g.mainTitle || g.groupName || g.groupTitle || "";
            for (const t of shows) {
                if (!t.taskCode) continue; // 过滤占位项（如「玩游戏3分钟」无 taskCode）
                const stages = t.stageOffers || [];
                const stageAmount = stages.reduce((a, s) => a + (Number(s.totalAmount) || 0), 0);
                out.push({
                    taskGuid: t.taskGuid || "",
                    taskCode: t.taskCode,
                    taskGroupCode: t.taskGroupCode || "",
                    taskName: t.taskName || t.mainTitle || "",
                    taskStatus: t.taskStatus || "",
                    totalProgress: Number(t.totalProgress ?? 1),
                    currentProgress: Number(t.currentProgress ?? 0),
                    btnName: t.btnName || "",
                    marketPlan: t.marketPlan || t.taskPlan || "",
                    offerDisplayName: (stages[0] && stages[0].offerDisplayName) || "",
                    stageAmount: stageAmount,
                    guideAwardDesc: t.guideAwardDesc || "",
                    groupName: gName
                });
            }
        }
        return out;
    }
    // 接任务（明文，marketingapi 域！）
    async acceptTask(taskCode, taskGroupCode) {
        const opts = {
            "url": `${MARKETING_HOST}/api?mars.task.acceptTaskList`,
            "type": "post",
            "dataType": "json",
            "headers": { "Host": MARKETING_HOSTNAME },
            "body": {
                "from": FROM_CHANNEL,
                "systemCode": SYSTEM_CODE,
                "platform": PLATFORM,
                "version": VERSION,
                "action": "mars.task.acceptTaskList",
                "token": this.token,
                "channelId": 4,
                "sceneNameEn": ACCEPT_SCENE.sceneNameEn,
                "subSceneNameEn": ACCEPT_SCENE.subSceneNameEn,
                "taskList": [{ "taskCode": taskCode, "taskGroupCode": taskGroupCode }],
                "adCode": AD_CODE,
                "cityCode": CITY_CODE
            }
        }
        return await this.fetch(opts);
    }
    // 跳转事件上报（明文，marketingapi 域！）
    async jumpEvent(taskCode) {
        const opts = {
            "url": `${MARKETING_HOST}/api?mars.task.jumpEvent`,
            "type": "post",
            "dataType": "json",
            "headers": { "Host": MARKETING_HOSTNAME },
            "body": {
                "from": FROM_CHANNEL,
                "systemCode": SYSTEM_CODE,
                "platform": PLATFORM,
                "version": VERSION,
                "action": "mars.task.jumpEvent",
                "token": this.token,
                "channelId": 4,
                "taskCode": taskCode,
                "sceneNameEn": JUMP_SCENE.sceneNameEn,
                "subSceneNameEn": JUMP_SCENE.subSceneNameEn
            }
        }
        return await this.fetch(opts);
    }
    // 创建任务订单（hldc 链路；2026 HAR 中 0 次出现，作为探针保留——如实回报是否可用）
    async createOrder(taskCode) {
        const opts = {
            "url": `${MARKETING_HOST}/api?mars.task.createOrder`,
            "type": "post",
            "dataType": "json",
            "headers": { "Host": MARKETING_HOSTNAME },
            "body": {
                "action": "mars.task.createOrder",
                "clientId": "",
                "from": FROM_CHANNEL,
                "systemCode": SYSTEM_CODE,
                "token": this.token,
                "version": VERSION,
                "adCode": AD_CODE,
                "cityCode": CITY_CODE,
                "channelId": 4,
                "platform": PLATFORM,
                "sceneNameEn": ACCEPT_SCENE.sceneNameEn,
                "subSceneNameEn": ACCEPT_SCENE.subSceneNameEn,
                "taskCode": taskCode
            }
        }
        return await this.fetch(opts);
    }
    // 完成任务订单 = jumpEvent 携带 orderNo（hldc 链路第 4 步）
    async completedOrder(taskCode, orderNo) {
        const opts = {
            "url": `${MARKETING_HOST}/api?mars.task.jumpEvent`,
            "type": "post",
            "dataType": "json",
            "headers": { "Host": MARKETING_HOSTNAME },
            "body": {
                "action": "mars.task.jumpEvent",
                "clientId": "",
                "from": FROM_CHANNEL,
                "systemCode": SYSTEM_CODE,
                "token": this.token,
                "version": VERSION,
                "adCode": AD_CODE,
                "cityCode": CITY_CODE,
                "channelId": 4,
                "orderNo": orderNo,
                "taskCode": taskCode,
                "sceneNameEn": ACCEPT_SCENE.sceneNameEn,
                "subSceneNameEn": ACCEPT_SCENE.subSceneNameEn
            }
        }
        return await this.fetch(opts);
    }
    // 领取任务奖励（HAR 实测：code=0 且 data.taskCenterAwardList[].worth 为实际到账奖励金）
    async receiveAward(taskGuid, taskGroupCode) {
        if (!taskGuid) return null;
        const opts = {
            "url": `${MARKETING_HOST}/api?mars.offer.receiveAward`,
            "type": "post",
            "dataType": "json",
            "headers": { "Host": MARKETING_HOSTNAME },
            "body": {
                "from": FROM_CHANNEL,
                "systemCode": SYSTEM_CODE,
                "platform": PLATFORM,
                "version": VERSION,
                "action": "mars.offer.receiveAward",
                "token": this.token,
                "channelId": 4,
                "taskGuid": taskGuid,
                "taskGroupCode": taskGroupCode || ""
            }
        }
        return await this.fetch(opts);
    }
    // showTaskList 兜底源（marketingapi 域）。HAR 实测：纯 token 可用；部分场景需 userGuid/ticket/mobile，
    // 失败时降级返回 null 不影响主流程（taurus.task 是主源）
    async getShowTaskList() {
        try {
            const opts = {
                "url": `${MARKETING_HOST}/api?mars.task.showTaskList`,
                "type": "post",
                "dataType": "json",
                "headers": { "Host": MARKETING_HOSTNAME },
                "body": {
                    "from": FROM_CHANNEL,
                    "systemCode": SYSTEM_CODE,
                    "platform": PLATFORM,
                    "version": VERSION,
                    "action": "mars.task.showTaskList",
                    "token": this.token,
                    "channelId": 4,
                    "sceneNameEn": "platform_points",
                    "subSceneNameEn": "platform_points_pointshp",
                    "taskStatusList": ["INIT", "RUNNING"],
                    "queryUnrewardedTasks": true,
                    "adCode": AD_CODE,
                    "cityCode": CITY_CODE
                }
            }
            const res = await this.fetch(opts);
            if (!res || res.code !== 0) {
                $.log(`[${this.userName}] showTaskList 降级（code=${res && res.code} msg=${(res && res.msg) || ""}）`);
                return null;
            }
            const raw = (res.data && res.data.taskList) || [];
            // 排除付费会员购卡与 RUNNING 之外的脏数据（hldc 同款过滤）
            return raw
                .filter(e => e && e.taskCode && !/付费会员购卡/.test(e.taskName || "") && e.taskStatus !== "FINISHED")
                .map(e => {
                    const stages = e.stageOffers || [];
                    const stageAmount = stages.reduce((a, s) => a + (Number(s.totalAmount) || 0), 0);
                    return {
                        taskGuid: e.taskGuid || "",
                        taskCode: e.taskCode,
                        taskGroupCode: e.taskGroupCode || "",
                        taskName: e.taskName || e.mainTitle || "",
                        taskStatus: e.taskStatus || "",
                        totalProgress: Number(e.totalProgress ?? 1),
                        currentProgress: Number(e.currentProgress ?? 0),
                        btnName: e.btnName || "",
                        marketPlan: e.marketPlan || e.taskPlan || "",
                        offerDisplayName: (stages[0] && stages[0].offerDisplayName) || "",
                        stageAmount: stageAmount,
                        guideAwardDesc: e.guideAwardDesc || "",
                        groupName: "",
                        _src: "showTaskList"
                    };
                });
        } catch (e) {
            $.log(`[${this.userName}] showTaskList 异常（降级跳过）：${e && e.message ? e.message : e}`);
            return null;
        }
    }
    // ─── 福利宝箱（HAR 实测明文：5 币/个，日上限 72，纯 token）─────────────
    async queryTreasureBox() {
        const opts = {
            "url": "/api?common.welfare.query.treasure.box",
            "type": "post",
            "dataType": "json",
            "body": {
                "from": FROM_CHANNEL,
                "systemCode": SYSTEM_CODE,
                "platform": PLATFORM,
                "version": VERSION,
                "action": "common.welfare.query.treasure.box",
                "token": this.token,
                "cityCode": CITY_CODE
            }
        };
        return await this.fetch(opts);
    }
    async openTreasureBox() {
        const opts = {
            "url": "/api?common.welfare.open.treasure.box",
            "type": "post",
            "dataType": "json",
            "body": {
                "from": FROM_CHANNEL,
                "systemCode": SYSTEM_CODE,
                "platform": PLATFORM,
                "version": VERSION,
                "action": "common.welfare.open.treasure.box",
                "token": this.token,
                "cityCode": CITY_CODE,
                "boxType": 1
            }
        };
        return await this.fetch(opts);
    }
    // 宝箱主流程：查询 → 逐个开箱（保守上限 TREASURE_BOX_MAX_OPENS）→ 汇总到账
    async runTreasureBox() {
        if (!TREASURE_BOX_ENABLED) { $.log(`[${this.userName}] 宝箱开关关闭，跳过`); return 0; }
        const savedCk = this.ckStatus;
        let total = 0;
        try {
            const sleep = (a, b) => $.wait(Math.floor(a + Math.random() * (b - a)));
            $.log(`\n[${this.userName}] ═══ 福利宝箱 ═══`);
            const q = await this.queryTreasureBox();
            const d = q && q.data;
            if (!q || q.code !== 0 || !d) {
                $.warn(`[${this.userName}] 宝箱查询失败 code=${q && q.code} msg=${(q && q.msg) || ""}，跳过`);
                return 0;
            }
            if (!d.show || d.status !== "AVAILABLE") {
                const coolMs = d.nextAvailableTime ? (d.nextAvailableTime - Date.now()) : 0;
                $.log(`[${this.userName}] 宝箱冷却中（status=${d.status}，剩余 ${coolMs > 0 ? Math.ceil(coolMs / 60000) + " 分钟" : "未知"}）→ 跳过`);
                return 0;
            }
            $.log(`[${this.userName}] 🎁 宝箱可用｜今日已开 ${d.todayOpenCount}/${d.maxDailyCount}｜今日累计 ${d.todayTotalReward}｜普通箱 ${d.normalBoxReward}币/视频箱 ${d.videoBoxReward}币`);
            await sleep(TREASURE_BOX_DELAY_MIN, TREASURE_BOX_DELAY_MAX);
            for (let i = 1; i <= TREASURE_BOX_MAX_OPENS; i++) {
                const r = await this.openTreasureBox();
                const rd = r && r.data;
                if (!r || r.code !== 0 || !rd || rd.success === false) {
                    $.log(`[${this.userName}]   第${i}次开箱失败 code=${r && r.code} msg=${(r && r.msg) || ""} → 停止`);
                    break;
                }
                total += Number(rd.rewardAmount) || 0;
                $.log(`[${this.userName}]   🎉 第${i}次开箱 +${rd.rewardAmount}币｜累计${rd.todayTotalReward}｜今日${rd.todayOpenCount}/${rd.maxDailyCount}｜下次可用${rd.nextAvailableTime || 0}`);
                if (!rd.canContinue) { $.log(`[${this.userName}]   canContinue=false → 停止`); break; }
                await sleep(TREASURE_BOX_DELAY_MIN, TREASURE_BOX_DELAY_MAX);
            }
            if (total) $.notifyMsg.push(`[${this.userName}] 🎁 宝箱 +${total}金币`);
            $.log(`[${this.userName}] ═══ 宝箱结束：共 ${total} 币 ═══`);
        } catch (e) {
            $.warn(`[${this.userName}] 宝箱异常（已兜底，不影响签到）：${e && e.message ? e.message : e}`);
        } finally {
            this.ckStatus = savedCk;
        }
        return total;
    }


    // ─── 补贴任务（看广告领币）：明文 adx.ssp 链路（HAR 2026-10-12 实抓还原）──────
    // 真实链路（全明文 JSON，走 api.hellobike.com/api，无 AES、无头六件套）：
    //   1. common.welfare.subsidy.detail → 查补贴详情（餐贴/睡贴，需 deviceHash+hello_token+riskParams）
    //   2. adx.ssp.show    → 拉广告（明文，geo 必须有广告库存才返回 adm 非空）
    //   3. adx.ssp.callback → 完成上报（callBackType=SHOWED，服务端据此发币）
    //   4. user.platform.event.upload → 事件上报（eventType=8000）
    // ⚠️ 不存在 adx.ssp.reward.show / adx.client.bidding（HAR 2942 条全量无此二 action）
    // ⚠️ adx.ssp.* 全为明文，无需加密

    // 构造 adx.ssp.* 用的 device 对象（HAR 实证结构：精简版，无 ip/caid/birthTime）
    buildAdxDevice() {
        return {
            ua: this.headers['User-Agent'],
            carrier: 0,
            connectionType: 0,
            make: "iphone",
            os: "iphone",
            geo: {
                ad: AD_CODE,
                city: CITY_CODE,
                lat: CITY_LAT,
                lon: CITY_LON,
            },
        };
    }

    // 构造 adx.ssp.callback 用的 device 对象（HAR 实证：比 show 多 osv/screen/deviceModel/language）
    buildCallbackDevice() {
        return {
            ua: this.headers['User-Agent'],
            carrier: 0,
            connectionType: 0,
            make: "iphone",
            os: "iphone",
            geo: {
                ad: AD_CODE,
                city: CITY_CODE,
                lat: CITY_LAT,
                lon: CITY_LON,
            },
            osv: "",
            screen: { width: 393, height: 852 },
            deviceModel: "",
            language: "zh-CN",
        };
    }

    // Step 1: 查询补贴任务详情（明文，需设备指纹）
    // HAR 实证请求体：{from, systemCode, platform, version, action, token, subsidyType, deviceHash, hello_token, riskParams{...}}
    async querySubsidyDetail(subsidyType) {
        if (!this.deviceHash || !this.hello_token) {
            $.log(`[${this.userName}] [${subsidyType}] 未配置设备指纹(deviceHash/hello_token)，跳过补贴任务`);
            return null;
        }
        const opts = {
            "url": "/api?common.welfare.subsidy.detail",
            "type": "post",
            "dataType": "json",
            "body": {
                "from": FROM_CHANNEL,
                "systemCode": SYSTEM_CODE,
                "platform": PLATFORM,
                "version": VERSION,
                "action": "common.welfare.subsidy.detail",
                "token": this.token,
                "subsidyType": subsidyType,
                "deviceHash": this.deviceHash,
                "hello_token": this.hello_token,
                "riskParams": {
                    "fingerprint-hash": this.deviceHash,
                    "hello_token": this.hello_token,
                    "deviceHash": this.deviceHash,
                    "param": {
                        "systemCode": SYSTEM_CODE,
                        "longitude": CITY_LON,
                        "latitude": CITY_LAT,
                        "deviceLon": CITY_LON,
                        "deviceLat": CITY_LAT,
                        "deviceHash": this.deviceHash,
                    },
                },
            },
        };
        const res = await this.fetch(opts);
        const code = res && res.code;
        if (code !== 0) {
            $.warn(`[${this.userName}] [${subsidyType}] 补贴详情查询失败 code=${code} msg=${(res && res.msg) || ""}`);
            return null;
        }
        const d = (res && res.data) || {};
        const infos = d.subsidyDetailInfos || [];
        $.log(`[${this.userName}] [${subsidyType}] 总额${d.taskBountyCountSum}币 已领${d.drawTaskBountyCountSum} 时间窗=${d.isTimeWindow} 可做${infos.length}个`);
        return d;
    }

    // Step 2: adx.ssp.show（明文，拉广告，返回 adm）
    // HAR 实证请求体：{from, systemCode, action, impIds, device, app, token}
    async adxSspShow(adUnitId) {
        const opts = {
            "url": "/api?adx.ssp.show",
            "type": "post",
            "dataType": "json",
            "body": {
                "from": FROM_CHANNEL,
                "systemCode": SYSTEM_CODE,
                "action": "adx.ssp.show",
                "impIds": [adUnitId],
                "device": this.buildAdxDevice(),
                "app": { appId: "h5-component", systemCode: String(SYSTEM_CODE), ver: VERSION },
                "token": this.token,
            },
        };
        const res = await this.fetch(opts);
        const code = res && res.code;
        if (code !== 0) {
            $.warn(`[${this.userName}]   adx.ssp.show 失败 code=${code} msg=${(res && res.msg) || ""}`);
            return null;
        }
        return (res && res.data) || {};
    }

    // Step 3: adx.ssp.callback（明文，完成上报，服务端据此发币）
    // HAR 实证请求体：{from, systemCode, action, token, device, app, impCallBackInfos[{impId, creativeCallBackInfos[{...}]}]}
    // callback 的字段全部从 adx.ssp.show 响应的 adm[0] 提取
    async adxSspCallback(adUnitId, adm0) {
        if (!adm0) { $.warn(`[${this.userName}]   callback 跳过：adm 为空`); return null; }
        const impId = adm0.impid || adUnitId;
        const creative0 = (adm0.creative && adm0.creative[0]) || {};
        const tracker = creative0.tracker || {};
        const ext = adm0.ext || {};
        const now = Date.now();
        const serverTs = adm0.timestamp || String(now);
        const callbackBody = {
            "from": FROM_CHANNEL,
            "systemCode": SYSTEM_CODE,
            "action": "adx.ssp.callback",
            "token": this.token,
            "device": this.buildCallbackDevice(),
            "app": { appId: "h5-component", systemCode: String(SYSTEM_CODE), ver: VERSION },
            "impCallBackInfos": [{
                "impId": impId,
                "creativeCallBackInfos": [{
                    "taskName": tracker.task_name || "",
                    "childTaskId": tracker.child_task_id || "",
                    "taskId": tracker.task_id || "",
                    "childTaskName": tracker.child_task_name || "",
                    "params": tracker.params || "{}",
                    "creativeId": creative0.id || "",
                    "elemId": creative0.templateGuid || "",
                    "traceId": adm0.traceId || "",
                    "serverTimeStamp": String(serverTs),
                    "pageId": ext.pageId || "Welfare",
                    "callBackType": "SHOWED",
                    "eventTime": now,  // HAR 实证：eventTime 是整数（非字符串）
                }],
            }],
        };
        const opts = {
            "url": "/api?adx.ssp.callback",
            "type": "post",
            "dataType": "json",
            "body": callbackBody,
        };
        const res = await this.fetch(opts);
        const code = res && res.code;
        if (code === 0) {
            $.log(`[${this.userName}]   ✅ adx.ssp.callback code=0 msg=${(res && res.msg) || "ok"} → 服务端发币`);
        } else {
            $.warn(`[${this.userName}]   ⚠ adx.ssp.callback code=${code} msg=${(res && res.msg) || ""}`);
        }
        return res;
    }

    // Step 4: user.platform.event.upload（明文，事件上报，服务端记账）
    // HAR 实证请求体：{from, systemCode, platform, version, action, eventType:"8000", token, buryType:1, adSource, adCode, cityCode}
    async uploadEvent(taskCode) {
        const body = {
            "from": FROM_CHANNEL,
            "systemCode": SYSTEM_CODE,
            "platform": PLATFORM,
            "version": VERSION,
            "action": "user.platform.event.upload",
            "eventType": "8000",
            "token": this.token,
            "buryType": 1,
            "adSource": "jingxuangongge",
            "adCode": AD_CODE,
            "cityCode": CITY_CODE,
        };
        if (taskCode) body.taskCode = taskCode;
        const opts = { "url": "/api?user.platform.event.upload", "type": "post", "dataType": "json", "body": body };
        const res = await this.fetch(opts);
        const code = res && res.code;
        if (code === 0) {
            $.log(`[${this.userName}]   ✅ 事件上报 eventType=8000 ${taskCode ? "taskCode=" + taskCode.substring(0, 12) + "…" : ""}`);
        } else {
            $.warn(`[${this.userName}]   ⚠ 事件上报失败 code=${code} msg=${(res && res.msg) || ""}`);
        }
        return res;
    }

    // 补贴任务主流程（明文三步链：subsidy.detail → adx.ssp.show → adx.ssp.callback → event.upload）
    async runSubsidyTask() {
        if (!SUBSIDY_TASK_ENABLED) { $.log(`[${this.userName}] 补贴任务开关关闭，跳过`); return 0; }
        if (!this.deviceHash || !this.hello_token) {
            $.log(`[${this.userName}] 补贴任务跳过：hl_data 未配置 deviceHash/hello_token（管道格式第2/3段）`);
            return 0;
        }
        const savedCk = this.ckStatus;
        let total = 0;
        try {
            const sleep = (a, b) => $.wait(Math.floor(a + Math.random() * (b - a)));
            $.log(`\n[${this.userName}] ═══ 补贴任务（明文 adx.ssp 链路） ═══`);
            for (const subsidyType of SUBSIDY_TYPES) {
                $.log(`\n[${this.userName}] ── ${subsidyType} ──`);
                // Step 1: 查补贴详情
                const detail = await this.querySubsidyDetail(subsidyType);
                if (!detail) continue;
                const infos = detail.subsidyDetailInfos || [];
                // 只做 RUNNING 状态且在时间窗内的任务
                const now = Date.now();
                const todo = infos.filter(t => {
                    if (t.taskStatus !== "RUNNING") return false;
                    // 时间窗门控（HAR 实证：startTime/endTime 为 "HH:MM:SS" 格式）
                    const s = parseWindowMs(t.startTime);
                    const e = parseWindowMs(t.endTime);
                    if (s != null && e != null && !(s <= now && now <= e)) {
                        $.log(`[${this.userName}]   📋 ${t.taskName || t.taskCode}｜${t.taskBountyCount}币｜⏳ 未到时间窗(${fmtHm(t.startTime)}-${fmtHm(t.endTime)})，跳过`);
                        return false;
                    }
                    return true;
                });
                if (!todo.length) {
                    $.log(`[${this.userName}]   无可做补贴任务（${subsidyType}）`);
                    continue;
                }
                $.log(`[${this.userName}]   📋 可做 ${todo.length} 个任务`);
                let emptyAdm = 0;
                for (const t of todo.slice(0, SUBSIDY_MAX_TASKS)) {
                    const bounty = Number(t.taskBountyCount) || 0;
                    const adUnitId = t.advertisementUnitId || "";
                    const taskCode = t.taskCode || "";
                    $.log(`\n[${this.userName}]   ▶ ${t.taskName || taskCode}｜${bounty}币｜adUnit=${adUnitId.substring(0, 16)}…`);
                    if (!adUnitId) { $.warn(`[${this.userName}]   无 advertisementUnitId，跳过`); continue; }
                    // Step 2: adx.ssp.show（拉广告）
                    $.log(`[${this.userName}]   1️⃣ adx.ssp.show（拉广告, geo=${AD_CODE}/${CITY_CODE}）`);
                    const showData = await this.adxSspShow(adUnitId);
                    await sleep(SUBSIDY_DELAY_MIN, SUBSIDY_DELAY_MAX);
                    const adm = (showData && showData.adm) || [];
                    if (!Array.isArray(adm) || adm.length === 0) {
                        $.warn(`[${this.userName}]   ⚠ adm 为空（广告库存空/冷却中）→ 跳过此任务，不硬刷`);
                        emptyAdm++;
                        if (emptyAdm >= 2) {
                            $.log(`[${this.userName}]   ⏸ 连续 ${emptyAdm} 个无物料 → 本类型停止`);
                            break;
                        }
                        continue;
                    }
                    emptyAdm = 0;
                    const adm0 = adm[0] || {};
                    $.log(`[${this.userName}]   ✅ adm 非空（${adm.length} 条广告物料）`);
                    // 模拟广告播放（HAR 实证：show→callback 间隔约 124ms，但防风控加延时）
                    await sleep(3000, 6000);
                    // Step 3: adx.ssp.callback（完成上报，服务端发币）
                    $.log(`[${this.userName}]   2️⃣ adx.ssp.callback（callBackType=SHOWED）`);
                    await this.adxSspCallback(adUnitId, adm0);
                    await sleep(SUBSIDY_DELAY_MIN, SUBSIDY_DELAY_MAX);
                    // Step 4: 事件上报
                    $.log(`[${this.userName}]   3️⃣ user.platform.event.upload（eventType=8000）`);
                    await this.uploadEvent(taskCode);
                    total += bounty;
                    $.log(`[${this.userName}]   ✅ 补贴任务 ${taskCode} 完成（预期 +${bounty} 币）`);
                    await sleep(SUBSIDY_DELAY_MIN, SUBSIDY_DELAY_MAX);
                }
            }
            if (total) $.notifyMsg.push(`[${this.userName}] 📺 补贴任务 预期 +${total}金币`);
            $.log(`\n[${this.userName}] ═══ 补贴任务结束：预期共 ${total} 币 ═══`);
        } catch (e) {
            $.warn(`[${this.userName}] 补贴任务异常（已兜底，不影响签到）：${e && e.message ? e.message : e}`);
        } finally {
            this.ckStatus = savedCk;
        }
        return total;
    }

    // 任务系统主流程：hldc 式完整闭环
    // 每轮：taurus.task(主) + showTaskList(兜底) → 过滤可做任务 → acceptTaskList → createOrder→completedOrder → jumpEvent → receiveAward
    // 循环上限 TASK_MAX_ROUNDS，列表空或无可做任务自然退出；每请求间随机延时 2-5 秒防风控
    async runTaskSystem() {
        const savedCk = this.ckStatus; // 任务系统失败不影响签到主流程
        const stat = { rounds: 0, done: 0, award: 0, coin: 0, orderNo: 0, jump: 0, accepted: 0, createOrderFails: 0 };
        let stagnant = 0;            // 连续 0 收益轮次计数（提前退出，防无意义重试）
        const triedNoPayout = new Set(); // 已尝试过但没到账的 taskCode（本轮会话内不再重复打）
        try {
            const sleep = (a, b) => $.wait(Math.floor(a + Math.random() * (b - a)));
            $.log(`\n[${this.userName}] ═══ 任务系统（全链路） ═══`);

            for (let round = 1; round <= TASK_MAX_ROUNDS; round++) {
                stat.rounds = round;
                $.log(`\n[${this.userName}] ── 第 ${round}/${TASK_MAX_ROUNDS} 轮 ──`);

                // 1. 双源拉列表：taurus.task（api 域）为主源，showTaskList（marketingapi 域）兜底合并
                const listRes = await this.getTaskList();
                if (!listRes) { $.log(`[${this.userName}] 任务列表拉取失败，本轮跳过`); continue; }
                let tasks = this.parseTasks(listRes);
                const marsTasks = await this.getShowTaskList();
                if (marsTasks) {
                    const have = new Set(tasks.map(t => t.taskCode));
                    const extra = marsTasks.filter(t => t.taskCode && !have.has(t.taskCode));
                    if (extra.length) { $.log(`[${this.userName}] showTaskList 补充 ${extra.length} 个任务`); tasks = tasks.concat(extra); }
                }
                if (!tasks.length) { $.log(`[${this.userName}] 任务列表为空 → 今日任务已全部完成`); break; }

                // 2. 过滤可做任务：排除视频壳/真实下单/系统权限类；只要 INIT/RUNNING 且未满
                const candidates = tasks.filter(t => {
                    const p = t.marketPlan || "";
                    if (TASK_EXCLUDE_PLANS.has(p)) return false;
                    if (!/^(INIT|RUNNING)$/.test(t.taskStatus || "")) return false;
                    if (Number(t.currentProgress) >= Number(t.totalProgress)) return false;
                    if (/付费会员购卡/.test(t.taskName || "")) return false;
                    if (triedNoPayout.has(t.taskCode)) return false; // 本会话内已试过且没到账，不重复打
                    return true;
                });
                if (!candidates.length) { $.log(`[${this.userName}] 无可做任务（${tasks.length} 个全被排除或已满）→ 退出`); break; }

                // 3. 排序：HAR 实测出过奖的跳转类优先 → INIT 优先 → totalProgress 小者优先
                candidates.sort((a, b) => {
                    const ai = TASK_PRIORITY.indexOf(a.marketPlan), bi = TASK_PRIORITY.indexOf(b.marketPlan);
                    const as = a.taskStatus === "INIT" ? 1 : 0, bs = b.taskStatus === "INIT" ? 1 : 0;
                    return (bi - ai) || (bs - as) || (Number(a.totalProgress) - Number(b.totalProgress));
                });

                // 4. 单轮最多处理 3 个，控制频率防风控
                const todo = candidates.slice(0, 3);
                $.log(`[${this.userName}] 📋 可做 ${candidates.length} 个，本轮处理 ${todo.length} 个`);
                for (const t of todo) $.log(`[${this.userName}]   [${t.taskStatus}] ${t.taskName}｜${t.currentProgress}/${t.totalProgress}｜plan=${t.marketPlan || "?"}｜${t.taskCode}`);
                if (!TASK_SYSTEM_ENABLED) { $.log(`[${this.userName}] 任务系统开关关闭，跳过执行`); break; }

                // 5. 逐个跑 4 步闭环
                const roundCoinBefore = stat.coin, roundAwardBefore = stat.award;
                for (const t of todo) {
                    try {
                        await this.runTaskLoop(t, stat, sleep);
                    } catch (e) {
                        $.warn(`[${this.userName}] 任务 ${t.taskName} 执行异常：${e && e.message ? e.message : e}`);
                    }
                    await sleep(TASK_MIN_DELAY, TASK_MAX_DELAY);
                }

                // 6. 停滞检测：本轮没拿到新金币且没新增领奖 → 把本轮尝试的任务记为「试过无效」，连续 2 轮即退出
                if (stat.coin === roundCoinBefore && stat.award === roundAwardBefore) {
                    todo.forEach(t => triedNoPayout.add(t.taskCode));
                    stagnant += 1;
                    $.log(`[${this.userName}] ⏸ 本轮零收益（第 ${stagnant} 轮停滞）`);
                    if (stagnant >= 2) { $.log(`[${this.userName}] 连续 ${stagnant} 轮零收益 → 退出（剩余任务需真实跳转/服务端子校验，纯 jumpEvent 无法推进）`); break; }
                } else {
                    stagnant = 0;
                }
            }

            // 6. 汇总统计
            $.log(`\n[${this.userName}] ═══ 任务系统汇总 ═══`);
            $.log(`[${this.userName}] 轮次 ${stat.rounds}｜完成 ${stat.done}｜领奖 ${stat.award}｜orderNo ${stat.orderNo}｜jumpEvent ${stat.jump}｜接任务 ${stat.accepted}`);
            if (TASK_TRY_CREATE_ORDER) $.log(`[${this.userName}] createOrder 失败 ${stat.createOrderFails} 次（2026 接口已下线则恒失败）`);
            if (stat.coin) { $.log(`[${this.userName}] 🪙 任务奖励金到账 ${stat.coin}`); $.notifyMsg.push(`[${this.userName}] 🎉 任务奖励金 +${stat.coin}`); }
            $.log(`[${this.userName}] ═══ 任务系统结束 ═══`);
        } catch (e) {
            $.warn(`[${this.userName}] 任务系统异常（已兜底，不影响签到）：${e && e.message ? e.message : e}`);
        } finally {
            this.ckStatus = savedCk; // 任务系统失败不影响签到主流程的账号有效性判定
        }
    }
    // 单任务 4 步闭环：acceptTaskList → createOrder → completedOrder(orderNo) → jumpEvent → receiveAward
    // 控制流（实测确定）：
    //   - createOrder 拿到 orderNo → completedOrder(带orderNo) 完成任务 → 跳过纯 jumpEvent（会 40600001 无效订单）
    //   - createOrder 失败(50608002 不符合参与条件) → 降级走纯 jumpEvent（weekly_cash 场景）
    //   - 跳转类任务(无 orderNo 机制) → 直接 jumpEvent
    async runTaskLoop(t, stat, sleep) {
        const n = t.taskName || t.taskCode;
        $.log(`\n[${this.userName}] ── ▶ ${n} (${t.taskCode}) plan=${t.marketPlan || "?"} ──`);

        // Step1: 接任务
        const acc = await this.acceptTask(t.taskCode, t.taskGroupCode);
        const accCode = acc && acc.code;
        stat.accepted += (accCode === 0 ? 1 : 0);
        $.log(`[${this.userName}]    1️⃣ acceptTaskList code=${accCode} msg=${(acc && acc.msg) || ""}`);
        if (accCode !== 0) { $.warn(`[${this.userName}]    ⛔ 接任务失败，跳过后续`); return; }

        // Step2: createOrder + completedOrder（hldc 链路；实测 order_cross_money 等 plan 可用）
        let orderNo = null, completed = false;
        if (TASK_TRY_CREATE_ORDER) {
            const co = await this.createOrder(t.taskCode);
            const coCode = co && co.code;
            orderNo = co && co.data && co.data.orderNo;
            if (orderNo) {
                stat.orderNo += 1;
                $.log(`[${this.userName}]    2️⃣ createOrder ✅ orderNo=${orderNo}`);
                await sleep(TASK_MIN_DELAY, TASK_MAX_DELAY);
                const doneRes = await this.completedOrder(t.taskCode, orderNo);
                const doneOk = doneRes && (doneRes.code === 0 || doneRes.success);
                completed = !!doneOk;
                stat.jump += completed ? 1 : 0;
                $.log(`[${this.userName}]    2️⃣ completedOrder code=${doneRes && doneRes.code} success=${doneRes && doneRes.success}${completed ? "（任务已标记完成）" : "（completedOrder 未成功，仍尝试 jumpEvent）"}`);
            } else {
                stat.createOrderFails += 1;
                $.log(`[${this.userName}]    2️⃣ createOrder 无 orderNo（code=${coCode} msg=${(co && co.msg) || ""}）→ 降级走纯 jumpEvent 链路`);
            }
        } else {
            $.log(`[${this.userName}]    2️⃣ createOrder 跳过（TASK_TRY_CREATE_ORDER=false）`);
        }

        // Step3: 跳转事件上报——仅在 completedOrder 未成功时走（completedOrder 已成功则 jumpEvent 会报 40600001 无效订单）
        if (!completed) {
            await sleep(TASK_MIN_DELAY, TASK_MAX_DELAY);
            const jump = await this.jumpEvent(t.taskCode);
            const jumpCode = jump && jump.code;
            const jumpOk = jumpCode === 0 || (jump && jump.success);
            stat.jump += jumpOk ? 1 : 0;
            $.log(`[${this.userName}]    3️⃣ jumpEvent code=${jumpCode} success=${jump && jump.success} msg=${(jump && jump.msg) || ""}`);
        } else {
            $.log(`[${this.userName}]    3️⃣ jumpEvent 跳过（completedOrder 已完成任务，纯 jumpEvent 会 40600001 无效订单）`);
        }

        // Step4: 领取奖励（HAR 实测：code=0 且 data.taskCenterAwardList[].worth 为到账金币）
        await sleep(TASK_MIN_DELAY, TASK_MAX_DELAY);
        if (!t.taskGuid) { $.log(`[${this.userName}]    4️⃣ receiveAward 跳过（缺 taskGuid）`); return; }
        const ra = await this.receiveAward(t.taskGuid, t.taskGroupCode);
        const raCode = ra && ra.code;
        const raOk = raCode === 0 && (ra && ra.success !== false);
        let worth = 0;
        const list = ra && ra.data && ra.data.taskCenterAwardList;
        if (Array.isArray(list)) worth = list.reduce((a, x) => a + (Number(x && x.worth) || 0), 0);
        if (raOk) {
            stat.award += 1;
            stat.coin += worth;
            $.log(`[${this.userName}]    4️⃣ receiveAward ✅ offerStatus=${ra.data && ra.data.offerStatus} 奖励金+${worth}｜${(ra.data && ra.data.taskName) || ""}`);
            if (worth) $.notifyMsg.push(`[${this.userName}] 🎁 领奖 ${n} +${worth}金币`);
            stat.done += 1;
        } else {
            $.log(`[${this.userName}]    4️⃣ receiveAward 未到账（code=${raCode} msg=${(ra && ra.msg) || ""} offerStatus=${ra && ra.data && ra.data.offerStatus}）`);
        }
    }
}

// 远程通知（共享社区公告 + 网络连通性预检）
async function getNotice() {
    const urls = [
        "https://fastly.jsdelivr.net/gh/Sliverkiss/GoodNight@main/notice.json",
        "https://fastly.jsdelivr.net/gh/Sliverkiss/GoodNight@main/tip.json"
    ];
    try {
        const responses = await Promise.all(urls.map(url => Request(url)));
        responses.map(result => $.log((result && result.notice) || "获取通知失败"));
        return true; // 网络可达即视为预检通过
    } catch (error) {
        $.log(`❌获取通知时发生错误：${error}`);
        return false;
    }
}

function maskString(input) {
    try {
        if (!input) return input;
        if (input && input.length <= 6) {
            return input;
        }
        let start = input.slice(0, 3);
        let end = input.slice(-3);
        return `${start}****${end}`;
    } catch (e) {
        return input
    }
}

// 脱敏 body：32 位 hex 只留前 8 位 + …，再截断到 200 字符（供失败时截图反馈）
function sanitizeBody(s) {
    const str = String(s || '');
    const masked = str.replace(/[0-9a-f]{32}/g, m => `${m.slice(0, 8)}…`);
    return masked.slice(0, 200);
}

// 兜底：从任意字符串（如 URL）里捞 32 位 hex token
function pickToken(s) {
    const m = String(s || '').match(/([0-9a-f]{32})/);
    return m ? m[1] : '';
}

// 生成 15 位随机 requestId（哈啰请求头要求）
function randomRequestId() {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let s = '';
    for (let i = 0; i < 15; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}
// 生成 UUID v4（补贴任务 sessionId 用）
function genUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}
// 补贴任务时间窗解析：把服务端下发的 startTime/endTime 转成 13 位毫秒戳
// 兼容三种格式：13 位毫秒戳、10 位秒戳、"HH:MM:SS"/"HH:MM"（HAR 实证为 HH:MM:SS）
function parseWindowMs(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    if (/^\d{13}$/.test(s)) return parseInt(s);
    if (/^\d{10}$/.test(s)) return parseInt(s) * 1000;
    const m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
    if (m) {
        const h = parseInt(m[1]), mi = parseInt(m[2]), se = parseInt(m[3] || '0');
        const d = new Date();
        d.setHours(h, mi, se, 0);
        return d.getTime();
    }
    return null;
}
// 格式化时间窗为 HH:MM 显示
function fmtHm(v) {
    const ms = parseWindowMs(v);
    if (ms == null) return String(v);
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// 获取 Cookie - 从请求体拦截 token
async function getCookie() {
    // ─── 响应模式：script-response-body 触发，从响应体补全 userGuid/userNewId ───
    if (typeof $response !== "undefined" && $response && $response.body) {
        const respStr = typeof $response.body === 'string' ? $response.body : JSON.stringify($response.body);
        console.log(`[hellobike][getCookie][RESP] 响应体长度 ${respStr.length} | URL=${($request && $request.url) || ''}`);
        try {
            const dev = $.toObj($.getdata("hl_wl_dev")) || { deviceHash: "", hello_token: "", ticket: "", userGuid: "", userNewId: "" };
            const mUg = respStr.match(/"userGuid"\s*:\s*"([0-9a-f]{8,64})"/);
            if (mUg) dev.userGuid = mUg[1];
            const mUn = respStr.match(/"userNewId"\s*:\s*"?(\d{4,20})"?/);
            if (mUn) dev.userNewId = mUn[1];
            // 顺带从响应体补 deviceHash/hello_token（部分接口响应也带）
            const mDh = respStr.match(/"deviceHash"\s*:\s*"([0-9a-f]{32,64})"/);
            if (mDh) dev.deviceHash = mDh[1];
            const mHt = respStr.match(/"hello_token"\s*:\s*"?(\d{16,24})"?/);
            if (mHt) dev.hello_token = mHt[1];
            $.setjson(dev, "hl_wl_dev");
            // 取已存的 token 拼 hl_data 通知
            const uc = $.toObj($.getdata(ckName)) || [];
            const last = uc.length ? (uc[uc.length - 1].token || uc[uc.length - 1]) : "";
            const devStr = [last, dev.deviceHash, dev.hello_token, dev.ticket, dev.userGuid, dev.userNewId].join("|");
            $.msg($.name, `📋 响应抓取补全设备段`, `hl_data=${devStr}`);
            return;
        } catch (e) {
            console.log(`[hellobike][getCookie][RESP][ERROR] ${e.message || e}`);
            throw e;
        }
    }

    // ─── 请求模式：script-request-body 触发，抓 token + 设备凭据 ───
    const raw = $request && $request.body;
    // 可观测性：触发即打印命中 URL，区分「rewrite 没触发」与「脚本内部失败」
    console.log(`[hellobike][getCookie] 触发 | ${($request && $request.method) || ''} ${($request && $request.url) || ''}`);

    try {
        if ($request && $request.method === 'OPTIONS') return;

        // script-request-body 下 body 通常是字符串，但部分环境会直接给对象——两形态都要取到
        let token = '';
        if (raw && typeof raw === 'object') {
            token = raw.token || '';
        } else if (typeof raw === 'string') {
            try {
                token = JSON.parse(raw).token || '';
            } catch (e) {
                token = (raw.match(/([0-9a-f]{32})/) || [''])[0];
            }
        }
        if (!TOKEN_RE.test(token)) {
            // body 没取到 token，再兜底从 URL query 捞一次
            token = pickToken(($request && $request.url) || '');
        }
        if (!TOKEN_RE.test(token)) {
            // 失败不静默：打印脱敏 body 前 200 字符，方便截图反馈
            console.log(`[hellobike][getCookie][FAIL] body 内未取到 32 位 hex token | body=${sanitizeBody(raw)}`);
            // 发一条 [DEBUG] 调试通知：区分「触发成功但没提取到 token」，便于截图反馈
            $.msg($.name, `[DEBUG] 触发成功但未提取到 token`, `URL: ${($request && $request.url) || ''}\nBody(脱敏前200): ${sanitizeBody(raw) || '(空)'}`);
            throw new Error("获取 token 失败！请求体中未找到 32 位十六进制 token");
        }

        const newData = {
            "token": token,
            "userName": `哈啰${maskString(token)}`
        }

        // 多账户去重/更新：同 token 更新该条目，新 token 追加到末尾
        // 兼容旧数据格式（纯字符串存储），统一升级为 {token, userName} 对象
        let found = false;
        for (let i = 0; i < userCookie.length; i++) {
            const existingToken = (userCookie[i] && userCookie[i].token) || userCookie[i];
            if (existingToken === token) {
                userCookie[i] = newData; // 同 token → 更新
                found = true;
                break;
            }
        }
        if (!found) {
            userCookie.push(newData); // 新 token → 追加
        }

        // 写入统一键 hl_data
        $.setjson(userCookie, ckName);

        // ─── 设备凭据抓取（subsidy.detail 请求体直带 deviceHash/hello_token）───
        const bodyStr = typeof raw === 'string' ? raw : (raw ? JSON.stringify(raw) : '');
        const dev = $.toObj($.getdata("hl_wl_dev")) || { deviceHash: "", hello_token: "", ticket: "", userGuid: "", userNewId: "" };
        const mDh = bodyStr.match(/"deviceHash"\s*:\s*"([0-9a-f]{32,64})"/);
        if (mDh) dev.deviceHash = mDh[1];
        const mHt = bodyStr.match(/"hello_token"\s*:\s*"(\d{16,24})"/);
        if (mHt) dev.hello_token = mHt[1];
        // ticket 含点号（MTc5….0jDY…两段base64），QX 明文体里通常抓不到，尽力而为
        const mTk = bodyStr.match(/"ticket"\s*:\s*"([A-Za-z0-9+\/=.]{20,400})"/);
        if (mTk) dev.ticket = mTk[1];
        const mUg = bodyStr.match(/"userGuid"\s*:\s*"([0-9a-f]{8,64})"/);
        if (mUg) dev.userGuid = mUg[1];
        const mUn = bodyStr.match(/"userNewId"\s*:\s*"(\d{4,20})"/);
        if (mUn) dev.userNewId = mUn[1];
        // 请求头兜底（adx 加密链指纹六件套）
        const hd = ObjectKeys2LowerCase($request.headers);
        if (hd["fingerprint-hash"] && /^[0-9a-f]{32,64}$/.test(hd["fingerprint-hash"])) dev.deviceHash = hd["fingerprint-hash"];
        if (hd["hello_token"] && /^\d{16,24}$/.test(hd["hello_token"])) dev.hello_token = hd["hello_token"];
        $.setjson(dev, "hl_wl_dev");

        // 通知内容 = 青龙环境变量 hl_data（单变量单行），直接复制粘贴
        const devStr = [token, dev.deviceHash, dev.hello_token, dev.ticket, dev.userGuid, dev.userNewId].join("|");
        $.msg($.name, `🎉账号[${newData.userName}]更新 token 成功!`, `hl_data=${devStr}`);
    } catch (e) {
        // 失败路径也留痕：脱敏 body + 错误原因，便于区分「rewrite 没触发」与「脚本内部失败」
        console.log(`[hellobike][getCookie][ERROR] ${e.message || e} | body=${sanitizeBody(raw)}`);
        throw e;
    }
}

//主程序执行入口
!(async () => {
    if (typeof $response !== "undefined") {
        // script-response-body 触发：从响应体补全 userGuid/userNewId
        try {
            await getCookie();
        } catch (e) {
            try { $notify("哈啰诊断", "响应抓取异常", (e && e.message) || String(e)); } catch (_) {}
            throw e;
        }
    } else if (typeof $request != "undefined") {
        try {
            await getCookie();
        } catch (e) {
            // 【诊断探针】getCookie 异常时裸 $notify 兜底（Env 的 $.msg 依赖 Env 正常构造，此处双保险）
            try { $notify("哈啰诊断", "getCookie 异常", (e && e.message) || String(e)); } catch (_) {}
            throw e;
        }
    } else {
        if (!(await getNotice())) throw new Error("网络状况不好，请重新尝试~")
        await checkEnv();
        await main();
    }
})()
    .catch((e) => { $.logErr(e), $.msg($.name, `⛔️ script run error!`, e.message || e) })
    .finally(() => $.done());

/** ---------------------------------固定不动区域----------------------------------------- */
//prettier-ignore
function createProxy(t, n) { return new Proxy(t, { get(t, r) { const c = t[r]; return "function" == typeof c ? async function (...r) { try { return await c.apply(t, r) } catch (r) { n.call(t, r) } } : c } }) }
async function sendMsg(a, e) { a && ($.isNode() ? await notify.sendNotify($.name, a) : $.msg($.name, $.title || "", a, e)) }
function DoubleLog(o) { o && ($.log(`${o}`), $.notifyMsg.push(`${o}`)) };
async function checkEnv() { try { if (!userCookie?.length) throw new Error("no available accounts found (hl_data 未配置)"); const valid = userCookie.filter(o => TOKEN_RE.test(o?.token || o)); if (!valid.length) throw new Error("no valid 32-hex tokens found"); $.log(`\n[INFO] 检测到 ${userCookie?.length ?? 0} 个 token，有效 ${valid.length} 个\n`), $.userList.push(...valid.map((o => new UserInfo(o))).filter(Boolean)) } catch (o) { throw o } }
function debug(g, e = "debug") { "true" === $.is_debug && ($.log(`\n-----------${e}------------\n`), $.log("string" == typeof g ? g : $.toStr(g) || `debug error => t=${g}`), $.log(`\n-----------${e}------------\n`)) }
//From xream's ObjectKeys2LowerCase
function ObjectKeys2LowerCase(obj) { return !obj ? {} : Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v])) };
//From sliverkiss's Request
async function Request(t) { "string" == typeof t && (t = { url: t }); try { if (!t?.url) throw new Error("[URL][ERROR] 缺少 url 参数"); let { url: o, type: e, headers: r = {}, body: s, params: a, dataType: n = "form", resultType: u = "data" } = t; const p = e ? e?.toLowerCase() : "body" in t ? "post" : "get", c = o.concat("post" === p ? "?" + $.queryStr(a) : ""), i = t.timeout ? $.isSurge() ? t.timeout / 1e3 : t.timeout : 1e4; "json" === n && (r["Content-Type"] = "application/json;charset=UTF-8"); const y = "string" == typeof s ? s : (s && "form" == n ? $.queryStr(s) : $.toStr(s)), l = { ...t, ...t?.opts ? t.opts : {}, url: c, headers: r, ..."post" === p && { body: y }, ..."get" === p && a && { params: a }, timeout: i }, m = $.http[p.toLowerCase()](l).then((t => "data" == u ? $.toObj(t.body) || t.body : $.toObj(t) || t)).catch((t => $.log(`[${p.toUpperCase()}][ERROR] ${t}\n`))); return Promise.race([new Promise(((t, o) => setTimeout((() => o("当前请求已超时")), i))), m]) } catch (t) { console.log(`[${p.toUpperCase()}][ERROR] ${t}\n`) } }
//jwt parse tool
function parseJwt(t) { const e = t.split("."); if (3 !== e.length) throw new Error("Invalid JWT token"); const a = JSON.parse(o(e[0])), r = JSON.parse(o(e[1])), n = new Date(1e3 * r.exp), p = new Date(parseInt(r.create_date)); return { header: a, payload: r, expDate: g(n), createDate: g(p) }; function o(t) { let e = t.replace(/-/g, "+").replace(/_/g, "/"), a = e.length % 4; a && (e += "=".repeat(4 - a)); const r = atob(e); return decodeURIComponent(escape(r)) } function g(t) { return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}` } }
//From chavyleung's Env.js
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, i) => { s.call(this, t, ((t, s, o) => { t ? i(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.logLevels = { debug: 0, info: 1, warn: 2, error: 3 }, this.logLevelPrefixs = { debug: "[DEBUG] ", info: "[INFO] ", warn: "[WARN] ", error: "[ERROR] " }, this.logLevel = "info", this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null, ...s) { try { return JSON.stringify(t, ...s) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, i) => e(i))) })) } runScript(t, e) { return new Promise((s => { let i = this.getdata("@chavy_boxjs_userCfgs.httpapi"); i = i ? i.replace(/\n/g, "").trim() : i; let o = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); o = o ? 1 * o : 20, o = e && e.timeout ? e.timeout : o; const [r, a] = i.split("@"), n = { url: `http://${a}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: o }, headers: { "X-Key": r, Accept: "*/*" }, timeout: o }; this.post(n, ((t, e, i) => s(i))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e); if (!s && !i) return {}; { const i = s ? t : e; try { return JSON.parse(this.fs.readFileSync(i)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e), o = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, o) : i ? this.fs.writeFileSync(e, o) : this.fs.writeFileSync(t, o) } } lodash_get(t, e, s) { const i = e.replace(/\[(\d+)\]/g, ".$1").split("."); let o = t; for (const t of i) if (o = Object(o)[t], void 0 === o) return s; return o } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, i) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[i + 1]) >> 0 == +e[i + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, i] = /^@(.*?)\.(.*?)$/.exec(t), o = s ? this.getval(s) : ""; if (o) try { const t = JSON.parse(o); e = t ? this.lodash_get(t, i, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, i, o] = /^@(.*?)\.(.*?)$/.exec(e), r = this.getval(i), a = i ? "null" === r ? null : r || "{}" : "{}"; try { const e = JSON.parse(a); this.lodash_set(e, o, t), s = this.setval(JSON.stringify(e), i) } catch (e) { const r = {}; this.lodash_set(r, o, t), s = this.setval(JSON.stringify(r), i) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.cookie && void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar))) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, i) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: i, headers: o, body: r, bodyBytes: a } = t; e(null, { status: s, statusCode: i, headers: o, body: r, bodyBytes: a }, r, a) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: i, statusCode: o, headers: r, rawBody: a } = t, n = s.decode(a, this.encoding); e(null, { status: i, statusCode: o, headers: r, rawBody: a, body: n }, n) }), (t => { const { message: i, response: o } = t; e(i, o, o && s.decode(o.rawBody, this.encoding)) })); break } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, i) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: i, headers: o, body: r, bodyBytes: a } = t; e(null, { status: s, statusCode: i, headers: o, body: r, bodyBytes: a }, r, a) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let i = require("iconv-lite"); this.initGotEnv(t); const { url: o, ...r } = t; this.got[s](o, r).then((t => { const { statusCode: s, statusCode: o, headers: r, rawBody: a } = t, n = i.decode(a, this.encoding); e(null, { status: s, statusCode: o, headers: r, rawBody: a, body: n }, n) }), (t => { const { message: s, response: o } = t; e(s, o, o && i.decode(o.rawBody, this.encoding)) })); break } } time(t, e = null) { const s = e ? new Date(e) : new Date; let i = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in i) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? i[e] : ("00" + i[e]).substr(("" + i[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let i = t[s]; null != i && "" !== i && ("object" == typeof i && (i = JSON.stringify(i)), e += `${s}=${i}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", i = "", o = {}) { const r = t => { const { $open: e, $copy: s, $media: i, $mediaMime: o } = t; switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: { const r = {}; let a = t.openUrl || t.url || t["open-url"] || e; a && Object.assign(r, { action: "open-url", url: a }); let n = t["update-pasteboard"] || t.updatePasteboard || s; if (n && Object.assign(r, { action: "clipboard", text: n }), i) { let t, e, s; if (i.startsWith("http")) t = i; else if (i.startsWith("data:")) { const [t] = i.split(";"), [, o] = i.split(","); e = o, s = t.replace("data:", "") } else { e = i, s = (t => { const e = { JVBERi0: "application/pdf", R0lGODdh: "image/gif", R0lGODlh: "image/gif", iVBORw0KGgo: "image/png", "/9j/": "image/jpg" }; for (var s in e) if (0 === t.indexOf(s)) return e[s]; return null })(i) } Object.assign(r, { "media-url": t, "media-base64": e, "media-base64-mime": o ?? s }) } return Object.assign(r, { "auto-dismiss": t["auto-dismiss"], sound: t.sound }), r } case "Loon": { const s = {}; let o = t.openUrl || t.url || t["open-url"] || e; o && Object.assign(s, { openUrl: o }); let r = t.mediaUrl || t["media-url"]; return i?.startsWith("http") && (r = i), r && Object.assign(s, { mediaUrl: r }), console.log(JSON.stringify(s)), s } case "Quantumult X": { const o = {}; let r = t["open-url"] || t.url || t.openUrl || e; r && Object.assign(o, { "open-url": r }); let a = t["media-url"] || t.mediaUrl; i?.startsWith("http") && (a = i), a && Object.assign(o, { "media-url": a }); let n = t["update-pasteboard"] || t.updatePasteboard || s; return n && Object.assign(o, { "update-pasteboard": n }), console.log(JSON.stringify(o)), o } case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, i, r(o)); break; case "Quantumult X": $notify(e, s, i, r(o)); break; case "Node.js": break }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), i && t.push(i), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } debug(...t) { this.logLevels[this.logLevel] <= this.logLevels.debug && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.debug}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } info(...t) { this.logLevels[this.logLevel] <= this.logLevels.info && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.info}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } warn(...t) { this.logLevels[this.logLevel] <= this.logLevels.warn && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.warn}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } error(...t) { this.logLevels[this.logLevel] <= this.logLevels.error && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.error}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.map((t => t ?? String(t))).join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, e, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, e, void 0 !== t.message ? t.message : t, t.stack); break } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }
