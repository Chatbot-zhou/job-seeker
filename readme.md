# Job Seeker

Job Seeker 是一个运行在本机的 BOSS 直聘求职辅助工具。系统通过浏览器用户脚本读取岗位信息，使用配置的模型完成岗位评分，并按 BOSS 的聊天流程执行打招呼。

- **Web 控制台**：默认入口是一个本地网页应用，启动后自动打开，日常启停、模型切换、首次配置和日志查看都在浏览器里完成。
- **本地 + 云端模型**：Ollama 和 OpenAI 兼容接口可以同时保存配置，在顶部一键切换。
- **极简首次配置**：只需要选模型、上传 PDF 简历；画像、标签和招呼语自动生成，高级参数有安全默认值。
- **BOSS 原生打招呼**：只在详情页点击 BOSS 原生“立即沟通”，由平台完成联系；不打开聊天页、不发送工具生成的话术。
- **本机优先**：配置、简历、运行记录和岗位历史都保存在本机，API 只监听 `127.0.0.1`。

## 核心运行策略

1. 系统先读取岗位基本信息和 JD，再通过模型完成三项评分。
2. 只有达到配置阈值且模型建议继续的岗位，才会进入 BOSS 打招呼流程。
3. 列表不足时使用自适应滚动；当前来源耗尽后进入下一来源或随机冷却。
4. 启动预热、配置生成和岗位评分共用同一个模型执行门，默认一次只运行一个模型任务。
5. 岗位 URL、稳定岗位 ID 以及同公司名加职位名会参与去重；脚本启动时加载近期处理历史，避免刷新后重复评分。
6. 登录失效、访问过频、平台上限或结果无法确认时，采用保守暂停策略。
7. 所有页面操作都会加入随机等待，标签切换和搜索提交均有频率限制。

## 快速开始

### 运行环境

- Windows 10 或 Windows 11
- Python 3.10 或更高版本
- Chrome、Edge 或其他支持 Tampermonkey 的 Chromium 浏览器
- Tampermonkey 扩展
- Ollama，或可用的 OpenAI 兼容模型接口

### 安装依赖

在项目根目录执行：

