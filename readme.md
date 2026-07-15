# Job Seeker

> 当前版本只做岗位分析和打招呼流程。普通 BOSS 聊天页不会再自动检查官方附件简历请求卡片，也不会自动发送简历附件；简历文件仍用于画像、标签、评分和话术生成。
> 旧数据库中可能仍保留 `resume_sent` 一类历史字段，但当前版本不会再产生发送简历附件动作。

Job Seeker 是一个本机运行的 BOSS 直聘辅助工具。它由本地 Python 后端、命令行控制台和 Tampermonkey 油猴脚本组成，用于读取岗位、调用模型评分、记录历史，并在人工确认过配置后自动执行打招呼流程。

当前版本只保留两条清晰入口：

- `start_job_seeker.bat`：人工模式，用来首次配置、编辑简历、确认画像、调整标签、查看日志和排查问题。
- `start_job_seeker_auto.bat`：自动模式，读取已有配置后直接启动，适合让 Hermes/Codex/其他 agent 打开这个脚本。

项目不再提供 MCP 或 JSON Agent 控制入口。`python main.py agent` 和 `python main.py mcp` 会明确提示不支持。Agent 后续只需要启动自动模式，并通过 `/status`、`/logs` 观察状态。

## 工作原理

1. Python 后端启动本地 API，默认地址是 `http://127.0.0.1:33333`。
2. Tampermonkey 脚本在 BOSS 搜索页中连接本地 API。
3. 脚本读取岗位列表，后台打开岗位详情页，不抢前台焦点。
4. 后端用已保存的简历画像和模型配置计算岗位匹配度。
5. 达到分数阈值且没有历史重复时，脚本进入聊天页发送已确认的话术。
6. 所有岗位、动作、错误和日志都会写入本地 `data/`。

安全边界保持不变：系统不会绕过登录、验证码、Tampermonkey 安装确认或平台风控。遇到这些情况会暂停并提示人工处理。

安全提示：如果曾经把 OpenAI/火山引擎/豆包 API Key 写入 `data/config.json`，请立即去服务商控制台轮换该 Key。当前版本推荐使用 `OPENAI_API_KEY` 环境变量，程序不会把环境变量中的 Key 回写到配置文件。

## 快速开始

### 1. 安装环境

需要 Python 3.10+，以及 Ollama 或 OpenAI 兼容接口。

```powershell
python -m venv .venv
.\.venv\Scripts\activate
python -m pip install -r requirements.txt
```

如果使用 Ollama：

```powershell
ollama pull qwen3:1.7b
ollama serve
```

### 2. 首次使用人工模式

双击：

```text
start_job_seeker.bat
```

或在项目目录运行：

```powershell
python main.py
```

首次进入后按 CLI 提示完成配置。也可以在 CLI 中输入 `setup` 重新走一次快速配置。建议先完成这些内容：

- 模型来源、模型地址、模型名称。
- 简历 PDF 或简历正文。
- 简历画像、岗位搜索标签。
- 打招呼话术。
- 本轮打招呼上限和评分阈值。

### 3. 安装油猴脚本

人工模式启动后，在 CLI 里输入：

```text
script
```

复制显示的脚本地址到浏览器地址栏，例如：

```text
http://127.0.0.1:33333/web_script.user.js
```

注意：复制地址时不要带引号、句号、逗号或其他多余标点。Tampermonkey 会打开安装或更新页面，需要人工点击确认。项目更新后建议先重新打开这个地址更新油猴脚本，再刷新 BOSS 搜索页测试，避免浏览器还在运行旧脚本。

### 4. 打开 BOSS 推荐/搜索页

在同一个浏览器中优先打开：

```text
https://www.zhipin.com/web/geek/jobs
```

确保已经登录 BOSS 直聘。如果出现验证码、登录过期或访问异常，需要先人工处理。脚本会优先处理用户自定义推荐 Tab，之后再进入关键词搜索。手动打开关键词页 `/web/geek/job` 也能连接，但本轮推荐源未完成时脚本会先跳回推荐页。

### 5. 开始运行

回到人工 CLI，输入：

```text
start
```

