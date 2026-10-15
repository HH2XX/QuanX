# HH2XX QuanX

Quantumult X 签到任务及附加组件配置。

## 使用方式

### 添加定时任务

在 Quantumult X 的任务订阅中添加：

```text
https://raw.githubusercontent.com/HH2XX/QuanX/refs/heads/main/Tasks/task.json
```

### 添加附加组件

各任务目录中的 `.snippet` 文件用于附加组件入口。例如：

```text
https://raw.githubusercontent.com/HH2XX/QuanX/refs/heads/main/Tasks/CalShot/CalShot.snippet
```

添加后打开对应 App，触发一次匹配请求，脚本会自动保存 Cookie 或请求头。首次使用前请确保已开启 Quantumult X 的 MitM，并安装证书。

### 手动导入

各任务目录中的 `.conf` 文件包含重写、定时任务和 MitM 配置，可在 Quantumult X 中手动导入。`.snippet` 仅用于附加组件，不包含 `[rewrite_local]`、`[task_local]` 或 `[mitm]` 配置段。

## 目录结构

```text
Tasks/
├── task.json       # 任务订阅清单
├── 任务目录/
│   ├── *.js        # 签到及凭据获取脚本
│   ├── *.snippet   # 附加组件规则
│   └── *.conf      # 完整 Quantumult X 配置
icon/               # 任务图标
```

## 注意事项

- 不同任务需要对应 App 的登录状态或 Cookie。
- Cookie、请求头等敏感信息仅保存在本地 Quantumult X 环境中，请勿提交到仓库。
- 任务接口或 App 改版后可能需要更新脚本规则。
- 请合理设置任务频率，遵守相关服务的使用条款。