```powershell
cd E:\Desktop\jobseeker
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

使用 Ollama 时先启动服务并准备模型：

```powershell
ollama serve
ollama pull qwen3:1.7b
```

使用云端模型时，可以在启动前设置密钥：

```powershell
$env:OPENAI_API_KEY="你的密钥"
```

### 第一次启动

1. 双击 `start_boss.bat`（或 `start_all.bat`）。
2. 启动器会准备依赖、启动本地 API，并自动打开 Web 控制台：

   ```text
   http://127.0.0.1:33333/ui/
   ```

3. 首次打开会进入 5 步极简向导：
   - 选择本机 Ollama 或云端模型，可先点“测试连接”
   - 上传 PDF 简历，或直接粘贴简历文本
   - 自动生成岗位标签和用户画像，可手动修改
   - 选择打招呼方式：默认 BOSS 原生“立即沟通”，也可以切换到高级自定义话术
   - 完成配置，安装油猴脚本
4. 如果检测到旧的配置、简历或缓存，会先自动生成备份，再进入重新配置流程。
5. 画像生成后会做基础事实校验：发现简历未提及的技术词、年份、院校层次或项目时，会提示核对；勾选确认后才能继续保存。
6. 在浏览器中登录 BOSS 直聘，打开岗位列表页：

   ```text
   https://www.zhipin.com/web/geek/jobs
   ```

7. 安装或更新用户脚本：

   ```text
   http://127.0.0.1:33333/userscripts/boss.user.js
   ```

8. 安装后刷新 BOSS 页面，页面左下角出现面板，Web 控制台显示脚本在线。
9. 在 Web 控制台点击“开始运行”，或点击 BOSS 页面左下角面板的“开始”。

> 如果页面左下角没有面板，请检查 Tampermonkey 是否启用，以及 Chrome/Edge 扩展管理页中是否开启了 Tampermonkey 的“开发者模式”。

> 后端会校验油猴脚本版本。旧版本脚本连接时会拒绝“开始”，如果运行中重新连接旧脚本，会收到暂停指令；请在 Tampermonkey 中更新脚本并刷新 BOSS 页面。

## Web 控制台

- **概览**：运行状态、当前岗位、今日/本轮成功数、模型队列、配置检查清单和最近事件。
- **首次配置**：5 步向导；旧数据会先备份。
- **模型**：本机 Ollama 和云端模型两张卡片，可分别保存、测试和启用；顶部切换器随时切换当前模型。
- **招呼语**：默认使用 BOSS 原生“立即沟通”；高级模式可生成、编辑并发送自定义话术。
- **历史**：查看最近处理过的岗位、评分和结果。
- **日志**：每 3 秒刷新，可按 level 过滤。
- **设置**：搜索频率、冷却、滚动轮次、评分 token、温度、本地备份和重新运行向导。

Web 控制台是同源页面，只允许本机访问；不会把数据发送到第三方服务。

## 模型切换

- 本机 Ollama 和云端模型使用两个独立槽位：
  - `ollama_model`：本机模型名，默认 `qwen3:1.7b`
  - `cloud_model`：云端模型名，默认 `gpt-4o-mini`
- `model_provider` 表示当前启用的来源；`think_model` 是系统自动派生的“当前生效模型”，保留用于兼容旧接口。
- 顶部切换器切换模型时：
  - 如果 BOSS 正在运行，会先暂停通道并等待当前评分任务结束
  - 新模型执行真实 warmup，通过后自动恢复运行
  - warmup 失败会回滚到原模型并提示原因
- 切换模型会把模型并发重置为 1；需要并发时重新执行 `doctor concurrency`。

云端模型支持任意 OpenAI 兼容接口，在模型页填写 Base URL、模型名、API Key 和模型类型即可。

## 打招呼方式

Web 控制台和向导提供两种模式：

| 模式 | 行为 |
| --- | --- |
| BOSS 原生（默认） | 使用详情页的 BOSS 原生“立即沟通”入口完成联系；不打开聊天页、不发送任何工具生成的文本 |
| 自定义话术（高级） | 打开聊天页并发送保存的自定义话术；会产生额外的文本消息 |

BOSS 原生模式要求详情页存在可用的原生打招呼入口。缺少入口时会记录 `greet_unavailable` 并跳过，不会回退到聊天页，也不会自动发送文字。

自定义话术仍会经过隐私检查，手机号、邮箱、微信等内容会被拦截。

## BOSS 流程

- 优先读取用户配置的推荐 Tab，再按搜索标签处理关键词岗位。
- 列表不足时自动滚动加载，达到页面末尾后进入下一来源或随机冷却。
- 岗位通过评分和历史检查后，进入打招呼流程。
- 公司联系次数、搜索频率和每日搜索次数均可通过配置限制。
- 聊天页只执行打招呼；普通聊天页不会自动继续扫描。

## 常用配置

在 Web 控制台“设置”页或 CLI 的 `config` 命令中修改。常用项：

### BOSS 通道与频率

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `boss_enabled` | 是否启用 BOSS 通道 | `true` |
| `max_contacts_per_company` | 同一公司的联系次数上限 | `1` |
| `search_result_scroll_rounds` | 单个岗位来源最多滚动轮次 | `20` |
| `preferred_feed_mode` | 推荐来源模式 | `all_custom_tabs` |
| `preferred_feed_max_jobs_per_tab` | 每个推荐 Tab 的岗位上限，`0` 不限 | `0` |
| `search_round_cooldown_min_minutes` | 搜索来源耗尽后的最小冷却时间 | `1` |
| `search_round_cooldown_minutes` | 搜索来源耗尽后的最大冷却时间 | `5` |
| `tag_search_delay_seconds` | 标签切换最小等待 | `20` |
| `tag_search_delay_max_seconds` | 标签切换最大等待 | `45` |
| `max_search_submissions_per_hour` | 每小时搜索提交上限 | `6` |
| `max_search_submissions_per_day` | 每日搜索提交上限 | `30` |

### 模型与评分

| 配置项 | 说明 | 默认值 |
| --- | --- | --- |
| `model_provider` | 当前模型来源：`ollama` 或 `openai` | `ollama` |
| `ollama_host` | Ollama 服务地址 | `http://127.0.0.1:11434` |
| `ollama_model` | 本机 Ollama 模型 | `qwen3:1.7b` |
| `openai_api_base` | OpenAI 兼容接口地址 | `https://api.openai.com/v1` |
| `cloud_model` | 云端模型名 | `gpt-4o-mini` |
| `external_model_profile` | 云端模型类型：generic/qwen/deepseek/doubao | `generic` |
| `score_threshold` | 进入后续流程的最低总分 | `70` |
| `disable_model_thinking` | 是否请求关闭模型思考模式 | `true` |
| `model_max_concurrency` | 模型最大并发数 | `1` |
| `greeting_mode` | `boss_native` 或 `custom_only` | `boss_native` |
| `onboarding_completed` | Web 首次向导是否完成 | `false` |

## 常用命令

Web 控制台是默认入口；终端窗口仍保留 CLI，可输入以下命令。