系统会让你确认本轮岗位搜索标签和打招呼上限，然后脚本开始执行。

## 自动模式

自动模式适合在已经完成一次人工配置后使用。

双击：

```text
start_job_seeker_auto.bat
```

或运行：

```powershell
python main.py autorun
```

自动模式会执行以下流程：

1. 读取 `data/config.json` 和 `data/cache/` 中的已有配置。
2. 启动本地 API。
3. 如果启用了定时启动，并且当前时间早于今天的计划时间，则等待到点。
4. 打开油猴脚本安装页和 BOSS 搜索页。
5. 检查简历是否存在。缺简历时不会启动，需要回到人工模式配置。
6. 如果已有简历但缺画像、标签或话术，会尝试用当前模型自动生成。
7. 等待油猴脚本心跳，最多等待 120 秒。
8. 脚本在线后自动开始运行，不需要再输入 `start`。

自动模式不会询问问题，也不会打开标签编辑器。它使用当前保存的配置，所以首次配置、修改标签、修改话术、换模型时仍建议用人工模式。

为了避免连续双击启动器或 agent 重复启动时打开一堆页面，启动器会记录最近一次自动打开浏览器的时间。60 秒内重复启动时，会跳过重复打开油猴脚本页或 BOSS 搜索页。浏览器打开冷却记录统一保存在 `data/cache/browser_open_*.stamp`。

自动模式会尽量自修复启动环境：缺 `.venv` 会自动创建，缺 Python 依赖会自动安装，Ollama 缺少默认模型时会自动拉取 `qwen3:1.7b`。如果本机没有安装 Ollama，启动器会先询问是否安装，不会静默修改系统软件。

自动拉取 Ollama 默认模型时设置了超时保护；如果网络较慢导致超时，窗口会提示手动执行 `ollama pull qwen3:1.7b`，服务不会无限卡在下载步骤。

### 定时启动

定时启动在人工模式中设置：

```text
start_job_seeker.bat
job-seeker> config
```

配置向导会询问“是否启用自动模式定时启动”和“自动模式启动时间 HH:MM”。时间使用 24 小时制，例如 `09:30`；输入 `9:00` 会自动保存为 `09:00`，`24:00` 或 `abc` 会要求重新输入。

启用后，自动模式仍然需要先被打开：

```text
start_job_seeker_auto.bat
```

如果当前时间早于今天的计划时间，窗口会显示倒计时，等到点后再打开浏览器并继续自动流程。如果今天的计划时间已经过去，自动模式会立即启动，避免你手动打开后误以为程序没有反应。等待期间可以按 `Ctrl+C` 退出。

本功能不是 Windows 计划任务，也不会让电脑无人值守自动打开脚本。如果需要每天固定时间自动打开 `start_job_seeker_auto.bat`，后续可以单独增加 Windows Task Scheduler 安装器。

## Agent 使用建议

Agent 不需要调用 MCP 或业务 API。推荐流程很简单：

1. 启动 `start_job_seeker_auto.bat`。
2. 等待窗口输出，判断是否启动成功。
3. 用 `GET http://127.0.0.1:33333/status` 观察控制状态、脚本心跳、计数和配置状态。
4. 用 `GET http://127.0.0.1:33333/logs` 查看最近日志。
5. 如果状态提示登录、验证码、油猴安装、模型不可用或简历缺失，让用户接管。

`/status` 的模型思考字段说明：

- `scoring_thinking`：岗位评分是否允许思考。
- `profile_tags_thinking`：简历画像和岗位标签生成是否允许思考。
- `greeting_thinking`：打招呼话术默认是否允许思考，跟随 `disable_model_thinking`；如果生成为空，最后一次重试会开启思考兜底。
- `non_scoring_thinking`：兼容旧字段，表示画像/标签类非评分任务是否允许思考。

Agent 不应该直接写入 API Key、简历正文、画像正文、打招呼话术或动作审批结果。需要改这些内容时，让用户进入人工模式处理。

`status` 只显示当前缓存状态，不会主动调用模型；需要真实检查模型、依赖和脚本连接时使用 `doctor`。`doctor` 会做一次轻量预热检测：Ollama 会读取流式首个响应，OpenAI 兼容接口会发送一次极短的 `/chat/completions` 请求。预热失败只代表当前配置或网络不可用，不会绕过后续人工排查。

