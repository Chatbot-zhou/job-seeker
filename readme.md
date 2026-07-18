# Job Seeker

Job Seeker 是一个本机运行的 BOSS 直聘辅助工具。它由 Python 本地后端、命令行控制台和 Tampermonkey 油猴脚本组成，用来读取岗位、调用模型评分、记录历史，并在用户确认好配置后自动执行打招呼流程。

当前版本走“双启动器”路线：

- `start_job_seeker.bat`：人工模式。用于首次配置、编辑简历、生成画像、确认标签、设置模型、查看状态和排查问题。
- `start_job_seeker_auto.bat`：自动模式。读取已有配置后直接运行，适合日常使用，也适合让 Hermes、Codex 或其他本机 agent 打开。

项目不再提供 MCP 或 JSON Agent 控制入口。`python main.py agent` 和 `python main.py mcp` 会明确提示不支持。

> 当前版本只做岗位分析和打招呼流程。普通 BOSS 聊天页不会自动检查官方附件简历请求卡片，也不会自动发送简历附件。简历文件仍用于画像、标签、岗位评分和话术生成。

## 当前核心策略

1. 启动后优先进入 BOSS Web 推荐页 `https://www.zhipin.com/web/geek/jobs`。
2. 脚本先识别并处理用户自定义推荐 Tab，跳过系统默认“推荐”Tab。
3. 每个自定义推荐 Tab 默认低频滚动读取 20 次；滚动过程中发现多少新岗位就处理多少。
4. 推荐 Tab 全部处理后，再进入关键词标签搜索。
5. 关键词搜索每轮每个标签只搜索一次；所有标签无新岗位后进入 1-5 分钟随机冷却。
6. 每个推荐源或关键词会低频滚动左侧岗位列表，默认最多 20 次，不做高频刷新。
7. 模型评分达到阈值、历史未重复、公司未超限后，进入聊天页发送已确认话术。
8. 聊天页发送会在同一个页面内最多尝试 3 次；仍失败则关闭当前临时页，记录失败并暂停系统。
9. 如果点击发送后结果无法确认，记录 `greet_delivery_unknown`，关闭当前临时页，跳过该岗位，继续运行。
10. BOSS “温馨提示/剩余次数”弹窗会自动点击确认后继续；登录过期、验证码、安全验证、访问过频等风险状态不会绕过，会暂停或停止并提示人工处理。

安全边界保持不变：系统不会绕过登录、验证码、Tampermonkey 安装确认、浏览器权限或平台风控。

## 快速开始

### 1. 准备环境

推荐使用 Windows + Chrome/Edge + Tampermonkey。

本项目启动器会优先使用项目内 `.venv`。如果 `.venv` 不存在，自动启动器会尝试创建并安装依赖。

手动安装依赖：

