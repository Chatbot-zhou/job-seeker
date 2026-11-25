(() => {
    'use strict';

    const BOSS_URL = 'https://www.zhipin.com/web/geek/jobs';
    const USERSCRIPT_URL = '/userscripts/boss.user.js';
    const ROUTES = {
        dashboard: ['概览', '查看运行状态并控制 BOSS 通道'],
        setup: ['首次配置', '几步完成模型、简历、画像和招呼语'],
        models: ['模型', '本机 Ollama 与云端模型可以同时保存并一键切换'],
        greeting: ['招呼语', '默认 BOSS 原生打招呼，自定义话术为高级选项'],
        history: ['历史', '查看已经处理和跳过的岗位'],
        logs: ['日志', '实时查看后端与脚本事件'],
        settings: ['设置', '搜索频率、评分参数和本地数据'],
    };

    const ICONS = {
        dashboard: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
        wand: '<path d="M15 4V2"/><path d="M15 10V8"/><path d="M12 7h2"/><path d="M18 7h2"/><path d="m4 20 9-9"/><path d="m14 6 4 4"/>',
        cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
        message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 8h8M8 12h5"/>',
        history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
        terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
        menu: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
        refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
        external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
        check: '<polyline points="20 6 9 17 4 12"/>',
        arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
        upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
        sparkles: '<path d="m12 3-1.5 4.5L6 9l4.5 1.5L12 15l1.5-4.5L18 9l-4.5-1.5z"/><path d="M5 16l-.8 2.2L2 19l2.2.8L5 22l.8-2.2L8 19l-2.2-.8z"/><path d="M19 13l-.6 1.7L16.7 15l1.7.6L19 17l.6-1.4L21.3 15l-1.7-.3z"/>',
        cloud: '<path d="M17.5 19H7a4.5 4.5 0 1 1 .9-8.9A6 6 0 0 1 19.5 12 3.5 3.5 0 0 1 17.5 19z"/>',
        server: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><line x1="7" y1="7" x2="7.01" y2="7"/><line x1="7" y1="17" x2="7.01" y2="17"/>',
        alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
        x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
        plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
        play: '<polygon points="8 5 19 12 8 19 8 5"/>',
        pause: '<rect x="7" y="5" width="3" height="14" rx="1"/><rect x="14" y="5" width="3" height="14" rx="1"/>',
        stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
        shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    };

    const state = {
        route: 'dashboard',
        status: null,
        setup: null,
        config: null,
        greeting: null,
        history: null,
        logs: [],
        logFilter: 'all',
        ollamaProbe: null,
        modelTest: null,
        busy: false,
        pollTimer: null,
        wizardStep: 1,
        wizardHydrated: false,
        wizardDataLoading: false,
        wizardDataLoaded: false,
        backupPath: '',
        wizard: null,
    };

    function icon(name) {
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    }

    function applyIcons(root = document) {
        root.querySelectorAll('[data-icon]').forEach((el) => {
            if (!el.innerHTML.trim()) el.innerHTML = icon(el.dataset.icon);
        });
    }

    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[ch]));
    }

    function num(value, fallback = 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function bool(value) {
        return value === true || value === 'true' || value === 'on' || value === 1;
    }

    function fmtTime(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        });
    }

    function fmtShortTime(value) {
        if (!value) return '-';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    }

    function sum(...values) {
        return values.reduce((total, value) => total + num(value), 0);
    }

    async function api(path, options = {}) {
        const response = await fetch(path, { cache: 'no-store', ...options });
        const contentType = response.headers.get('content-type') || '';
        let payload;
        if (contentType.includes('application/json')) {
            payload = await response.json();
        } else {
            payload = await response.text();
        }
        if (!response.ok) {
            let detail = payload;
            if (payload && typeof payload === 'object') {
                if (Array.isArray(payload.detail)) {
                    detail = payload.detail.map((item) => item.msg || JSON.stringify(item)).join('；');
                } else {
                    detail = payload.detail || payload.message || JSON.stringify(payload);
                }
            }
            throw new Error(String(detail || `请求失败 HTTP ${response.status}`));
        }
        return payload;
    }

    function postJson(path, body = {}) {
        return api(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    function putJson(path, body = {}) {
        return api(path, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    function toast(message, type = 'info', timeout = 4200) {
        const root = document.getElementById('toast-root');
        if (!root) return;
        const node = document.createElement('div');
        node.className = `toast ${type}`;
        node.textContent = message;
        root.appendChild(node);
        setTimeout(() => {
            node.style.opacity = '0';
            node.style.transform = 'translateY(6px)';
            node.style.transition = 'opacity 180ms ease, transform 180ms ease';
            setTimeout(() => node.remove(), 200);
        }, timeout);
    }

    function closeModal() {
        const root = document.getElementById('modal-root');
        root.classList.remove('open');
        root.innerHTML = '';
    }

    function openModal(title, body, actions = []) {
        const root = document.getElementById('modal-root');
        root.innerHTML = `
            <div class="modal-card" role="dialog" aria-modal="true">
                <div class="card-header">
                    <div><h2>${esc(title)}</h2></div>
                    <button class="icon-btn" data-action="close-modal" type="button" aria-label="关闭">${icon('x')}</button>
                </div>
                <div>${body}</div>
                <div class="modal-actions">
                    ${actions.map((action) => `<button class="btn ${action.kind || 'ghost'}" data-action="${esc(action.action)}" type="button">${esc(action.label)}</button>`).join('')}
                </div>
            </div>`;
        root.classList.add('open');
        applyIcons(root);
    }

    function routeFromHash() {
        const route = location.hash.replace(/^#\/?/, '');
        return ROUTES[route] ? route : 'dashboard';
    }

    function navigate(route) {
        location.hash = `#/${route}`;
    }

    function currentStatus() {
        return state.status || {};
    }

    function modelInfo() {
        const models = currentStatus().models || {};
        const config = state.config || {};
        return {
            provider: models.active_provider || models.provider || config.model_provider || 'ollama',
            model: models.model || config.think_model || '',
            ollamaModel: models.ollama_model || config.ollama_model || '',
            cloudModel: models.cloud_model || config.cloud_model || '',
            ollamaHost: models.ollama_host || config.ollama_host || '',
            cloudBase: models.openai_api_base || config.openai_api_base || '',
            keyConfigured: Boolean(models.openai_api_key_configured || config.openai_api_key_configured),
            warmup: models.warmup || {},
            greetingMode: models.greeting_mode || config.greeting_mode || 'boss_native',
            onboardingCompleted: Boolean(models.onboarding_completed || config.onboarding_completed),
        };
    }

    function warmupInfo() {
        const warmup = modelInfo().warmup || {};
        const status = String(warmup.status || 'unknown');
        if (status === 'ready') return { dot: 'ok', label: '模型已连接', cls: 'ok' };
        if (status === 'checking') return { dot: 'warn', label: '模型检测中', cls: 'warn' };
        if (status === 'error' || status === 'failed') return { dot: 'bad', label: '模型不可用', cls: 'bad' };
        return { dot: '', label: '模型未检测', cls: '' };
    }

    function controlInfo() {
        const backend = currentStatus().backend || {};
        const platform = (currentStatus().platforms || {}).boss || {};
        const control = String(platform.effective_control || platform.control || backend.control || 'paused');
        if (control === 'running') return { key: 'running', label: '运行中', text: '正在处理岗位' };
        if (control === 'stopped') return { key: 'stopped', label: '已停止', text: '当前任务已结束' };
        return { key: 'paused', label: '已暂停', text: '等待开始或继续' };
    }

    function scriptInfo() {
        const script = currentStatus().script || {};
        return {
            connected: Boolean(script.connected),
            stale: Boolean(script.stale),
            page: script.page || '未连接',
            action: script.current_action || '空闲',
            detail: script.detail || {},
            version: String((script.detail || {}).version || ''),
        };
    }

    function setupReady() {
        const setup = state.setup || {};
        return Boolean(
            setup.resume_saved
            && setup.profile_generated
            && num(setup.tags_count) > 0
            && setup.greeting_confirmed
        );
    }

    function setupChecklist() {
        const setup = state.setup || {};
        const models = modelInfo();
        const warmup = warmupInfo();
        const script = setup.script || {};
        return [
            {
                key: 'model', title: '模型连接', done: warmup.cls === 'ok',
                detail: warmup.cls === 'ok' ? `${models.provider === 'ollama' ? '本机 Ollama' : '云端模型'} · ${models.model}` : '先测试并启用一个模型',
                action: 'navigate', route: 'models',
            },
            {
                key: 'resume', title: '简历', done: Boolean(setup.resume_saved),
                detail: setup.resume_saved ? '已保存并提取' : '上传 PDF 或手动填写',
                action: 'navigate', route: 'setup',
            },
            {
                key: 'profile', title: '画像与标签', done: Boolean(setup.profile_generated && num(setup.tags_count) > 0),
                detail: setup.profile_generated ? `${num(setup.tags_count)} 个岗位标签` : '用模型自动生成',
                action: 'navigate', route: 'setup',
            },
            {
                key: 'greeting', title: '打招呼方式',
                done: Boolean(setup.greeting_mode === 'boss_native' || setup.greeting_confirmed),
                detail: setup.greeting_mode === 'boss_native'
                    ? 'BOSS 原生“立即沟通”，不发送自定义文本'
                    : (setup.greeting_confirmed ? '自定义话术已启用' : '生成或填写自定义话术'),
                action: 'navigate', route: 'greeting',
            },
            {
                key: 'script', title: 'BOSS 油猴脚本', done: Boolean(script.connected),
                detail: script.connected ? `已连接 · ${script.version || '版本未知'}` : '安装脚本并刷新 BOSS 页面',
                action: 'open-userscript',
            },
        ];
    }

    function setPageHeading(route) {
        const [title, subtitle] = ROUTES[route] || ROUTES.dashboard;
        document.getElementById('page-title').textContent = title;
        document.getElementById('page-subtitle').textContent = subtitle;
        document.querySelectorAll('.nav-item').forEach((item) => {
            item.classList.toggle('active', item.dataset.route === route);
        });
    }

    function renderTopbar() {
        const models = modelInfo();
        const warmup = warmupInfo();
        const control = controlInfo();
        const switchEl = document.getElementById('model-switch');
        if (switchEl) {
            const ollamaDot = models.provider === 'ollama' ? warmup.dot : '';
            const cloudDot = models.provider === 'openai' ? warmup.dot : '';
            switchEl.innerHTML = `
                <button class="model-option ${models.provider === 'ollama' ? 'active' : ''}" data-action="switch-model" data-provider="ollama" type="button" ${state.busy ? 'disabled' : ''}>
                    <span class="status-dot ${ollamaDot}"></span>本机 Ollama
                </button>
                <button class="model-option ${models.provider === 'openai' ? 'active' : ''}" data-action="switch-model" data-provider="openai" type="button" ${state.busy ? 'disabled' : ''}>
                    <span class="status-dot ${cloudDot}"></span>云端模型
                </button>`;
        }
        const chip = document.getElementById('run-chip');
        if (chip) {
            chip.innerHTML = `<span class="run-chip ${control.key}"><span class="status-dot"></span>${control.label}</span>`;
        }
    }

    async function refreshStatus(silent = false) {
        try {
            state.status = await api('/status');
            renderTopbar();
            if (state.route === 'dashboard') {
                const view = document.getElementById('view');
                if (view) {
                    view.innerHTML = dashboardView();
                    applyIcons(view);
                }
            }
            return state.status;
        } catch (error) {
            if (!silent) toast(`读取状态失败：${error.message}`, 'error');
            return null;
        }
    }

    async function loadSetup() {
        try {
            state.setup = await api('/setup/status');
        } catch (error) {
            toast(`读取配置状态失败：${error.message}`, 'error');
        }
    }

    async function loadConfig() {
        try {
            const result = await api('/config');
            state.config = result.config || {};
        } catch (error) {
            toast(`读取配置失败：${error.message}`, 'error');
        }
    }

    async function loadGreeting() {
        try {
            state.greeting = await api('/greeting');
        } catch (error) {
            toast(`读取招呼语失败：${error.message}`, 'error');
        }
    }

    async function loadHistory() {
        try {
            state.history = await api('/history?limit=100');
        } catch (error) {
            toast(`读取历史失败：${error.message}`, 'error');
        }
    }

    async function loadLogs() {
        try {
            const result = await api('/logs?limit=200');
            state.logs = result.logs || [];
            if (state.route === 'logs') {
                const view = document.getElementById('view');
                if (view) {
                    view.innerHTML = logsView();
                    applyIcons(view);
                }
            }
            if (state.route === 'dashboard') {
                const activity = document.getElementById('activity-list');
                if (activity) activity.innerHTML = activityListHtml();
            }
        } catch (error) {
            if (state.route === 'logs') toast(`读取日志失败：${error.message}`, 'error');
        }
    }

    function startPolling() {
        if (state.pollTimer) clearInterval(state.pollTimer);
        state.pollTimer = setInterval(async () => {
            if (document.hidden) return;
            await refreshStatus(true);
            if (state.route === 'logs') await loadLogs();
        }, 3000);
    }

    function hydrateWizard(force = false) {
        if (state.wizardHydrated && !force) return;
        const config = state.config || {};
        const setup = state.setup || {};
        const models = setup.model || {};
        state.wizard = {
            step: state.wizardStep || 1,
            provider: config.model_provider || models.active_provider || 'ollama',
            ollamaHost: config.ollama_host || models.ollama_host || 'http://127.0.0.1:11434',
            ollamaModel: config.ollama_model || models.ollama_model || config.think_model || 'qwen3:1.7b',
            cloudBase: config.openai_api_base || models.openai_api_base || 'https://api.openai.com/v1',
            cloudModel: config.cloud_model || models.cloud_model || 'gpt-4o-mini',
            cloudKey: '',
            cloudProfile: config.external_model_profile || models.external_model_profile || 'generic',
            greetingMode: config.greeting_mode || models.greeting_mode || 'boss_native',
            resumeMarkdown: '',
            tags: Array.isArray(setup.tags) ? setup.tags.slice() : [],
            profileWarnings: [],
            profileConfirmed: false,
            userDetail: '',
            greetingText: '',
            greetingStyle: 'default',
            greetingVariants: [],
            loadedResume: false,
            loadedProfile: false,
            loadedGreeting: false,
        };
        state.wizardHydrated = true;
    }

    async function ensureWizardData() {
        hydrateWizard();
        if (state.wizardDataLoaded) return;
        if (state.wizardDataLoading) return;
        state.wizardDataLoading = true;
        try {
            if (state.setup && state.setup.has_existing_data && !state.backupPath) {
                const done = sessionStorage.getItem('jobseeker_backup_done') === '1';
                if (!done) {
                    try {
                        const result = await postJson('/setup/backup');
                        state.backupPath = result.path || '';
                        sessionStorage.setItem('jobseeker_backup_done', '1');
                        toast('已备份现有配置和缓存', 'ok');
                    } catch (error) {
                        toast(`自动备份失败：${error.message}`, 'warn', 6000);
                    }
                }
            }
            if (!state.wizard.loadedResume) {
                const result = await api('/resume');
                state.wizard.resumeMarkdown = result.markdown || '';
                state.wizard.loadedResume = true;
            }
            if (!state.wizard.loadedProfile) {
                const result = await api('/resume/profile');
                state.wizard.tags = Array.isArray(result.tags) ? result.tags.slice() : [];
                state.wizard.userDetail = result.user_detail || '';
                state.wizard.profileWarnings = Array.isArray(result.grounding_warnings) ? result.grounding_warnings : [];
                state.wizard.profileConfirmed = false;
                state.wizard.loadedProfile = true;
            }
            if (!state.wizard.loadedGreeting) {
                const result = await api('/greeting');
                const active = (result.active || {}).content || result.active_content || '';
                state.wizard.greetingText = active;
                state.wizard.loadedGreeting = true;
            }
            state.wizardDataLoaded = true;
        } catch (error) {
            toast(`读取现有数据失败：${error.message}`, 'warn');
        } finally {
            state.wizardDataLoading = false;
            if (state.route === 'setup') {
                const view = document.getElementById('view');
                if (view) {
                    view.innerHTML = setupView();
                    applyIcons(view);
                }
            }
        }
    }

    function render() {
        setPageHeading(state.route);
        renderTopbar();
        const view = document.getElementById('view');
        if (!view) return;
        const renderers = {
            dashboard: dashboardView,
            setup: setupView,
            models: modelsView,
            greeting: greetingView,
            history: historyView,
            logs: logsView,
            settings: settingsView,
        };
        view.innerHTML = (renderers[state.route] || dashboardView)();
        applyIcons(view);
        if (state.route === 'setup') ensureWizardData();
        if (state.route === 'greeting' && !state.greeting) {
            loadGreeting().then(() => {
                if (state.route === 'greeting') {
                    view.innerHTML = greetingView();
                    applyIcons(view);
                }
            });
        }
        if (state.route === 'history' && !state.history) {
            loadHistory().then(() => {
                if (state.route === 'history') {
                    view.innerHTML = historyView();
                    applyIcons(view);
                }
            });
        }
        if (state.route === 'logs' && !state.logs.length) loadLogs();
    }

    function activityListHtml() {
        const logs = state.logs.slice(0, 5);
        if (!logs.length) return '<div class="empty compact">暂无事件，启动后会显示在这里。</div>';
        return logs.map((item) => `
            <div class="activity-item">
                <span class="activity-time">${esc(fmtShortTime(item.time))}</span>
                <div class="activity-body">
                    <strong class="one-line" title="${esc(item.message || item.type || '')}">${esc(item.message || item.type || '事件')}</strong>
                    <small>${esc(item.source || '')}${item.type ? ' · ' + esc(item.type) : ''}</small>
                </div>
            </div>`).join('');
    }

    function dashboardView() {
        const setup = state.setup || {};
        const models = modelInfo();
        const warmup = warmupInfo();
        const control = controlInfo();
        const script = scriptInfo();
        const backend = currentStatus().backend || {};
        const detail = script.detail || {};
        const queue = currentStatus().model_queue || {};
        const runSummary = currentStatus().run_summary || {};
        const onboardingDone = Boolean(setup.onboarding_completed || models.onboardingCompleted);
        const checks = setupChecklist();
        const doneCount = checks.filter((item) => item.done).length;
        const missing = checks.filter((item) => !item.done);
        const todayCount = detail.dailyGreetCount ?? runSummary.greet_success ?? 0;
        const sessionCount = detail.sessionGreetCount ?? runSummary.greet_success ?? 0;
        const analyzedCount = num(runSummary.jobs_analyzed);
        const running = control.key === 'running';
        const queueText = queue.limit ? `${num(queue.active)}/${num(queue.limit)}` : '空闲';
        const currentJob = detail.currentJobTitle || '等待新岗位';
        const sourceLabel = detail.jobSource === 'preferred_feed'
            ? '推荐 Tab'
            : (detail.jobSource === 'keyword_search' ? '关键词搜索' : '待命');
        const scrollShort = detail.scrollRound ? `第 ${detail.scrollRound} 轮` : '待命';
        const heroTitle = running ? 'BOSS 通道运行中' : (control.key === 'stopped' ? 'BOSS 通道已停止' : 'BOSS 通道已暂停');
        const heroSub = running
            ? `${currentJob} · ${sourceLabel}`
            : (onboardingDone ? '点击开始后继续处理推荐岗位' : '完成首次配置后即可开始');
        const statusTone = running ? 'ok' : (control.key === 'stopped' ? 'bad' : 'warn');
        return `
            ${!onboardingDone ? `
            <div class="banner">
                <div class="banner-body">
                    <strong>完成首次配置后即可开始</strong>
                    <small>只需选择模型并上传简历，其余内容会自动生成。</small>
                </div>
                <button class="btn small" data-action="navigate" data-route="setup" type="button">开始配置</button>
            </div>` : ''}
            <section class="card dash-hero">
                <div class="dash-hero-main">
                    <span class="eyebrow"><span class="status-dot"></span>BOSS 直聘</span>
                    <div class="dash-hero-title">
                        <h2>${heroTitle}</h2>
                    </div>
                    <p class="dash-hero-sub">${esc(heroSub)}</p>
                    <div class="hero-actions">
                        ${running
                            ? `<button class="btn" data-action="pause" type="button">${icon('pause')}暂停</button>
                               <button class="btn danger" data-action="stop" type="button">${icon('stop')}停止</button>`
                            : `<button class="btn" data-action="start" type="button">${icon('play')}开始运行</button>
                               <button class="btn ghost" data-action="open-boss" type="button">${icon('external')}打开 BOSS 岗位页</button>`}
                        <button class="btn ghost" data-action="open-userscript" type="button">${icon('shield')}安装/更新脚本</button>
                    </div>
                </div>
                <div class="dash-hero-side">
                    <div class="hero-status-row">
                        <span class="pill ${warmup.cls}">${esc(warmup.label)}</span>
                        <span class="pill ${script.connected ? 'ok' : 'warn'}">${script.connected ? '脚本在线' : '脚本离线'}</span>
                        <span class="pill">队列 ${esc(queueText)}</span>
                    </div>
                    <div class="hero-model">
                        <span>当前模型</span>
                        <strong title="${esc(models.model || '')}">${esc(models.model || '未选择')}</strong>
                        <small>${models.provider === 'ollama' ? '本机 Ollama' : '云端模型'}</small>
                    </div>
                </div>
            </section>

            <div class="stat-grid dash-stats">
                <div class="stat-card"><span>今日成功</span><strong>${todayCount}</strong><small>已确认打招呼</small></div>
                <div class="stat-card"><span>本轮成功</span><strong>${sessionCount}</strong><small>本轮累计</small></div>
                <div class="stat-card"><span>本轮分析</span><strong>${analyzedCount}</strong><small>模型评分岗位</small></div>
                <div class="stat-card"><span>当前来源</span><strong>${esc(sourceLabel)}</strong><small>${esc(detail.currentFeedTabName || '等待脚本')}</small></div>
            </div>

            <div class="dash-grid">
                <section class="card run-card">
                    <div class="card-header">
                        <div><h2 class="card-title">当前运行</h2></div>
                        <span class="pill ${statusTone}">${esc(control.label)}</span>
                    </div>
                    <div class="run-grid">
                        <div class="run-item"><span>当前岗位</span><strong class="one-line" title="${esc(currentJob)}">${esc(currentJob)}</strong><small>${esc(detail.currentJobId || '')}</small></div>
                        <div class="run-item"><span>岗位来源</span><strong>${esc(sourceLabel)}</strong><small>${esc(detail.currentFeedTabName || '未选择 Tab')}</small></div>
                        <div class="run-item"><span>列表进度</span><strong>${esc(scrollShort)}</strong><small>${esc(detail.lastScrollOutcome || '等待脚本上报')}</small></div>
                        <div class="run-item"><span>脚本</span><strong>${script.connected ? '在线' : '离线'}</strong><small>${esc(script.version || script.action)}</small></div>
                    </div>
                </section>

                <section class="card checklist-card">
                    <div class="card-header">
                        <div><h2 class="card-title">配置</h2><p class="card-subtitle">已完成 ${doneCount}/${checks.length} 项</p></div>
                        <span class="pill ${missing.length ? 'warn' : 'ok'}">${missing.length ? `${missing.length} 项待处理` : '已就绪'}</span>
                    </div>
                    <div class="progress" style="margin-bottom:14px"><i style="width:${Math.round(doneCount / checks.length * 100)}%"></i></div>
                    <div class="checklist compact">
                        ${missing.length
                            ? missing.slice(0, 3).map((item) => `
                                <div class="check-row todo compact" ${item.action === 'navigate' ? `data-action="navigate" data-route="${item.route}"` : `data-action="${item.action}"`} role="button" tabindex="0">
                                    <div class="check-icon">${icon('alert')}</div>
                                    <div class="check-body"><strong>${esc(item.title)}</strong></div>
                                    <span class="faint">去处理</span>
                                </div>`).join('') + (missing.length > 3 ? `<div class="notice">还有 ${missing.length - 3} 项可在首次配置中完成</div>` : '')
                            : `<div class="check-row done compact"><div class="check-icon">${icon('check')}</div><div class="check-body"><strong>配置已就绪</strong></div><span class="faint">可以运行</span></div>`}
                    </div>
                </section>
            </div>

            <section class="card activity-card">
                <div class="card-header">
                    <div><h2 class="card-title">最近动态</h2><p class="card-subtitle">最近 5 条事件</p></div>
                    <button class="btn subtle small" data-action="navigate" data-route="logs" type="button">全部日志</button>
                </div>
                <div class="activity-list" id="activity-list">${activityListHtml()}</div>
            </section>`;
    }

    function modelsView() {
        const models = modelInfo();
        const config = state.config || {};
        const warmup = models.warmup || {};
        const test = state.modelTest;
        const probe = state.ollamaProbe;
        const testHtml = test ? `<div class="notice" style="margin-bottom:14px"><strong>${test.ok ? '测试通过' : '测试失败'}</strong><br>${esc(test.warmup?.error || test.warmup?.model || '')}</div>` : '';
        return `
            <div class="grid-2">
                <div class="stack">
                    ${testHtml}
                    <div class="model-grid">
                        <section class="model-card ${models.provider === 'ollama' ? 'active' : ''}">
                            <div class="model-card-head">
                                <div class="model-identity">
                                    <div class="model-logo">${icon('server')}</div>
                                    <div><strong>本机 Ollama</strong><small>本地 · 数据不出本机</small></div>
                                </div>
                                ${models.provider === 'ollama' ? '<span class="pill ok">当前使用</span>' : ''}
                            </div>
                            <div class="form-grid">
                                <div class="field span-2">
                                    <label>Ollama 地址</label>
                                    <input class="input" id="model-ollama-host" data-wizard-field="ollamaHost" value="${esc(models.ollamaHost || 'http://127.0.0.1:11434')}" placeholder="http://127.0.0.1:11434">
                                </div>
                                <div class="field span-2">
                                    <label>模型名称</label>
                                    <input class="input" id="model-ollama-model" data-wizard-field="ollamaModel" value="${esc(models.ollamaModel)}" list="ollama-model-list" placeholder="qwen3:1.7b">
                                    <datalist id="ollama-model-list">${(probe?.models || []).map((model) => `<option value="${esc(model)}"></option>`).join('')}</datalist>
                                    <small>${probe ? (probe.available ? `检测到 ${probe.models.length} 个本地模型` : `无法连接：${esc(probe.error || '')}`) : '点击下方检测本机已安装的模型'}</small>
                                </div>
                            </div>
                            <div class="form-actions">
                                <button class="btn ghost small" data-action="probe-ollama" type="button">${icon('refresh')}检测本机模型</button>
                                <button class="btn ghost small" data-action="model-test" data-provider="ollama" type="button">测试连接</button>
                                <button class="btn ghost small" data-action="model-save" data-provider="ollama" type="button">保存配置</button>
                                <button class="btn small" data-action="model-use" data-provider="ollama" type="button">使用此模型</button>
                            </div>
                        </section>

                        <section class="model-card ${models.provider === 'openai' ? 'active' : ''}">
                            <div class="model-card-head">
                                <div class="model-identity">
                                    <div class="model-logo cloud">${icon('cloud')}</div>
                                    <div><strong>云端模型</strong><small>任意 OpenAI 兼容接口</small></div>
                                </div>
                                ${models.provider === 'openai' ? '<span class="pill ok">当前使用</span>' : ''}
                            </div>
                            <div class="form-grid">
                                <div class="field span-2">
                                    <label>Base URL</label>
                                    <input class="input" id="model-cloud-base" data-wizard-field="cloudBase" value="${esc(models.cloudBase || 'https://api.openai.com/v1')}" placeholder="https://api.openai.com/v1">
                                </div>
                                <div class="field">
                                    <label>模型名称</label>
                                    <input class="input" id="model-cloud-model" data-wizard-field="cloudModel" value="${esc(models.cloudModel)}" placeholder="gpt-4o-mini / deepseek-chat">
                                </div>
                                <div class="field">
                                    <label>模型类型</label>
                                    <select class="select" id="model-cloud-profile" data-wizard-field="cloudProfile">
                                        ${['generic', 'qwen', 'deepseek', 'doubao'].map((item) => `<option value="${item}" ${String(config.external_model_profile || 'generic') === item ? 'selected' : ''}>${item}</option>`).join('')}
                                    </select>
                                </div>
                                <div class="field span-2">
                                    <label>API Key</label>
                                    <input class="input" id="model-cloud-key" type="password" autocomplete="off" placeholder="${models.keyConfigured ? '已配置，留空表示不修改' : '输入云端 API Key'}">
                                    <small>${config.openai_api_key_source === 'env' ? '当前使用环境变量 OPENAI_API_KEY' : '只保存在本机 data/config.json'}</small>
                                </div>
                            </div>
                            <div class="form-actions">
                                <button class="btn ghost small" data-action="model-test" data-provider="openai" type="button">测试连接</button>
                                <button class="btn ghost small" data-action="model-save" data-provider="openai" type="button">保存配置</button>
                                <button class="btn small" data-action="model-use" data-provider="openai" type="button">使用此模型</button>
                            </div>
                        </section>
                    </div>

                    <section class="card flat">
                        <div class="card-header"><div><h2 class="card-title">切换说明</h2><p class="card-subtitle">顶部切换器会立即用于后续岗位评分</p></div></div>
                        <div class="checklist compact">
                            <div class="check-row done compact"><div class="check-icon">${icon('pause')}</div><div class="check-body"><strong>运行中切换</strong></div><span class="faint">先暂停</span></div>
                            <div class="check-row done compact"><div class="check-icon">${icon('check')}</div><div class="check-body"><strong>新模型 warmup 通过</strong></div><span class="faint">自动恢复</span></div>
                            <div class="check-row todo compact"><div class="check-icon">${icon('alert')}</div><div class="check-body"><strong>warmup 失败</strong></div><span class="faint">回滚原模型</span></div>
                        </div>
                    </section>
                </div>

                <div class="stack">
                    <section class="card">
                        <div class="card-header"><div><h2 class="card-title">当前生效</h2><p class="card-subtitle">状态来自后端 warmup</p></div></div>
                        <div class="field-row"><div class="field-row-body"><strong>来源</strong><small>${models.provider === 'ollama' ? '本机 Ollama' : '云端模型'}</small></div><span class="pill ${warmupInfo().cls}">${esc(warmupInfo().label)}</span></div>
                        <div class="field-row"><div class="field-row-body"><strong>模型</strong><small>${esc(models.model || '-')}</small></div></div>
                        <div class="field-row"><div class="field-row-body"><strong>最近检查</strong><small>${esc(fmtTime(warmup.last_checked))}</small></div></div>
                        <div class="field-row"><div class="field-row-body"><strong>延迟</strong><small>${warmup.latency_seconds != null ? `${warmup.latency_seconds}s` : '-'}</small></div></div>
                        ${warmup.error ? `<div class="notice" style="margin-top:14px">${esc(warmup.error)}</div>` : ''}
                    </section>
                    <section class="card flat">
                        <div class="card-header"><div><h2 class="card-title">高级参数</h2><p class="card-subtitle">在设置页调整温度和 token 预算</p></div></div>
                        <button class="btn ghost small" data-action="navigate" data-route="settings" type="button">打开设置</button>
                    </section>
                </div>
            </div>`;
    }

    function greetingView() {
        const greeting = state.greeting || { variants: [] };
        const mode = state.wizard?.greetingMode || modelInfo().greetingMode || 'boss_native';
        const active = (greeting.active || {}).content || greeting.active_content || '';
        const variants = greeting.variants || [];
        return `
            <div class="grid-2">
                <div class="stack">
                    <section class="card">
                        <div class="card-header">
                            <div><h2 class="card-title">打招呼方式</h2><p class="card-subtitle">由 BOSS 平台完成联系，不发送生成文本</p></div>
                        </div>
                        <div class="segmented" style="margin-bottom:16px">
                            <button class="${mode === 'boss_native' ? 'active' : ''}" data-action="set-greeting-mode" data-mode="boss_native" type="button">BOSS 原生（推荐）</button>
                            <button class="${mode === 'custom_only' ? 'active' : ''}" data-action="set-greeting-mode" data-mode="custom_only" type="button">自定义话术（高级）</button>
                        </div>
                        <div class="notice" style="margin-bottom:16px">
                            <strong>${mode === 'boss_native' ? 'BOSS 原生' : '自定义话术'}</strong>：${mode === 'boss_native'
                                ? '只点击 BOSS 页面原生的“立即沟通/打招呼”入口，由平台创建沟通，不发送任何自定义文本。'
                                : '会打开聊天页并发送下面的自定义话术；可能产生额外文本消息。'}
                        </div>
                        ${mode === 'custom_only' ? `
                        <div class="field">
                            <label>自定义招呼语</label>
                            <textarea class="textarea" id="greeting-text" placeholder="写一段简短、具体的打招呼内容">${esc(active)}</textarea>
                            <small>不要包含手机号、邮箱、微信等隐私信息；后端会拦截。</small>
                        </div>
                        <div class="form-actions">
                            <select class="select" id="greeting-style" style="max-width:180px">
                                <option value="default">默认风格</option>
                                <option value="简洁版">简洁版</option>
                                <option value="热情版">热情版</option>
                                <option value="技术突出版">技术突出版</option>
                                <option value="业务匹配版">业务匹配版</option>
                            </select>
                            <button class="btn ghost small" data-action="generate-greeting" type="button">${icon('sparkles')}生成草稿</button>
                            <button class="btn small" data-action="save-greeting" type="button">保存并启用</button>
                        </div>` : `
                        <div class="notice">BOSS 原生模式无需话术内容；需要发送自定义文本时再切换到高级模式。</div>`}
                    </section>

                    <section class="card">
                        <div class="card-header"><div><h2 class="card-title">历史版本</h2><p class="card-subtitle">点击任意版本填入编辑器</p></div></div>
                        <div class="variant-list">
                            ${variants.length ? variants.map((item, index) => `
                                <div class="variant" data-action="pick-greeting" data-index="${index}" role="button" tabindex="0">
                                    <div><p>${esc(item.content || '')}</p><small>${esc(item.name || '未命名')} · ${esc(fmtTime(item.updated_at))}</small></div>
                                    ${item.content === active ? '<span class="pill ok">当前</span>' : ''}
                                </div>`).join('') : '<div class="empty">还没有历史版本，生成或保存后会显示在这里。</div>'}
                        </div>
                    </section>
                </div>
                <div class="stack">
                    <section class="card flat">
                        <div class="card-header"><div><h2 class="card-title">${mode === 'boss_native' ? '原生打招呼' : '发送逻辑'}</h2><p class="card-subtitle">${mode === 'boss_native' ? '由 BOSS 平台完成联系' : '会发送一条自定义文本'}</p></div></div>
                        <div class="checklist compact">
                            ${mode === 'boss_native' ? `
                            <div class="check-row done compact"><div class="check-icon">${icon('check')}</div><div class="check-body"><strong>详情页有“立即沟通”</strong></div><span class="faint">点击一次</span></div>
                            <div class="check-row done compact"><div class="check-icon">${icon('check')}</div><div class="check-body"><strong>不打开聊天页</strong></div><span class="faint">不发送文本</span></div>
                            <div class="check-row todo compact"><div class="check-icon">${icon('arrow')}</div><div class="check-body"><strong>缺少原生入口</strong></div><span class="faint">记录并跳过</span></div>` : `
                            <div class="check-row done compact"><div class="check-icon">${icon('check')}</div><div class="check-body"><strong>打开聊天页</strong></div><span class="faint">发送话术</span></div>
                            <div class="check-row done compact"><div class="check-icon">${icon('check')}</div><div class="check-body"><strong>发送后确认</strong></div><span class="faint">未知则暂停</span></div>`}
                        </div>
                    </section>
                    <section class="card flat">
                        <div class="card-header"><div><h2 class="card-title">提示</h2></div></div>
                        <p class="muted" style="margin:0;font-size:12px">如果 BOSS 页面没有出现入口，或平台要求人工验证，系统会暂停 BOSS 通道，不会连续重试。</p>
                    </section>
                </div>
            </div>`;
    }

    function contextFields(config) {
        return [
            ['score_threshold', '最低匹配度阈值', 'number', '0-100'],
            ['search_round_cooldown_min_minutes', '最短搜索冷却（分钟）', 'number', '1-240'],
            ['search_round_cooldown_minutes', '最长搜索冷却（分钟）', 'number', '1-240'],
            ['tag_search_delay_seconds', '标签最小间隔（秒）', 'number', '3-60'],
            ['tag_search_delay_max_seconds', '标签最大间隔（秒）', 'number', '3-60'],
            ['max_search_submissions_per_hour', '每小时搜索上限', 'number', '1-60'],
            ['max_search_submissions_per_day', '每日搜索上限', 'number', '1-300'],
            ['search_result_scroll_rounds', '列表滚动轮次', 'number', '0-20'],
            ['preferred_feed_max_jobs_per_tab', '每个推荐 Tab 岗位上限（0 不限）', 'number', '0-500'],
            ['job_detail_max_chars', 'JD 最大字数', 'number', '500-8000'],
        ].map(([key, label, type, hint]) => `
            <div class="field">
                <label>${label}</label>
                <input class="input" type="${type}" id="setting-${key}" value="${esc(config[key] ?? '')}" placeholder="${hint}">
                <small>${hint}</small>
            </div>`).join('');
    }

    function settingsView() {
        const config = state.config || {};
        return `
            <div class="grid-2">
                <div class="stack">
                    <section class="card">
                        <div class="card-header"><div><h2 class="card-title">搜索与风控</h2><p class="card-subtitle">降低频率通常能减少平台安全校验</p></div></div>
                        <div class="form-grid">${contextFields(config)}</div>
                        <div class="form-actions">
                            <button class="btn small" data-action="save-settings" type="button">保存设置</button>
                        </div>
                    </section>
                    <section class="card">
                        <div class="card-header"><div><h2 class="card-title">模型输出</h2><p class="card-subtitle">评分 token 预算和采样参数</p></div></div>
                        <div class="form-grid">
                            <div class="field"><label>评分 token（关思考，-1 不限）</label><input class="input" type="number" id="setting-job_score_num_predict_think_off" value="${esc(config.job_score_num_predict_think_off ?? -1)}"></div>
                            <div class="field"><label>评分 token（开思考，-1 不限）</label><input class="input" type="number" id="setting-job_score_num_predict_think_on" value="${esc(config.job_score_num_predict_think_on ?? -1)}"></div>
                            <div class="field"><label>temperature</label><input class="input" type="number" step="0.05" id="setting-model_temperature" value="${esc(config.model_temperature ?? 0.2)}"></div>
                            <div class="field"><label>top_p</label><input class="input" type="number" step="0.05" id="setting-model_top_p" value="${esc(config.model_top_p ?? 0.8)}"></div>
                        </div>
                        <div class="field-row" style="margin-top:10px">
                            <div class="field-row-body"><strong>关闭模型思考</strong><small>评分更快，小模型推荐开启</small></div>
                            <button class="switch ${config.disable_model_thinking ? 'on' : ''}" data-action="toggle-setting" data-setting="disable_model_thinking" type="button" aria-label="切换关闭模型思考"></button>
                        </div>
                        <div class="field-row">
                            <div class="field-row-body"><strong>显示模型推理</strong><small>仅在 CLI 和日志中显示</small></div>
                            <button class="switch ${config.show_model_reasoning ? 'on' : ''}" data-action="toggle-setting" data-setting="show_model_reasoning" type="button" aria-label="切换显示模型推理"></button>
                        </div>
                        <div class="form-actions"><button class="btn small" data-action="save-settings" type="button">保存设置</button></div>
                    </section>
                </div>
                <div class="stack">
                    <section class="card flat">
                        <div class="card-header"><div><h2 class="card-title">本地数据</h2><p class="card-subtitle">配置、简历、画像、话术和岗位历史</p></div></div>
                        <div class="field-row"><div class="field-row-body"><strong>重新运行配置向导</strong><small>会重新生成配置；建议先备份</small></div><button class="btn ghost small" data-action="reset-onboarding" type="button">重新配置</button></div>
                        <div class="field-row"><div class="field-row-body"><strong>备份本地数据</strong><small>生成 data/backups 下的 zip 文件</small></div><button class="btn ghost small" data-action="backup" type="button">立即备份</button></div>
                        <div class="field-row"><div class="field-row-body"><strong>当前渠道</strong><small>BOSS 直聘 · 本机运行</small></div><span class="pill ok">BOSS</span></div>
                    </section>
                    <section class="card flat">
                        <div class="card-header"><div><h2 class="card-title">脚本地址</h2></div></div>
                        <div class="notice"><span class="mono">${esc(USERSCRIPT_URL)}</span><br>安装或更新后请刷新 BOSS 岗位页。</div>
                        <div class="form-actions"><button class="btn ghost small" data-action="open-userscript" type="button">${icon('external')}打开安装页</button></div>
                    </section>
                </div>
            </div>`;
    }

    function historyView() {
        const jobs = (state.history && state.history.jobs) || [];
        const actions = (state.history && state.history.actions) || [];
        return `
            <div class="stack">
                <div class="stat-grid">
                    <div class="stat-card"><span>近期岗位</span><strong>${jobs.length}</strong><small>最近 100 条</small></div>
                    <div class="stat-card"><span>已沟通</span><strong>${jobs.filter((job) => job.greeted).length}</strong><small>greeted=true</small></div>
                    <div class="stat-card"><span>跳过</span><strong>${jobs.filter((job) => ['skip', 'model_failed_skip'].includes(job.final_action || job.recommendation)).length}</strong><small>评分未达标或重复</small></div>
                    <div class="stat-card"><span>动作</span><strong>${actions.length}</strong><small>最近 100 条</small></div>
                </div>
                <section class="card">
                    <div class="card-header">
                        <div><h2 class="card-title">岗位历史</h2><p class="card-subtitle">来自 data/app.db</p></div>
                        <button class="btn ghost small" data-action="refresh-history" type="button">${icon('refresh')}刷新</button>
                    </div>
                    <div class="table-wrap">
                        <table class="table">
                            <thead><tr><th>时间</th><th>公司 / 职位</th><th>评分</th><th>结果</th><th>状态</th></tr></thead>
                            <tbody>
                                ${jobs.length ? jobs.map((job) => `
                                    <tr>
                                        <td class="muted-cell nowrap">${esc(fmtTime(job.updated_at))}</td>
                                        <td><strong>${esc(job.company || '-')}</strong><br><span class="muted">${esc(job.title || '-')}</span></td>
                                        <td class="score">${job.analysis?.total_score ?? job.total_score ?? '-'}</td>
                                        <td>${esc(job.final_action || job.recommendation || '-')}</td>
                                        <td>${job.greeted ? '<span class="pill ok">已沟通</span>' : (job.error ? '<span class="pill bad">异常</span>' : '<span class="pill">已处理</span>')}</td>
                                    </tr>`).join('') : '<tr><td colspan="5"><div class="empty">还没有岗位历史，开始运行后会显示在这里。</div></td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>`;
    }

    function logsView() {
        const levels = ['all', 'info', 'warning', 'error'];
        const items = state.logs.filter((item) => state.logFilter === 'all' || item.level === state.logFilter);
        return `
            <div class="stack">
                <section class="card">
                    <div class="card-header">
                        <div><h2 class="card-title">运行日志</h2><p class="card-subtitle">每 3 秒自动刷新，最多显示 200 条</p></div>
                        <div class="segmented">
                            ${levels.map((level) => `<button class="${state.logFilter === level ? 'active' : ''}" data-action="log-filter" data-level="${level}" type="button">${level === 'all' ? '全部' : level}</button>`).join('')}
                        </div>
                    </div>
                    <div class="log-list">
                        ${items.length ? items.map((item) => `
                            <div class="log-item ${esc(item.level || '')}">
                                <span class="log-time">${esc(fmtShortTime(item.time))}</span>
                                <div class="log-body">
                                    <strong>${esc(item.message || item.type || '')}</strong>
                                    <p><span class="log-source">${esc(item.source || '')}</span>${esc(item.type || '')}</p>
                                </div>
                            </div>`).join('') : '<div class="empty">暂无日志。</div>'}
                    </div>
                </section>
            </div>`;
    }

    function fieldHtml(label, id, value, options = {}) {
        const span = options.span ? 'span-2' : '';
        return `<div class="field ${span}">
            <label>${esc(label)}</label>
            <input class="input" id="${esc(id)}" type="${esc(options.type || 'text')}" value="${esc(value ?? '')}" placeholder="${esc(options.placeholder || '')}" ${options.min !== undefined ? `min="${esc(options.min)}"` : ''} ${options.max !== undefined ? `max="${esc(options.max)}"` : ''} ${options.step ? `step="${esc(options.step)}"` : ''} ${options.autocomplete ? `autocomplete="${esc(options.autocomplete)}"` : ''}>
            ${options.hint ? `<small>${esc(options.hint)}</small>` : ''}
        </div>`;
    }

    function stepHeader() {
        const labels = ['模型', '简历', '画像', '招呼语', '完成'];
        return `<div class="wizard-steps">${labels.map((label, index) => {
            const step = index + 1;
            const cls = step === state.wizard.step ? 'active' : (step < state.wizard.step ? 'done' : '');
            return `<div class="wizard-step ${cls}"><span class="step-num">${step}</span><span>${label}</span></div>`;
        }).join('')}</div>`;
    }

    function setupView() {
        hydrateWizard();
        const wizard = state.wizard;
        const step = wizard.step;
        const setup = state.setup || {};
        const backup = state.backupPath;
        const modelCards = `
            <div class="model-grid">
                <section class="model-card ${wizard.provider === 'ollama' ? 'active' : ''}">
                    <div class="model-card-head"><div class="model-identity"><div class="model-logo">${icon('server')}</div><div><strong>本机 Ollama</strong><small>免费、离线、数据不出电脑</small></div></div>${wizard.provider === 'ollama' ? '<span class="pill ok">已选择</span>' : '<button class="btn ghost small" data-action="wizard-provider" data-provider="ollama" type="button">选择</button>'}</div>
                    <div class="form-grid">
                        ${fieldHtml('Ollama 地址', 'wizard-ollama-host', wizard.ollamaHost, { span: true, placeholder: 'http://127.0.0.1:11434' })}
                        <div class="field span-2"><label>模型名称</label><input class="input" id="wizard-ollama-model" value="${esc(wizard.ollamaModel)}" list="wizard-ollama-list" placeholder="qwen3:1.7b"><datalist id="wizard-ollama-list">${(state.ollamaProbe?.models || []).map((model) => `<option value="${esc(model)}"></option>`).join('')}</datalist><small>第一次使用可先运行 <span class="kbd">ollama pull qwen3:1.7b</span></small></div>
                    </div>
                </section>
                <section class="model-card ${wizard.provider === 'openai' ? 'active' : ''}">
                    <div class="model-card-head"><div class="model-identity"><div class="model-logo cloud">${icon('cloud')}</div><div><strong>云端模型</strong><small>OpenAI / DeepSeek / Qwen 等兼容接口</small></div></div>${wizard.provider === 'openai' ? '<span class="pill ok">已选择</span>' : '<button class="btn ghost small" data-action="wizard-provider" data-provider="openai" type="button">选择</button>'}</div>
                    <div class="form-grid">
                        ${fieldHtml('Base URL', 'wizard-cloud-base', wizard.cloudBase, { span: true, placeholder: 'https://api.openai.com/v1' })}
                        ${fieldHtml('模型名称', 'wizard-cloud-model', wizard.cloudModel, { placeholder: 'gpt-4o-mini / deepseek-chat' })}
                        <div class="field"><label>模型类型</label><select class="select" id="wizard-cloud-profile">${['generic', 'qwen', 'deepseek', 'doubao'].map((item) => `<option value="${item}" ${wizard.cloudProfile === item ? 'selected' : ''}>${item}</option>`).join('')}</select></div>
                        <div class="field span-2"><label>API Key</label><input class="input" id="wizard-cloud-key" type="password" autocomplete="off" placeholder="${state.setup?.model?.openai_api_key_configured || state.config?.openai_api_key_configured ? '已配置，留空表示不修改' : '输入云端 API Key'}"><small>只保存在本机，不会上传。</small></div>
                    </div>
                </section>
            </div>
            <div class="form-actions">
                <button class="btn ghost small" data-action="wizard-probe-ollama" type="button">检测本机模型</button>
                <button class="btn ghost small" data-action="wizard-test-model" type="button">测试连接</button>
                ${state.modelTest ? `<span class="pill ${state.modelTest.ok ? 'ok' : 'bad'}">${state.modelTest.ok ? '连接正常' : '连接失败'}</span>` : ''}
            </div>`;

        const resumePanel = `
            <div class="dropzone" id="wizard-dropzone" role="button" tabindex="0">
                <div class="drop-icon">${icon('upload')}</div>
                <strong>拖拽 PDF 到这里，或点击选择文件</strong>
                <span>最大 8MB；扫描件可能无法提取文字，可手动填写</span>
                <input type="file" id="wizard-resume-file" accept="application/pdf,.pdf" class="sr-only">
            </div>
            <div class="field" style="margin-top:18px">
                <label>简历内容（可编辑）</label>
                <textarea class="textarea" id="wizard-resume" rows="12" placeholder="上传 PDF 后会自动提取，也可以直接粘贴简历文本">${esc(wizard.resumeMarkdown)}</textarea>
                <small>建议确认公司、项目、技能和联系方式等内容完整。</small>
            </div>`;

        const profilePanel = `
            <div class="inline" style="margin-bottom:14px">
                <button class="btn small" data-action="wizard-generate-profile" type="button">${icon('sparkles')}自动生成画像与标签</button>
                <span class="muted" style="font-size:12px">模型会读取简历，生成岗位搜索标签和用于评分的用户画像。</span>
            </div>
            ${wizard.profileWarnings.length ? `
            <div class="banner" style="margin-bottom:14px">
                <div class="check-icon">${icon('alert')}</div>
                <div class="banner-body">
                    <strong>请核对画像内容</strong>
                    <small>${esc(wizard.profileWarnings.join('；'))}</small>
                </div>
            </div>` : ''}
            <label class="review-check">
                <input type="checkbox" id="wizard-profile-confirmed" ${wizard.profileConfirmed ? 'checked' : ''}>
                <span>我已核对画像来自简历，未包含简历未提及的信息</span>
            </label>
            <div class="field">
                <label>岗位搜索标签</label>
                <div class="tag-list" id="wizard-tags">
                    ${wizard.tags.length ? wizard.tags.map((tag, index) => `<span class="tag">${esc(tag)}<button data-action="wizard-remove-tag" data-index="${index}" type="button" aria-label="删除 ${esc(tag)}">${icon('x')}</button></span>`).join('') : '<span class="faint">还没有标签</span>'}
                </div>
                <div class="inline" style="margin-top:10px">
                    <input class="input" id="wizard-tag-input" placeholder="输入标签，回车添加" style="max-width:280px">
                    <button class="btn ghost small" data-action="wizard-add-tag" type="button">${icon('plus')}添加</button>
                </div>
            </div>
            <div class="field" style="margin-top:14px">
                <label>用户详情（用于岗位匹配评分）</label>
                <textarea class="textarea" id="wizard-user-detail" rows="9" placeholder="学历、技能、项目经验、求职方向等">${esc(wizard.userDetail)}</textarea>
                <small>可以在这里直接修改模型生成的画像。</small>
            </div>`;

        const greetingPanel = `
            <div class="segmented" style="margin-bottom:16px">
                <button class="${wizard.greetingMode === 'boss_native' ? 'active' : ''}" data-action="wizard-mode" data-mode="boss_native" type="button">BOSS 原生（推荐）</button>
                <button class="${wizard.greetingMode === 'custom_only' ? 'active' : ''}" data-action="wizard-mode" data-mode="custom_only" type="button">自定义话术（高级）</button>
            </div>
            <div class="notice" style="margin-bottom:14px">${wizard.greetingMode === 'boss_native'
                ? '只点击 BOSS 原生的“立即沟通/打招呼”入口，由平台创建沟通，不发送自定义文本。'
                : '会打开聊天页并发送下面的自定义话术；可能产生额外文本消息。'}</div>
            ${wizard.greetingMode === 'custom_only' ? `
            <div class="field">
                <label>自定义招呼语</label>
                <textarea class="textarea" id="wizard-greeting" rows="5" placeholder="写一段简短、具体的打招呼内容">${esc(wizard.greetingText)}</textarea>
                <small>不要包含手机号、邮箱、微信等隐私信息。</small>
            </div>
            <div class="form-actions">
                <select class="select" id="wizard-greeting-style" style="max-width:170px">
                    ${['default', '简洁版', '热情版', '技术突出版', '业务匹配版'].map((item) => `<option value="${item}" ${wizard.greetingStyle === item ? 'selected' : ''}>${item === 'default' ? '默认风格' : item}</option>`).join('')}
                </select>
                <button class="btn ghost small" data-action="wizard-generate-greeting" type="button">${icon('sparkles')}生成草稿</button>
            </div>
            ${wizard.greetingVariants.length ? `<div class="variant-list" style="margin-top:14px">${wizard.greetingVariants.map((item, index) => `<div class="variant" data-action="wizard-pick-greeting" data-index="${index}" role="button" tabindex="0"><div><p>${esc(item.content || '')}</p><small>${esc(item.style || '')}</small></div>${wizard.greetingText === item.content ? '<span class="pill ok">已选</span>' : ''}</div>`).join('')}</div>` : ''}` : `
            <div class="notice">BOSS 原生模式不需要自定义话术，点击下一步即可。</div>`}`;

        const finishPanel = `
            <div class="checklist">
                ${setupChecklist().map((item) => `<div class="check-row ${item.done ? 'done' : 'todo'}"><div class="check-icon">${icon(item.done ? 'check' : 'alert')}</div><div class="check-body"><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></div></div>`).join('')}
            </div>
            <div class="banner ok" style="margin-top:18px">
                <div class="check-icon">${icon('shield')}</div>
                <div class="banner-body"><strong>最后一步：安装油猴脚本</strong><small>安装后刷新 BOSS 岗位页，左下角出现面板即表示连接成功。</small></div>
                <button class="btn small" data-action="open-userscript" type="button">安装脚本</button>
            </div>
            ${backup ? `<div class="notice">旧数据已备份到：<span class="mono">${esc(backup)}</span></div>` : ''}`;

        const panels = [modelCards, resumePanel, profilePanel, greetingPanel, finishPanel];
        return `
            <section class="card">
                ${stepHeader()}
                <div class="wizard-panel">
                    <h2 class="wizard-title">${['先选一个模型', '上传你的简历', '生成匹配画像', '设置打招呼方式', '完成配置'][step - 1]}</h2>
                    <p class="wizard-desc">${[
                        '两套配置都会保存，可随时切换。',
                        'PDF 只在本机解析，提取后可直接修改。',
                        '自动生成标签和画像，首次可能需要几十秒。',
                        'BOSS 已自动招呼时不再重复发送。',
                        '确认后即可打开 BOSS 岗位页开始运行。',
                    ][step - 1]}</p>
                    ${panels[step - 1]}
                </div>
                <div class="wizard-footer">
                    <span class="hint">${step < 5 ? `第 ${step} / 5 步` : '配置完成后可随时在设置页修改'}</span>
                    <div class="inline">
                        ${step > 1 ? '<button class="btn ghost" data-action="wizard-back" type="button">上一步</button>' : ''}
                        ${step < 5
                            ? '<button class="btn" data-action="wizard-next" type="button">保存并继续</button>'
                            : '<button class="btn ghost" data-action="wizard-finish" type="button">完成</button><button class="btn" data-action="wizard-start" type="button">完成并开始运行</button>'}
                    </div>
                </div>
            </section>`;
    }

    function readWizardFields() {
        const wizard = state.wizard;
        const read = (id) => {
            const el = document.getElementById(id);
            return el ? el.value : undefined;
        };
        if (wizard.step === 1) {
            const host = read('wizard-ollama-host');
            const ollamaModel = read('wizard-ollama-model');
            const cloudBase = read('wizard-cloud-base');
            const cloudModel = read('wizard-cloud-model');
            const cloudProfile = read('wizard-cloud-profile');
            const cloudKey = read('wizard-cloud-key');
            if (host !== undefined) wizard.ollamaHost = host.trim();
            if (ollamaModel !== undefined) wizard.ollamaModel = ollamaModel.trim();
            if (cloudBase !== undefined) wizard.cloudBase = cloudBase.trim();
            if (cloudModel !== undefined) wizard.cloudModel = cloudModel.trim();
            if (cloudProfile !== undefined) wizard.cloudProfile = cloudProfile;
            if (cloudKey !== undefined) wizard.cloudKey = cloudKey.trim();
        } else if (wizard.step === 2) {
            const resume = read('wizard-resume');
            if (resume !== undefined) wizard.resumeMarkdown = resume;
        } else if (wizard.step === 3) {
            const detail = read('wizard-user-detail');
            if (detail !== undefined) wizard.userDetail = detail;
        } else if (wizard.step === 4) {
            const greeting = read('wizard-greeting');
            const style = read('wizard-greeting-style');
            if (greeting !== undefined) wizard.greetingText = greeting;
            if (style !== undefined) wizard.greetingStyle = style;
        }
    }

    function wizardConfigPayload() {
        const wizard = state.wizard;
        const payload = {
            model_provider: wizard.provider,
            ollama_host: wizard.ollamaHost,
            ollama_model: wizard.ollamaModel,
            openai_api_base: wizard.cloudBase,
            cloud_model: wizard.cloudModel,
            external_model_profile: wizard.cloudProfile,
        };
        if (wizard.cloudKey) payload.openai_api_key = wizard.cloudKey;
        return payload;
    }

    async function saveWizardModel() {
        readWizardFields();
        await postJson('/config', { config: wizardConfigPayload() });
        await loadConfig();
        state.config = { ...state.config, ...wizardConfigPayload() };
        state.config.think_model = state.wizard.provider === 'ollama' ? state.wizard.ollamaModel : state.wizard.cloudModel;
        state.setup = state.setup || {};
        state.setup.greeting_mode = state.wizard.greetingMode;
    }

    async function saveWizardResume() {
        readWizardFields();
        const markdown = state.wizard.resumeMarkdown.trim();
        if (!markdown) throw new Error('请先上传 PDF 或填写简历内容');
        await putJson('/resume', { markdown });
        state.wizard.loadedResume = true;
        await loadSetup();
    }

    async function saveWizardProfile() {
        readWizardFields();
        const tags = state.wizard.tags.filter(Boolean);
        const userDetail = state.wizard.userDetail.trim();
        if (!tags.length) throw new Error('请至少保留一个岗位搜索标签');
        if (!userDetail) throw new Error('用户详情不能为空');
        const result = await putJson('/resume/profile', { tags, user_detail: userDetail });
        state.wizard.profileWarnings = Array.isArray(result.grounding_warnings) ? result.grounding_warnings : [];
        state.wizard.loadedProfile = true;
        await loadSetup();
    }

    async function saveWizardGreeting() {
        readWizardFields();
        const mode = state.wizard.greetingMode === 'custom_only' ? 'custom_only' : 'boss_native';
        await postJson('/config', { config: { greeting_mode: mode } });
        if (mode === 'custom_only') {
            const content = state.wizard.greetingText.trim();
            if (!content) throw new Error('请填写或生成一条自定义招呼语');
            await putJson('/greeting', { content, name: 'Web 向导' });
            await loadGreeting();
        }
        state.wizard.loadedGreeting = true;
        await loadSetup();
        await loadConfig();
    }

    async function finishWizard(startAfter = false) {
        readWizardFields();
        await postJson('/setup/complete', { completed: true });
        state.setup = state.setup || {};
        state.setup.onboarding_completed = true;
        manifestCompleted();
        await loadSetup();
        await refreshStatus(true);
        toast('配置已完成', 'ok');
        navigate('dashboard');
        if (startAfter) {
            setTimeout(() => startRun(), 250);
        }
    }

    function manifestCompleted() {
        if (state.config) state.config.onboarding_completed = true;
    }

    async function wizardNext() {
        readWizardFields();
        if (state.wizard.step === 1) {
            await saveWizardModel();
            state.wizard.step = 2;
        } else if (state.wizard.step === 2) {
            if (!state.wizard.resumeMarkdown.trim() && !state.setup?.resume_saved) {
                throw new Error('请先上传 PDF 或填写简历内容');
            }
            if (state.wizard.resumeMarkdown.trim()) await saveWizardResume();
            state.wizard.step = 3;
        } else if (state.wizard.step === 3) {
            if (!state.wizard.profileConfirmed) {
                throw new Error('请先勾选“我已核对画像”');
            }
            await saveWizardProfile();
            state.wizard.step = 4;
        } else if (state.wizard.step === 4) {
            await saveWizardGreeting();
            state.wizard.step = 5;
        }
        state.wizardStep = state.wizard.step;
        render();
    }

    async function startRun() {
        if (state.busy) return;
        state.busy = true;
        renderTopbar();
        try {
            if (state.setup && !state.setup.onboarding_completed) {
                toast('请先完成首次配置', 'warn');
                navigate('setup');
                return;
            }
            await postJson('/control', { command: 'start', platform: 'boss' });
            toast('BOSS 通道已开始运行', 'ok');
            await refreshStatus(true);
            await loadSetup();
            render();
        } catch (error) {
            toast(error.message, 'error', 7000);
            if (String(error.message).includes('模型')) navigate('models');
            if (String(error.message).includes('简历') || String(error.message).includes('画像') || String(error.message).includes('话术')) navigate('setup');
        } finally {
            state.busy = false;
            renderTopbar();
        }
    }

    async function pauseRun() {
        if (state.busy) return;
        state.busy = true;
        renderTopbar();
        try {
            await postJson('/control', { command: 'pause', platform: 'boss' });
            toast('已暂停 BOSS 通道', 'ok');
            await refreshStatus(true);
            render();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            state.busy = false;
            renderTopbar();
        }
    }

    async function stopRun() {
        if (state.busy) return;
        state.busy = true;
        renderTopbar();
        try {
            await postJson('/control', { command: 'stop', platform: 'boss' });
            toast('已停止 BOSS 通道', 'ok');
            await refreshStatus(true);
            render();
        } catch (error) {
            toast(error.message, 'error');
        } finally {
            state.busy = false;
            renderTopbar();
        }
    }

    async function switchModel(provider) {
        const models = modelInfo();
        if (provider === models.provider) return;
        if (provider === 'openai' && !models.keyConfigured) {
            toast('请先在模型页配置云端 API Key', 'warn');
            navigate('models');
            return;
        }
        state.busy = true;
        renderTopbar();
        try {
            await postJson('/model/select', { provider, pause_running: true });
            toast(`已切换到${provider === 'ollama' ? '本机 Ollama' : '云端模型'}`, 'ok');
            await refreshStatus(true);
            await loadSetup();
            render();
        } catch (error) {
            toast(error.message, 'error', 7000);
        } finally {
            state.busy = false;
            renderTopbar();
        }
    }

    function modelCardPayload(provider) {
        if (provider === 'ollama') {
            const host = document.getElementById('model-ollama-host')?.value.trim() || '';
            const model = document.getElementById('model-ollama-model')?.value.trim() || '';
            return { ollama_host: host, ollama_model: model };
        }
        const base = document.getElementById('model-cloud-base')?.value.trim() || '';
        const model = document.getElementById('model-cloud-model')?.value.trim() || '';
        const profile = document.getElementById('model-cloud-profile')?.value || 'generic';
        const key = document.getElementById('model-cloud-key')?.value.trim() || '';
        const payload = {
            openai_api_base: base,
            cloud_model: model,
            external_model_profile: profile,
        };
        if (key) payload.openai_api_key = key;
        return payload;
    }

    function wizardModelPayload() {
        const wizard = state.wizard;
        const payload = {
            ollama_host: wizard.ollamaHost,
            ollama_model: wizard.ollamaModel,
            openai_api_base: wizard.cloudBase,
            cloud_model: wizard.cloudModel,
            external_model_profile: wizard.cloudProfile,
        };
        if (wizard.cloudKey) payload.openai_api_key = wizard.cloudKey;
        return payload;
    }

    async function saveModelCard(provider) {
        const payload = modelCardPayload(provider);
        await postJson('/config', { config: payload });
        await loadConfig();
        await refreshStatus(true);
        toast('模型配置已保存', 'ok');
        render();
    }

    async function useModel(provider) {
        state.busy = true;
        renderTopbar();
        try {
            const payload = modelCardPayload(provider);
            await postJson('/config', { config: payload });
            await loadConfig();
            await postJson('/model/select', { provider, pause_running: true });
            toast('模型已切换', 'ok');
            await refreshStatus(true);
            await loadSetup();
            render();
        } catch (error) {
            toast(error.message, 'error', 7000);
        } finally {
            state.busy = false;
            renderTopbar();
        }
    }

    async function testModelWithPayload(provider, payload) {
        try {
            const config = { ...payload };
            const result = await postJson('/model/test', { provider, config });
            state.modelTest = { ok: Boolean(result.ok), warmup: result.warmup || {} };
            toast(result.ok ? '连接正常' : `连接失败：${result.warmup?.error || '未知错误'}`, result.ok ? 'ok' : 'error', 6000);
            render();
        } catch (error) {
            state.modelTest = { ok: false, warmup: { error: error.message } };
            toast(error.message, 'error', 6000);
            render();
        }
    }

    async function testModel(provider) {
        await testModelWithPayload(provider, modelCardPayload(provider));
    }

    async function probeOllama(host = '') {
        try {
            if (host) {
                await postJson('/config', { config: { ollama_host: host } });
                await loadConfig();
            }
            state.ollamaProbe = await api('/model/ollama/models');
            toast(state.ollamaProbe.available ? `检测到 ${state.ollamaProbe.models.length} 个本地模型` : `无法连接 Ollama：${state.ollamaProbe.error || ''}`, state.ollamaProbe.available ? 'ok' : 'error', 5000);
            render();
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    async function saveGreeting() {
        readWizardFields();
        const content = document.getElementById('greeting-text')?.value.trim() || '';
        if (!content) {
            toast('请填写招呼语', 'warn');
            return;
        }
        try {
            await putJson('/greeting', { content, name: 'Web 设置' });
            const mode = state.wizard?.greetingMode || modelInfo().greetingMode || 'boss_native';
            await postJson('/config', { config: { greeting_mode: mode } });
            await loadGreeting();
            await loadSetup();
            await loadConfig();
            toast('招呼语已保存', 'ok');
            render();
        } catch (error) {
            toast(error.message, 'error', 6000);
        }
    }

    async function generateGreeting(target = 'settings') {
        const style = document.getElementById(target === 'wizard' ? 'wizard-greeting-style' : 'greeting-style')?.value || 'default';
        try {
            const result = await postJson('/greeting/generate', { style });
            if (target === 'wizard') {
                readWizardFields();
                state.wizard.greetingText = result.content || '';
                toast('已生成招呼语草稿', 'ok');
                render();
            } else {
                const textarea = document.getElementById('greeting-text');
                if (textarea) textarea.value = result.content || '';
                toast('已生成招呼语草稿', 'ok');
            }
        } catch (error) {
            toast(error.message, 'error', 6000);
        }
    }

    async function generateProfile() {
        readWizardFields();
        try {
            toast('正在生成画像，首次可能需要几十秒…', 'info', 12000);
            const generated = await postJson('/resume/profile/generate');
            state.wizard.tags = Array.isArray(generated.tags) ? generated.tags.slice() : [];
            state.wizard.userDetail = generated.user_detail || '';
            state.wizard.profileWarnings = Array.isArray(generated.grounding_warnings) ? generated.grounding_warnings : [];
            state.wizard.profileConfirmed = false;
            state.wizard.loadedProfile = true;
            await loadSetup();
            toast('画像与标签已生成', 'ok');
            render();
        } catch (error) {
            toast(error.message, 'error', 7000);
        }
    }

    async function generateWizardGreeting() {
        readWizardFields();
        const style = document.getElementById('wizard-greeting-style')?.value || 'default';
        try {
            const result = await postJson('/greeting/generate', { style });
            state.wizard.greetingText = result.content || '';
            state.wizard.greetingStyle = style;
            state.wizard.greetingVariants = [{ style, content: result.content || '' }];
            toast('已生成招呼语草稿', 'ok');
            render();
        } catch (error) {
            toast(error.message, 'error', 6000);
        }
    }

    function addWizardTag() {
        readWizardFields();
        const input = document.getElementById('wizard-tag-input');
        const raw = input?.value || '';
        const tags = raw.replace(/，/g, ',').split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
        tags.forEach((tag) => {
            if (!state.wizard.tags.includes(tag)) state.wizard.tags.push(tag);
        });
        if (input) input.value = '';
        render();
    }

    function removeWizardTag(index) {
        readWizardFields();
        state.wizard.tags.splice(index, 1);
        render();
    }

    async function uploadResume(file) {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            toast('请选择 PDF 文件', 'warn');
            return;
        }
        const form = new FormData();
        form.append('file', file);
        try {
            toast('正在解析 PDF…', 'info', 10000);
            const result = await api('/resume/upload-pdf', { method: 'POST', body: form });
            state.wizard.resumeMarkdown = result.markdown || '';
            state.wizard.loadedResume = true;
            await loadSetup();
            toast('简历已提取，请确认内容', 'ok');
            render();
        } catch (error) {
            toast(error.message, 'error', 6000);
        }
    }

    async function saveSettings() {
        const numericKeys = [
            'score_threshold', 'search_round_cooldown_min_minutes', 'search_round_cooldown_minutes',
            'tag_search_delay_seconds', 'tag_search_delay_max_seconds', 'max_search_submissions_per_hour',
            'max_search_submissions_per_day', 'search_result_scroll_rounds', 'preferred_feed_max_jobs_per_tab',
            'job_detail_max_chars', 'job_score_num_predict_think_off', 'job_score_num_predict_think_on',
        ];
        const config = {};
        for (const key of numericKeys) {
            const el = document.getElementById(`setting-${key}`);
            if (el && el.value !== '') config[key] = num(el.value, 0);
        }
        for (const key of ['model_temperature', 'model_top_p']) {
            const el = document.getElementById(`setting-${key}`);
            if (el && el.value !== '') config[key] = Number(el.value);
        }
        config.disable_model_thinking = Boolean(state.config?.disable_model_thinking);
        config.show_model_reasoning = Boolean(state.config?.show_model_reasoning);
        try {
            await postJson('/config', { config });
            await loadConfig();
            await loadSetup();
            toast('设置已保存', 'ok');
            render();
        } catch (error) {
            toast(error.message, 'error', 6000);
        }
    }

    function toggleSetting(key) {
        if (!state.config) return;
        state.config[key] = !Boolean(state.config[key]);
        render();
    }

    async function backupData() {
        try {
            const result = await postJson('/setup/backup');
            toast(`备份已生成：${result.path}`, 'ok', 7000);
        } catch (error) {
            toast(error.message, 'error', 6000);
        }
    }

    async function resetOnboarding() {
        openModal('重新运行配置向导？', '<p>会重新进入极简向导。建议先备份当前配置、简历和缓存；岗位历史数据库不会被删除。</p>', [
            { label: '先备份', action: 'backup' },
            { label: '重新配置', action: 'reset-onboarding-confirm', kind: 'danger' },
        ]);
    }

    async function confirmResetOnboarding() {
        try {
            closeModal();
            await postJson('/setup/complete', { completed: false });
            state.wizardHydrated = false;
            state.wizardDataLoaded = false;
            state.wizardStep = 1;
            await loadSetup();
            await loadConfig();
            state.route = 'setup';
            location.hash = '#/setup';
            render();
            toast('已进入重新配置向导', 'ok');
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    async function handleAction(action, target) {
        switch (action) {
            case 'navigate':
                navigate(target.dataset.route || 'dashboard');
                break;
            case 'switch-model':
                await switchModel(target.dataset.provider);
                break;
            case 'start':
                await startRun();
                break;
            case 'pause':
                await pauseRun();
                break;
            case 'stop':
                await stopRun();
                break;
            case 'open-boss':
                window.open(BOSS_URL, '_blank', 'noopener');
                break;
            case 'open-userscript':
                window.open(USERSCRIPT_URL, '_blank', 'noopener');
                break;
            case 'probe-ollama':
                await probeOllama(document.getElementById('model-ollama-host')?.value.trim() || '');
                break;
            case 'model-test':
                await testModel(target.dataset.provider);
                break;
            case 'model-save':
                await saveModelCard(target.dataset.provider);
                break;
            case 'model-use':
                await useModel(target.dataset.provider);
                break;
            case 'save-greeting':
                await saveGreeting();
                break;
            case 'generate-greeting':
                await generateGreeting('settings');
                break;
            case 'pick-greeting': {
                const index = num(target.dataset.index);
                const item = (state.greeting?.variants || [])[index];
                if (item) {
                    const textarea = document.getElementById('greeting-text');
                    if (textarea) textarea.value = item.content || '';
                    toast('已填入编辑器，记得保存', 'ok');
                }
                break;
            }
            case 'set-greeting-mode':
                hydrateWizard();
                state.wizard.greetingMode = target.dataset.mode === 'custom_only' ? 'custom_only' : 'boss_native';
                await postJson('/config', { config: { greeting_mode: state.wizard.greetingMode } });
                await loadConfig();
                await loadSetup();
                state.setup = state.setup || {};
                state.setup.greeting_mode = state.wizard.greetingMode;
                toast('打招呼方式已更新', 'ok');
                render();
                break;
            case 'wizard-provider':
                readWizardFields();
                state.wizard.provider = target.dataset.provider || 'ollama';
                render();
                break;
            case 'wizard-probe-ollama':
                readWizardFields();
                await probeOllama(state.wizard.ollamaHost);
                break;
            case 'wizard-test-model':
                readWizardFields();
                await testModelWithPayload(state.wizard.provider, wizardModelPayload());
                break;
            case 'wizard-next':
                await wizardNext();
                break;
            case 'wizard-back':
                readWizardFields();
                state.wizard.step = Math.max(1, state.wizard.step - 1);
                state.wizardStep = state.wizard.step;
                render();
                break;
            case 'wizard-generate-profile':
                await generateProfile();
                break;
            case 'wizard-add-tag':
                addWizardTag();
                break;
            case 'wizard-remove-tag':
                removeWizardTag(num(target.dataset.index));
                break;
            case 'wizard-generate-greeting':
                await generateWizardGreeting();
                break;
            case 'wizard-mode':
                readWizardFields();
                state.wizard.greetingMode = target.dataset.mode === 'custom_only' ? 'custom_only' : 'boss_native';
                render();
                break;
            case 'wizard-pick-greeting': {
                readWizardFields();
                const item = state.wizard.greetingVariants[num(target.dataset.index)];
                if (item) {
                    state.wizard.greetingText = item.content || '';
                    render();
                }
                break;
            }
            case 'wizard-finish':
                await finishWizard(false);
                break;
            case 'wizard-start':
                await finishWizard(true);
                break;
            case 'save-settings':
                await saveSettings();
                break;
            case 'toggle-setting':
                toggleSetting(target.dataset.setting);
                break;
            case 'backup':
                closeModal();
                await backupData();
                break;
            case 'reset-onboarding':
                await resetOnboarding();
                break;
            case 'reset-onboarding-confirm':
                await confirmResetOnboarding();
                break;
            case 'close-modal':
                closeModal();
                break;
            case 'log-filter':
                state.logFilter = target.dataset.level || 'all';
                render();
                break;
            case 'refresh-history':
                state.history = null;
                await loadHistory();
                render();
                break;
            default:
                break;
        }
    }

    function bindGlobalEvents() {
        document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
        document.addEventListener('click', async (event) => {
            const dropzone = event.target.closest('#wizard-dropzone');
            if (dropzone && event.target.id !== 'wizard-resume-file') {
                event.preventDefault();
                document.getElementById('wizard-resume-file')?.click();
                return;
            }
            const actionEl = event.target.closest('[data-action]');
            if (!actionEl) return;
            if (actionEl.dataset.action === 'wizard-provider' && event.target.closest('input,select,textarea,label,button')) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            try {
                await handleAction(actionEl.dataset.action, actionEl);
            } catch (error) {
                toast(error.message, 'error', 6000);
            }
        });
        document.addEventListener('change', async (event) => {
            if (event.target.id === 'wizard-resume-file') {
                await uploadResume(event.target.files?.[0]);
            }
            if (event.target.id === 'wizard-profile-confirmed') {
                hydrateWizard();
                state.wizard.profileConfirmed = Boolean(event.target.checked);
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.target.id === 'wizard-tag-input' && event.key === 'Enter') {
                event.preventDefault();
                addWizardTag();
            }
            if (event.key === 'Escape') closeModal();
        });
        document.getElementById('refresh-btn')?.addEventListener('click', async () => {
            await refreshStatus();
            await loadSetup();
            await loadConfig();
            if (state.route === 'logs') await loadLogs();
            toast('状态已刷新', 'ok', 1600);
        });
        document.getElementById('open-boss-top')?.addEventListener('click', () => {
            window.open(BOSS_URL, '_blank', 'noopener');
        });
        document.getElementById('menu-toggle')?.addEventListener('click', () => {
            document.getElementById('sidebar')?.classList.toggle('open');
        });
        document.getElementById('main-nav')?.addEventListener('click', () => {
            document.getElementById('sidebar')?.classList.remove('open');
        });
        window.addEventListener('hashchange', () => {
            state.route = routeFromHash();
            render();
        });
        document.addEventListener('dragover', (event) => {
            const dropzone = event.target.closest('#wizard-dropzone');
            if (!dropzone) return;
            event.preventDefault();
            dropzone.classList.add('dragover');
        });
        document.addEventListener('dragleave', (event) => {
            const dropzone = event.target.closest('#wizard-dropzone');
            if (dropzone) dropzone.classList.remove('dragover');
        });
        document.addEventListener('drop', async (event) => {
            const dropzone = event.target.closest('#wizard-dropzone');
            if (!dropzone) return;
            event.preventDefault();
            dropzone.classList.remove('dragover');
            const file = event.dataTransfer?.files?.[0];
            if (file) await uploadResume(file);
        });
        document.getElementById('wizard-dropzone')?.addEventListener('click', () => {
            document.getElementById('wizard-resume-file')?.click();
        });
    }

    async function boot() {
        bindGlobalEvents();
        await Promise.all([refreshStatus(true), loadSetup(), loadConfig()]);
        hydrateWizard();
        state.route = routeFromHash();
        if (state.setup && !state.setup.onboarding_completed) {
            state.route = 'setup';
            if (routeFromHash() !== 'setup') location.hash = '#/setup';
        }
        render();
        startPolling();
        loadLogs();
    }

    document.addEventListener('DOMContentLoaded', boot);
})();