本地 API 默认只允许 `127.0.0.1`、`localhost` 或 `::1` 访问，并对 `/jobs/analyze`、`/greeting/generate`、`/greeting/variants` 做轻量限流。不要把服务暴露到公网或局域网；如确实需要远程访问，必须显式设置 `JOB_SEEKER_ALLOW_REMOTE=true` 并自行承担网络安全风险。

## 常用 CLI 命令

| 命令 | 作用 |
| --- | --- |
| `status` | 查看当前状态、脚本连接、运行控制和配置完成度 |
| `setup` | 首次快速配置模型、简历、画像、标签和话术 |
| `config` | 按分组修改模型、搜索风控、定时启动、日志显示和高级参数 |
| `resume` | 上传或编辑简历 |
| `profile` | 重新生成或编辑简历画像 |
| `session` | 修改本轮标签和打招呼上限 |
| `tags` | 重新生成或编辑岗位搜索标签 |
| `greeting` | 重新生成或编辑打招呼话术 |
| `start` | 人工确认后开始或继续运行 |
| `pause` | 暂停运行 |
| `stop` | 停止自动化 |
| `actions` | 处理待确认动作 |
| `history` | 查看最近岗位历史 |
| `logs` | 查看最近日志 |
| `summary` | 查看当前运行汇总、计数、冷却和近期动作 |
| `report` | 生成脱敏诊断文件，便于排查问题 |
| `backup` | 本地备份配置、简历、缓存和数据库 |
| `script` | 显示油猴脚本安装地址 |
| `doctor` | 主动检查依赖、模型、端口和脚本连接，并给出下一步 |
| `help` | 显示帮助 |
| `quit` | 退出 CLI |

`config` 现在是分组菜单，不会一次性询问所有参数。日常最常用的是“模型与思考”“搜索与风控”“自动启动时间”；不确定高级参数含义时可以先不改。

`report` 会写入 `data/diagnostics/`，会隐藏 API Key，并截断简历、岗位正文和话术内容。`backup` 会写入 `data/backups/`，不包含明文 API Key，但包含个人数据，请不要随意发送给他人。

## 配置说明

配置文件位于：

```text
data/config.json
```

如果 `data/config.json` 被手动改坏，启动时会打印 `[警告] 配置文件损坏，已使用默认配置`，然后按默认配置继续运行。建议先备份损坏文件，再用人工模式重新保存配置。