```powershell
cd E:\Desktop\goodjobs-main
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

开发测试依赖：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

### 2. 首次配置

双击：

```text
start_job_seeker.bat
```

进入 CLI 后，建议按这个顺序处理：

```text
config
resume
profile
tags
greeting
status
doctor
```

常见输入文件位置：

- 简历 PDF 建议放在 `data/resume/`。
- 粘贴文件路径时不需要带引号。
- 岗位标签保存在 `data/cache/tags.txt`。
- 打招呼话术保存在 `data/cache/greeting.json`。
- 用户画像保存在 `data/cache/user_detail.md`。

### 3. 安装或更新油猴脚本

CLI 启动后会提供脚本地址：

```text
http://127.0.0.1:33333/web_script.user.js
```

复制地址时不要复制多余标点。Tampermonkey 打开安装页后，点击“安装”或“更新”。

每次修改 `web_script.js` 后，都需要重新打开这个地址更新浏览器里的油猴脚本。只改本地文件但不更新脚本，浏览器仍会运行旧逻辑。

### 4. 打开 BOSS 页面

推荐打开：

```text
https://www.zhipin.com/web/geek/jobs
```

这个页面包含系统推荐和用户自定义推荐 Tab。当前脚本会跳过系统默认“推荐”，优先处理用户自己设置的岗位推荐 Tab。

关键词搜索页也能使用：

```text
https://www.zhipin.com/web/geek/job
```

但如果本轮推荐源还没处理完，脚本会先跳回推荐页。关键词搜索进入冷却后，脚本会补充扫描一轮用户自定义推荐源；补充扫描完成后继续等待关键词冷却结束。

### 5. 开始运行

人工模式中输入：

```text
start
```

CLI 会确认岗位标签和运行配置，然后允许脚本运行。

日常直接运行可以双击：

```text
start_job_seeker_auto.bat
```

自动模式会使用已保存配置，不打开编辑器、不询问 `start`，但仍不会绕过登录、验证码、脚本安装确认和平台风控。

## 模型配置

默认本地模型：

```text
ollama / qwen3:1.7b
```

小模型建议关闭思考功能，尤其是岗位评分。当前默认：

```json
"disable_model_thinking": true
```

如果使用 OpenAI 兼容接口，比如火山引擎、豆包、DeepSeek、通义千问兼容 API，可以在人工模式 `config` 中设置：

- `model_provider=openai`
- `openai_api_base`
- `think_model`
- `external_model_profile`

火山引擎要特别注意 Base URL 和模型名必须属于同一种接入方式：

| 接入方式 | `openai_api_base` | 模型名示例 |
| --- | --- | --- |
| 按量在线推理 | `https://ark.cn-beijing.volces.com/api/v3` | `deepseek-v3-2-251201` |
| Coding Plan | `https://ark.cn-beijing.volces.com/api/coding/v3` | `deepseek-v3.2` 或 `ark-code-latest` |

如果 `/models` 能看到模型，但真实生成返回 `InvalidEndpointOrModel.NotFound`，通常不是脚本问题，而是当前 Key 对该 Chat 模型/Endpoint 没有调用权限，或把 Coding Plan 与按量在线推理的 Base URL/模型名混用了。此时先用 `doctor` 看模型真实生成检查，再确认火山控制台里的开通方式、余额和权限。

### API Key 建议

推荐使用环境变量：

```powershell
$env:OPENAI_API_KEY="你的密钥"
```

`OPENAI_API_KEY` 优先级高于 `data/config.json`。当环境变量存在时，程序不会把环境变量中的 Key 写回配置文件，`/status` 和 `/config` 也只会显示“已配置/来源”，不会返回明文。

如果曾经把真实 Key 写入 `data/config.json`，建议到服务商控制台轮换旧 Key，再迁移到环境变量。

## 搜索与推荐策略

### 用户自定义推荐 Tab

当前脚本会在 `/web/geek/jobs` 页面扫描推荐 Tab：

- 固定系统 Tab，如“推荐”“系统推荐”“为你推荐”，会被跳过。
- 系统推荐旁边的用户自定义 Tab 会被识别为推荐源。
- `地图`、`筛选`、`附近`、`求职类型`、`薪资待遇`、`立即沟通`、职位卡片内容等不会被当作推荐源。
- 真实岗位方向，例如 `自然语言处理算法(北京)`、`大模型算法(杭州)`，会被作为自定义推荐源处理。

每个自定义推荐 Tab 默认不按岗位数量截断，而是默认低频滚动读取 20 次；滚动过程中发现多少新岗位就处理多少：

```json
"search_result_scroll_rounds": 20,
"preferred_feed_max_jobs_per_tab": 0
```

`preferred_feed_max_jobs_per_tab=0` 表示不限制单个 Tab 的处理数量。仍受历史去重、搜索节流和平台风控限制。

### 关键词搜索

推荐 Tab 处理完后，脚本进入关键词标签搜索。标签来自：

```text
data/cache/tags.txt
```