| 命令 | 用途 |
| --- | --- |
| `status` | 查看全局状态、BOSS 连接、滚动状态以及模型队列 |
| `doctor` | 检查配置、模型、数据库和浏览器脚本连接 |
| `doctor concurrency` | 测试当前模型是否适合并发评分 |
| `config` | 查看或修改系统配置 |
| `resume` | 导入或更新简历 |
| `profile` | 查看或编辑用户画像 |
| `tags` | 配置 BOSS 搜索标签 |
| `greeting` | 配置 BOSS 招呼语 |
| `session` | 修改本轮岗位标签和搜索策略 |
| `start` | 启动或继续全局任务 |
| `pause` / `stop` | 暂停 / 停止全局任务 |
| `pause boss` / `resume boss` / `stop boss` | 单独控制 BOSS 通道 |
| `logs` / `history` / `summary` | 查看日志、历史和运行摘要 |
| `report` | 导出脱敏诊断文件 |
| `backup` | 备份配置、简历、缓存和数据库 |
| `script` | 查看用户脚本安装地址和版本 |
| `help` / `quit` | 查看帮助 / 退出 CLI |

命令行模式：

```powershell
python main.py        # 人工 CLI
python main.py ui     # Web 控制台（启动器默认使用）
python main.py serve  # 只启动 API
python main.py autorun
```

## 暂停与恢复

| 情况 | 系统行为 | 建议处理 |
| --- | --- | --- |
| BOSS 登录失效或访问过频 | 暂停 BOSS 通道 | 人工处理页面后点击面板“继续”，或执行 `resume boss` |
| 模型切换失败 | 回滚原模型并提示 | 检查 Base URL、模型名、Key 或 Ollama 服务 |
| 模型连续失败 | 暂停自动化 | 先运行 `doctor`，修复模型后重新开始 |
| 一个岗位列表耗尽 | 切换下一个来源；全部耗尽时冷却 | 等待冷却结束 |
| 投递结果无法确认 | 保留聊天页并记录未知状态 | 人工核对，不要重复操作 |

## 使用建议

- 第一次运行时在浏览器旁观察一次完整打招呼流程。
- 不要同时打开大量相同的 BOSS 调度页面。
- 更新用户脚本后必须刷新 BOSS 页面，否则旧页面仍执行旧代码。
- 大幅调整配置或升级前先执行备份；Web 设置页和 CLI `backup` 都可以生成备份。
- 诊断报告可能包含岗位、公司和本地配置摘要，对外发送前先检查内容。

## 常见情况

### Web 控制台打不开

1. 确认终端中的后端仍在运行。
2. 直接访问 `http://127.0.0.1:33333/ui/`。
3. 如果端口被占用，关闭旧的 Job Seeker 控制台或修改 `server_port`。
4. 如果是重新启动后页面空白，等待 1～2 秒让状态接口返回。

### 页面左下角没有面板

1. 确认 Tampermonkey 已安装并启用 BOSS 脚本。
2. 在扩展管理页开启 Tampermonkey 的“开发者模式”。
3. 执行 `script` 或打开安装地址，更新脚本后刷新 BOSS 页面。
4. Web 控制台“概览”的配置检查中，确认“BOSS 油猴脚本”变为已连接。

### 模型评分为 0 或持续失败

执行 `doctor` 检查模型地址、模型名和密钥。使用 Ollama 时确认服务已启动且模型已下载；使用云端时确认 Base URL、模型名、Key 和模型类型匹配。

如果日志提示“模型没有返回内容”，检查 `job_score_num_predict_think_off` 和 `job_score_num_predict_think_on`，默认 `-1` 表示不限制 token。不要设成过小的值。

### 模型切换后仍然使用旧模型

模型切换会等待当前评分任务结束。查看 Web 控制台“模型”页的 warmup 状态；如果切换失败，系统会保留原模型并显示原因。

### 打招呼重复或没有发送

检查 `greeting_mode`：

- `boss_native`：只点击 BOSS 原生“立即沟通”，不打开聊天页、不发送自定义文本；缺少入口时记录并跳过。
- `custom_only`：打开聊天页并发送自定义话术。

如果投递结果无法确认，系统会保留聊天页并记录未知状态，人工核对后再继续。

## 数据位置

| 路径 | 内容 |
| --- | --- |
| `data/config.json` | 运行配置 |
| `data/resume/resume.md` | 当前简历 |
| `data/cache/user_detail.md` | 用户画像 |
| `data/cache/tags.txt` | 岗位搜索标签 |
| `data/cache/greeting.json` | 招呼语 |
| `data/app.db` | 岗位历史、运行记录、事件日志 |
| `data/backups/` | 备份 zip |

状态、日志和历史也可以在浏览器中查看：

- Web 控制台：<http://127.0.0.1:33333/ui/>
- 状态接口：<http://127.0.0.1:33333/status>
- 日志接口：<http://127.0.0.1:33333/logs>
- 历史接口：<http://127.0.0.1:33333/history>

## 致谢

感谢 [goodjobs](https://github.com/gbcdby/goodjobs) 原项目及贡献者。本项目在其基础上持续完善岗位分析与自动化流程，并遵循 MIT License。

同时感谢 Tampermonkey、FastAPI、Ollama 及相关开源项目提供的基础能力。