常用字段如下：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `server_host` | `127.0.0.1` | 本地 API 监听地址 |
| `server_port` | `33333` | 本地 API 端口 |
| `model_provider` | `ollama` | `ollama` 或 `openai` |
| `ollama_host` | `http://127.0.0.1:11434` | Ollama 地址 |
| `openai_api_base` | `https://api.openai.com/v1` | OpenAI 兼容接口地址 |
| `openai_api_key` | 空 | OpenAI 兼容接口密钥；推荐改用 `OPENAI_API_KEY` 环境变量 |
| `think_model` | `qwen3:1.7b` | 模型名称；`qwen3:4b` 可作为可选更大模型 |
| `score_threshold` | `70` | 达到多少分才打招呼 |
| `session_greet_limit` | `50` | 单轮最多打招呼数量 |
| `daily_greet_safe_limit` | `120` | 每日自动打招呼安全上限；BOSS 约 120 次后可能出现剩余次数提醒，默认提前停止 |
| `search_round_cooldown_minutes` | `60` | 所有岗位标签跑完且没有新岗位后，等待多少分钟再开始下一轮搜索 |
| `tag_search_delay_seconds` | `20` | 切换到下一个岗位标签前的最小等待秒数 |
| `tag_search_delay_max_seconds` | `45` | 切换到下一个岗位标签前的最大等待秒数；每次会在最小值和最大值之间独立随机等待 |
| `max_search_submissions_per_hour` | `6` | 每小时最多提交多少次关键词搜索；预算跨刷新保留 |
| `max_search_submissions_per_day` | `30` | 每日最多提交多少次关键词搜索；按本地日期重置 |
| `search_result_scroll_rounds` | `5` | 每个标签搜索后最多低频滚动读取次数；可设置 `0-5`，默认滚动 5 次读取更多左侧岗位 |
| `preferred_feed_mode` | `all_custom_tabs` | 推荐页策略；默认处理 `/web/geek/jobs` 中全部用户自定义推荐 Tab，`off` 表示关闭 |
| `preferred_feed_max_jobs_per_tab` | `10` | 每个用户自定义推荐 Tab 每轮最多处理多少个新岗位；`0` 表示不限 |
| `max_contacts_per_company` | `1` | 同一公司最多联系次数 |
| `skip_contacted_companies` | `true` | 跳过已联系公司 |
| `job_detail_max_chars` | `1600` | 传给模型的岗位描述最大字符数 |
| `log_verbosity` | `compact` | 日志详细度：`compact`、`normal`、`debug` |
| `disable_model_thinking` | `true` | 是否默认关闭模型思考；评分、画像/标签、打招呼都遵循此设置，打招呼空输出时会开启一次思考兜底 |
| `show_model_reasoning` | `false` | 是否在日志中展示模型思考内容 |
| `external_model_profile` | `generic` | OpenAI 模型适配类型：`generic`、`qwen`、`deepseek`、`doubao` |
| `job_score_num_predict_think_off` | `-1` | 评分关闭思考时的生成长度，`-1` 表示不限制 |
| `job_score_num_predict_think_on` | `-1` | 评分开启思考时的生成长度，`-1` 表示不限制 |
| `model_temperature` | `0.2` | 模型温度 |
| `model_top_p` | `0.8` | top_p 采样参数 |
| `model_repeat_penalty` | `1.18` | Ollama 重复惩罚 |
| `model_repeat_last_n` | `128` | Ollama 重复检查窗口 |
| `model_frequency_penalty` | `0.3` | OpenAI 兼容频率惩罚 |
| `model_presence_penalty` | `0.1` | OpenAI 兼容存在惩罚 |

### API Key 配置建议

推荐在当前终端或启动器环境中设置：

```powershell
$env:OPENAI_API_KEY="你的密钥"
```

`OPENAI_API_KEY` 的优先级高于 `data/config.json`。当环境变量存在时，`/status` 和 `/config` 只会显示 Key 已配置以及来源，不会返回明文；保存配置时也不会把环境变量 Key 写入 `data/config.json`。

迁移已有明文 Key 时，先设置环境变量并运行 `doctor` 验证模型可用，再清空 `data/config.json` 中的 `openai_api_key`。不要在模型尚未验证时直接删除唯一可用的 Key。

### 数据库保留与备份

本地数据库使用 schema 版本管理。发生结构升级时，程序会先在 `data/backups/` 创建数据库备份，再执行迁移。启动服务时会低频清理运行事件：普通状态事件保留 7 天，错误、人工处理、模型和打招呼结果保留 30 天；岗位联系历史不会被自动删除。

`status` 会返回当前 `database` 统计和 `run_summary`，`doctor` 会显示数据库大小、事件数和 schema 版本。数据库较大时先运行 `backup`，再重启服务触发清理；不要手动删除正在使用的 `app.db-wal` 或 `app.db-shm` 文件。

### 评分 token 设置

`job_score_num_predict_think_off` 和 `job_score_num_predict_think_on` 现在会真实用于岗位评分：

- 第一次评分使用当前 `disable_model_thinking` 设置，并选择对应 token 预算。
- 第二、三次评分会强制关闭思考，并使用 `job_score_num_predict_think_off`。
- `-1` 表示不限制生成长度。
- 空字符串或非法字符串会自动回退到默认值，不会导致启动崩溃。
- 模型输出 JSON 或三行 `学历专业: 90` 格式都可以被解析。

如果使用 `qwen3:1.7b`、`qwen3:4b` 这类小模型，建议：

```json
{
  "disable_model_thinking": true,
  "job_score_num_predict_think_off": 200,
  "job_score_num_predict_think_on": 2048
}
```