当前默认策略：

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `search_round_cooldown_min_minutes` | `1` | 一轮关键词全部无新岗位后的最短冷却分钟数 |
| `search_round_cooldown_minutes` | `10` | 一轮关键词全部无新岗位后的最长冷却分钟数 |
| `tag_search_delay_seconds` | `20` | 标签切换最小等待秒数 |
| `tag_search_delay_max_seconds` | `45` | 标签切换最大等待秒数 |
| `max_search_submissions_per_hour` | `6` | 每小时最多提交关键词搜索次数 |
| `max_search_submissions_per_day` | `30` | 每日最多提交关键词搜索次数 |
| `search_result_scroll_rounds` | `20` | 每个推荐源或关键词最多低频滚动读取次数 |

冷却期间脚本仍在线，不提交关键词搜索、不高频刷新页面。进入关键词冷却时会先补充扫描一轮用户自定义推荐源，补充完成后再静默等待冷却结束。`status` 和 `doctor` 会显示冷却状态。

### APP 推荐和 Web 推荐不同

BOSS 手机 APP 推荐流和 Web 端 `/web/geek/jobs` 不是完全相同的入口。脚本不会模拟 APP 推荐接口，也不会调用移动端接口。建议在 BOSS 网页端多设置几个清晰的自定义推荐 Tab，再用关键词搜索补充。

## 打招呼策略

当前版本仍使用本地已确认话术在聊天页发送消息。用户需要先在人工模式用 `greeting` 命令生成、编辑并确认话术。

打招呼流程：

1. 详情页读取岗位。
2. 模型评分。
3. 达到阈值后请求沟通入口或打开聊天页。
4. 聊天页读取已确认话术。
5. 写入输入框。
6. 点击发送按钮；如果按钮不可用，会尝试使用 Enter 发送。
7. 检查聊天记录或输入框状态，判断发送是否成功。

当前重试规则：

| 步骤 | 策略 |
| --- | --- |
| BOSS “温馨提示”剩余次数弹窗 | 自动识别并点击“好”，随后继续当前流程 |
| 聊天页打开失败 | 尚未点击发送时可有限重试 |
| 输入框未出现 | 在当前聊天页等待并重试 |
| 写入失败 | 当前聊天页最多 3 次发送尝试 |
| 发送按钮不可用 | 尝试 Enter 发送 |
| 发送结果确认失败 | 记录 `greet_delivery_unknown`，关闭临时页，跳过当前岗位，继续下一个 |
| 连续 3 次发送失败 | 暂停系统并提示人工查看 |
| 登录/验证码/访问过频 | 暂停或停止，不继续自动化 |
| 页面身份不一致 | 暂停并保留页面，避免发错聊天对象 |

这样做的取舍是：优先保持整体运行连续，不因为单个岗位发送状态不明就停住；同时用 `greet_delivery_unknown` 保留证据，避免把未知结果当作成功计数。

## 弹窗、失败与风控

当前版本不再设置“本轮最多打招呼数量”或“每日自动打招呼安全上限”。成功次数只作为状态统计展示，不作为自动停止条件。

BOSS 约 120 次后可能出现“温馨提示”弹窗，例如：

```text
您今天已与120位BOSS沟通，还剩30次沟通机会哦
```

脚本会优先识别这类居中弹窗，并点击同一弹窗内的 `好` / `确定` / `知道了`，确认后继续运行。真正到达平台上限或聊天页异常时，通常会表现为输入框、发送按钮或发送确认连续失败；脚本会完成首次 + 2 次重试，总计 3 次失败后暂停系统，避免无限开页或无限报错。

验证码、登录过期、访问异常、操作过频不属于正常弹窗，脚本不会尝试绕过。

## 常用 CLI 命令

| 命令 | 作用 |
| --- | --- |
| `status` | 查看系统状态、脚本连接、计数、冷却、模型状态 |
| `doctor` | 检查依赖、模型、脚本版本、数据库大小和风险项 |
| `config` | 分组配置模型、搜索风控、自动启动时间等 |
| `resume` | 导入或更新简历 |
| `profile` | 生成或编辑用户画像 |
| `tags` | 编辑岗位标签 |
| `greeting` | 生成、编辑、确认打招呼话术 |
| `session` | 修改本轮标签和搜索策略 |
| `start` | 开始或继续运行 |
| `pause` | 暂停运行 |
| `stop` | 停止当前轮次 |
| `logs` | 查看近期日志 |
| `history` | 查看岗位历史 |
| `summary` | 查看当前运行汇总 |
| `script` | 查看油猴脚本安装/更新地址 |
| `backup` | 备份配置、缓存和数据库 |
| `exit` | 退出 CLI |