评分任务只需要三个分数，不需要长推理。小模型开启思考时容易把输出预算消耗在 reasoning 中，导致正文为空、格式错误或评分全为 0。

CLI 配置向导中，端口、阈值、上限、岗位描述长度等整数项会持续提示直到输入合法数字，不会因为误输入字母而退出。

## 文件位置小提示

- 简历 PDF 建议放在 `data/resume/`，例如 `data/resume/resume.pdf`。
- CLI 提示输入文件路径时，路径不需要加引号。
- 如果路径里有空格，直接粘贴完整路径即可；如果失败，再把文件移动到 `data/resume/` 后输入简单路径。
- `data/` 保存个人数据、配置、缓存和数据库，通常不要提交到版本管理。
- `data/cache/tags.txt` 是岗位搜索标签。
- `data/cache/greeting.json` 是打招呼话术缓存。
- `data/cache/profile.json` 和 `data/cache/user_detail.md` 是简历画像相关缓存。

## 岗位标签与地点

BOSS 直聘的搜索支持「标签 + 地点」组合格式。如果需要指定岗位地点，把地点直接加在岗位标签后面，**不要带空格**，多个地点可以写多个标签：

```text
Java北京
Python上海
前端杭州
```

BOSS 直聘搜索 `Java北京` 会同时匹配「Java」和「北京」，从而过滤出北京地区的 Java 岗位。支持同时指定多个城市：

```text
Java北京
Java上海
Java深圳
```

标签文件位置：`data/cache/tags.txt`，每行一个标签。也可以在人工模式的 CLI 中使用 `tags` 命令编辑。

> **注意：** 标签和地点之间不要加空格或逗号，`Java 北京` 会被解析成两个独立标签 `Java` 和 `北京`，导致搜索匹配不精准。

## 搜索频率策略

当前版本采用“用户自定义推荐 Tab 优先 + 关键词搜索补充”的策略。启动器默认打开 `https://www.zhipin.com/web/geek/jobs`，脚本会先识别并逐个处理用户自己设置的岗位推荐 Tab，跳过系统默认“推荐”Tab。每个自定义推荐 Tab 默认最多处理 `10` 个新岗位，之后进入下一个推荐 Tab；全部处理完后，再进入原有岗位标签关键词搜索。

关键词搜索阶段采用保守账号安全策略：每轮每个岗位标签最多搜索一次。如果所有标签都没有新岗位，脚本不会继续每隔几秒刷新，而是进入搜索冷却，默认等待 `60` 分钟后再从第一个标签开始下一轮。

切换标签时默认在 `20-45` 秒之间随机等待，避免连续快速提交搜索。关键词搜索另有持久化预算，默认每小时最多提交 `6` 次、每日最多 `30` 次；刷新页面或重启浏览器不会清空预算。对应配置为 `tag_search_delay_seconds`、`tag_search_delay_max_seconds`、`max_search_submissions_per_hour` 和 `max_search_submissions_per_day`，人工模式的 `session` 命令可以调整。

推荐 Tab 和每个关键词搜索后都会做低频滚动扩展读取。BOSS 岗位列表真正加载更多岗位的位置通常是左侧岗位列表，不是整个浏览器页面；当前油猴脚本会优先探测并滚动左侧岗位列。这个设计是在不频繁重新提交搜索的前提下，尽量多读取同一入口下已经加载出来的岗位。

冷却期间脚本仍然在线，只是不提交搜索、不切换标签、不刷新页面。状态面板和 `doctor` 会显示冷却结束时间和剩余时间；如需人工强制开启新一轮，可以先 `stop`，再重新 `start`。

BOSS 手机 APP 的推荐流和 Web 端 `/web/geek/jobs` 仍不是完全相同的入口。当前脚本会利用 Web 端用户自定义推荐 Tab，但不会模拟 APP 推荐接口、翻页接口或移动端行为。

## 重试与暂停策略

当前版本把“可恢复的小故障”和“平台风险状态”分开处理。普通加载慢、后台标签回传慢、模型偶发空输出可以有限重试；登录、验证码、额度提醒、访问过频等状态不会重试，会暂停或停止并提示人工处理。

| 步骤 | 重试策略 | 失败后行为 |
| --- | --- | --- |
| 本地 API 启动等待 | 最多等待约 20 秒 | 跳过自动打开或提示检查端口 |
| 油猴脚本连接等待 | 自动模式最多等待 120 秒 | 进入 blocked/paused，提示更新脚本、登录并刷新页面 |
| 搜索框、搜索按钮、岗位列表元素 | 不刷新页面恢复 | 跳过当前岗位或切换来源，避免连续刷新 |
| 关键词搜索提交 | 受每小时/每日持久化预算约束 | 预算用完进入冷却；平台限制立即停止 |
| 搜索结果滚动读取 | 每个标签默认 5 次，最多 5 次 | 仍无新岗位则切换标签或进入冷却 |
| 职位详情页回传 | 后台详情页超时后尝试 fetch 兜底；整体最多重试 1 次 | 跳过当前岗位 |
| 岗位评分模型调用 | 3 次策略：当前配置、关闭思考、关闭思考并调整温度 | 评分失败则跳过当前岗位 |
| 打招呼聊天页打开 | 仅“尚未点击发送”的加载失败允许有限重试 | 页面身份不一致时暂停并保留页面 |
| 消息发送结果确认 | 点击发送后不再重试 | 回执不明确时记录 `greet_delivery_unknown`，暂停并禁止再次打开该岗位聊天页 |
| Ollama 默认模型下载 | 单次拉取，超时 1800 秒 | 提示手动运行 `ollama pull qwen3:1.7b` |

这些状态不会重试：验证码、登录过期、访问异常、平台频率限制、今日额度提醒、已沟通或继续沟通状态、发送结果不确定但可能已经发出。遇到这些情况时，优先保护账号和避免重复发送。

## 常见问题

### 端口 33333 被占用

查询占用进程：

```powershell
netstat -ano | findstr :33333
```

结束进程：

```powershell
taskkill /PID <PID> /F
```

也可以在人工模式中运行 `config`，改用其他端口。端口变更后需要重新安装或更新油猴脚本。

### 油猴脚本离线

检查这些点：

- 本地 CLI 或自动启动器窗口仍在运行。
- Tampermonkey 已启用。
- 脚本已安装或更新到当前地址。
- BOSS 推荐页或搜索页已经刷新。
- 浏览器地址优先使用 `https://www.zhipin.com/web/geek/jobs`；关键词搜索页 `https://www.zhipin.com/web/geek/job` 也可连接，脚本会先跳回推荐页完成推荐源。

### 自动模式没有启动

自动模式需要这些条件：

- 已有简历。
- 模型可用。
- 能生成或读取画像、标签和话术。
- 油猴脚本能连接本地 API。
- BOSS 已登录且没有验证码或风控页面。

缺少任一项时，自动模式会暂停并打印原因。此时建议打开 `start_job_seeker.bat`，用 `status`、`doctor`、`logs` 排查。

### 模型评分全是 0 或提示没有返回内容

优先检查：

1. `doctor` 中模型是否真实可用。
2. 小模型是否关闭了评分思考：`disable_model_thinking=true`。
3. `job_score_num_predict_think_off` 是否过小。建议先设为 `200` 到 `400`。
4. 如果开启思考，`job_score_num_predict_think_on` 建议至少 `2048`。
5. `log_verbosity` 可临时设为 `debug`，看模型原始输出摘要。

如果模型偶发失败，系统会安全跳过当前岗位，不会用不可靠分数自动打招呼。

### 长时间运行后重复打开很多页面

当前脚本包含运行锁、URL 冷却、近期处理历史和临时标签清理。仍出现大量页面时，通常是以下原因：

- 同时打开了多个旧版本搜索页。
- 油猴脚本没有更新。
- 后端服务重启后浏览器旧页面没有刷新。
- BOSS 页面出现异常、验证码或登录过期。

建议先 `stop`，关闭多余 BOSS 搜索页，重新安装脚本并刷新搜索页，再从 CLI 输入 `start`。

### BOSS 提示今天剩余次数还有 30 次