`resume-run` 是 `start` 的兼容别名。

## 自动模式与定时启动

自动模式入口：

```text
start_job_seeker_auto.bat
```

它会尽量自修复：

- `.venv` 不存在时自动创建。
- Python 依赖缺失时自动安装 `requirements.txt`。
- Ollama 已安装但未运行时尝试启动。
- 默认本地模型缺失时尝试拉取 `qwen3:1.7b`。
- 已有健康 Job Seeker 服务占用端口时进入 attach 逻辑，不重复启动后端。

不可自动越过的问题会进入 blocked/paused，而不是静默失败：

- 缺简历。
- 模型不可用。
- 油猴脚本未安装或未连接。
- BOSS 未登录。
- 验证码、安全验证、平台风控。
- Tampermonkey 权限确认。

定时启动可在人工模式 `config` 中设置：

- `auto_start_enabled`
- `auto_start_time`

注意：定时启动不是 Windows 计划任务。自动启动器必须被打开后，才会等待到设定时间再运行。

## 状态与日志

本地 API：

```text
http://127.0.0.1:33333
```

常用观察接口：

```text
/status
/logs
/history
```

本地 API 默认只允许 loopback 本机访问，不面向局域网远程控制。高成本接口带有轻量限流。

## 数据与文件位置

| 路径 | 说明 |
| --- | --- |
| `data/config.json` | 本地配置，不提交 Git |
| `data/resume/` | 简历文件目录 |
| `data/cache/tags.txt` | 岗位标签 |
| `data/cache/greeting.json` | 打招呼话术 |
| `data/cache/user_detail.md` | 用户画像 |
| `data/app.db` | SQLite 本地数据库 |
| `data/backups/` | 数据库迁移或手动备份 |
| `web_script.js` | 油猴脚本源码 |
| `start_job_seeker.bat` | 人工启动器 |
| `start_job_seeker_auto.bat` | 自动启动器 |

`data/`、`.venv/`、`node_modules/`、缓存和数据库都不会提交到 Git。

## 数据库与保留策略

SQLite 使用 schema 版本管理。发生结构升级时，程序会先在 `data/backups/` 创建数据库备份，再执行迁移。

启动服务时会低频清理运行事件：

- 普通状态事件保留 7 天。
- 错误、人工处理、模型和打招呼结果保留 30 天。
- 岗位联系历史长期保留。

`resume_sent` 等旧字段只用于历史兼容。当前版本不会自动发送简历附件。

## 常见问题

### 启动停在“岗位评分版本”

当前版本模型连通性检查已经改为后台执行。CLI 会先显示状态面板，模型状态显示“检查中”，模型返回后再弹出“模型已连接”或失败提示。

### 推荐 Tab 没识别或识别错

先确认浏览器里油猴脚本已经更新到当前版本。脚本只识别明显的用户自定义岗位推荐 Tab，不识别 `地图`、筛选项、导航项、职位卡片内容。如果仍然识别异常，请贴 CLI 中 `发现用户自定义推荐 Tab` 的日志。

### 聊天页进入了但没发消息

当前版本会在同一个聊天页内尝试 3 次发送。仍失败时会关闭当前临时页、记录失败并暂停系统，避免继续制造未发送会话。只有在已经点击发送但无法确认结果时，才会记录 `greet_delivery_unknown` 并跳过当前岗位继续运行，避免重复发送同一条消息。

如果聊天列表中已经留下很多未发送会话，建议先人工清理或确认话术、输入框和发送按钮是否正常，再继续扩大运行数量。

### 端口 33333 被占用

查看占用：

```powershell
netstat -ano | findstr :33333
```

结束指定 PID：

```powershell
taskkill /PID <PID> /F
```

不要盲目结束不认识的进程。确认是旧的 Job Seeker 后再处理。