BOSS 每日总沟通额度约 150 次，但在约 120 次后可能弹出“剩余次数”提醒。该弹窗会改变聊天页 DOM，继续自动查找发送按钮容易变成连续报错。

当前版本默认 `daily_greet_safe_limit=120`，脚本当天自动打招呼达到 120 次会主动停止。如果你当天手动沟通过，平台提醒可能提前出现；脚本检测到“今天剩余”“剩余次数”“今日还可”等额度提醒后，也会立即停止自动化并记录日志，不会刷新页面反复重试。

### 所有标签都没有新岗位后为什么不继续刷新

这是账号安全策略。旧策略会在几秒后重新搜索所有标签，长时间运行容易形成高频提交和刷新。当前版本会进入搜索冷却，默认 `60` 分钟，只保持心跳和状态展示，不重新提交搜索。可以在人工模式输入 `session` 调整冷却分钟数、标签间隔、关键词搜索预算和滚动扩展次数。

### 手机 APP 有推荐岗位，但脚本搜索不到

这是入口差异。脚本会优先处理 Web 端 `/web/geek/jobs` 中的用户自定义推荐 Tab，再使用关键词搜索补充；APP 推荐流仍可能包含 Web 端没有展示的岗位。建议在 BOSS 网页端多设置几个清晰的自定义推荐 Tab，同时把 APP 中常见的岗位关键词和城市组合整理到 `data/cache/tags.txt`。不要通过缩短冷却时间来硬刷，频繁刷新更容易触发风控。

### 本轮刚开始就提示达到上限

系统会用后端 `run_id` 对齐脚本本地 session。若出现旧计数残留：

1. 确认油猴脚本已经更新。
2. 在人工 CLI 输入 `stop`。
3. 刷新 BOSS 搜索页。
4. 再输入 `start` 开启新一轮。

## 项目结构

```text
goodjobs-main/
├─ main.py                         # FastAPI 服务和启动入口
├─ cli_console.py                  # 人工 CLI 和自动模式控制
├─ core.py                         # 岗位评分和核心模型逻辑
├─ model_stream.py                 # Ollama/OpenAI 流式模型调用
├─ greeting_service.py             # 打招呼话术生成和保存
├─ resume_service.py               # 简历上传、提取和保存
├─ cache.py                        # 简历画像、标签和话术缓存
├─ database.py                     # SQLite 历史、动作、事件记录
├─ config.py                       # 配置加载、校验和保存
├─ runtime_state.py                # 运行状态、日志和控制状态
├─ prompts.py                      # 模型提示词
├─ schema.py                       # API 数据模型
├─ tools.py                        # 通用工具函数
├─ web_script.js                   # Tampermonkey 脚本
├─ requirements.txt                # Python 依赖
├─ start_job_seeker.bat            # 人工启动器
├─ start_job_seeker_auto.bat       # 自动启动器
├─ resume-example.md               # 简历示例文件
├─ LICENSE                         # MIT License
├─ scripts/
│  ├─ start_job_seeker.ps1         # 人工启动器 PowerShell 实现
│  └─ start_job_seeker_auto.ps1    # 自动启动器 PowerShell 实现
└─ data/                           # 个人数据目录，本地使用
   ├─ config.json
   ├─ app.db
   ├─ resume/
   └─ cache/
```

## 验证命令

开发或修改后可以运行：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe scripts\self_check.py
Get-ChildItem -Recurse -Filter *.py -File | Where-Object { $_.FullName -notlike '*\.venv\*' } | ForEach-Object { python -m py_compile $_.FullName }
node --check web_script.js
node --test tests\userscript_policy.test.cjs
powershell -NoProfile -Command '$null = [scriptblock]::Create((Get-Content scripts/start_job_seeker.ps1 -Raw))'
powershell -NoProfile -Command '$null = [scriptblock]::Create((Get-Content scripts/start_job_seeker_auto.ps1 -Raw))'
```

这些命令只做基础自检和静态检查，不会打开浏览器。

## 致谢

本项目基于 [goodjobs](https://github.com/gbcdby/goodjobs) 修改和再发布，原项目采用 MIT License。当前版本围绕本地人工配置、自动启动器和稳定运行做了进一步整理。