### 油猴脚本离线

检查：

- CLI 或自动启动器窗口仍在运行。
- 已安装或更新 `http://127.0.0.1:33333/web_script.user.js`。
- BOSS 页面已刷新。
- Tampermonkey 没有禁用该脚本。
- 脚本 `@connect` 权限已允许 `127.0.0.1` 和 `localhost`。

### 模型评分全是 0

常见原因：

- 模型接口不可用。
- 小模型输出空内容。
- 思考内容进入正文导致 JSON 解析失败。
- API Key 或模型名称配置错误。

建议：

- 运行 `doctor`。
- 小模型优先关闭思考。
- Ollama 默认使用 `qwen3:1.7b`。
- OpenAI 兼容接口确认 `openai_api_base`、`think_model` 和 `external_model_profile`。

### 为什么所有标签无新岗位后不继续刷新

这是账号安全策略。旧策略会每隔几秒循环搜索，容易触发风控。当前版本默认每次随机冷却 1-5 分钟；冷却结束后会先回到用户自定义推荐源，再进入关键词搜索。

### 手机 APP 有岗位，但脚本没有

APP 推荐流和 Web 推荐/搜索不是同一个入口。当前脚本只处理 Web 端 `/web/geek/jobs` 的用户自定义推荐 Tab 和关键词搜索，不模拟 APP 推荐算法。

## 验证命令

提交或更新前建议执行：

```powershell
node --check web_script.js
npm.cmd test
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe scripts\self_check.py
```

Python 编译检查：

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
Get-ChildItem -Path . -Recurse -Filter *.py |
  Where-Object { $_.FullName -notmatch '\\.venv\\|\\__pycache__\\' } |
  ForEach-Object { .\.venv\Scripts\python.exe -m py_compile $_.FullName }
```

PowerShell 启动器解析检查：

```powershell
[System.Management.Automation.Language.Parser]::ParseFile(
  "scripts/start_job_seeker.ps1",
  [ref]$null,
  [ref]$null
) | Out-Null

[System.Management.Automation.Language.Parser]::ParseFile(
  "scripts/start_job_seeker_auto.ps1",
  [ref]$null,
  [ref]$null
) | Out-Null
```

Git 空白检查：

```powershell
git diff --check
```

## 项目结构

```text
goodjobs-main/
├─ main.py                         # FastAPI 本地 API 和入口
├─ cli_console.py                  # 人工 CLI、自动模式和启动控制
├─ config.py                       # 配置加载、保存、环境变量 Key 支持
├─ core.py                         # 岗位分析和历史去重
├─ model_stream.py                 # Ollama/OpenAI 兼容模型调用
├─ database.py                     # SQLite schema、迁移、事件和历史
├─ runtime_state.py                # 运行状态、脚本心跳、模型状态
├─ greeting_service.py             # 打招呼话术生成和保存
├─ resume_service.py               # 简历解析
├─ cache.py                        # 简历、画像、标签缓存
├─ schema.py                       # API schema
├─ tools.py                        # 通用工具和隐私脱敏
├─ web_script.js                   # Tampermonkey 油猴脚本
├─ start_job_seeker.bat            # 人工启动器
├─ start_job_seeker_auto.bat       # 自动启动器
├─ scripts/
│  ├─ check_deps.py                # 启动器依赖检查
│  ├─ self_check.py                # 项目自检
│  ├─ start_job_seeker.ps1         # 人工启动器 PowerShell 实现
│  └─ start_job_seeker_auto.ps1    # 自动启动器 PowerShell 实现
├─ tests/                          # Python 和 userscript 策略测试
├─ requirements.txt                # 运行依赖
├─ requirements-dev.txt            # 测试依赖
└─ package.json                    # userscript Node 测试入口
```

## 致谢

本项目基于 [goodjobs](https://github.com/gbcdby/goodjobs) 修改和再发布，原项目采用 MIT License。当前版本围绕本地人工配置、自动启动器、推荐 Tab 岗位发现、保守搜索频率和稳定打招呼流程做了进一步整理。
