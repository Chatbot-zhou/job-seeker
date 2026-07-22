// ==UserScript==
// @name         Job Seeker
// @namespace    http://tampermonkey.net/
// @version      2026.06.26.31
// @description  Job Seeker 篡改猴插件
// @author       Chatbot-Zhou
// @match        https://www.zhipin.com/*
// @match        https://www.zhaopin.com/*
// @match        https://passport.zhaopin.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=zhipin.com
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_openInTab
// @connect      127.0.0.1
// @connect      localhost
// @updateURL    http://127.0.0.1:33333/web_script.user.js
// @downloadURL  http://127.0.0.1:33333/web_script.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';
    // OriginalAuthor: 嘎嘎脆的贝爷

    // 配置项
    const OPTIONS = {
        scriptVersion: '2026.06.26.31',
        greetMaxAttempts: 3,
        greetRetryDelays: [0, 3000, 8000],
        resumeIndex: 0, // 第几份简历，从 0 开始递增
        serverHost: 'http://127.0.0.1:33333', // 本地服务的主机地址
        thread: 60, // 分数阈值，低于这个就不发消息
        timestampTimeout: 120000, // 页面跳转来源标记有效期，单位毫秒
        jobInfoResponseTimeout: 90000, // 详情页回传职位信息的最长等待时间
        onlyGreet: true, // 仅辅助打招呼，不自动扫描普通聊天页
        searchRoundCooldownMinMinutes: 1,
        searchRoundCooldownMinutes: 5,
        tagSearchDelaySeconds: 20,
        tagSearchDelayMaxSeconds: 45,
        maxSearchSubmissionsPerHour: 6,
        maxSearchSubmissionsPerDay: 30,
        searchResultScrollRounds: 20,
        preferredFeedMode: 'all_custom_tabs',
        preferredFeedMaxJobsPerTab: 0,
        actionDelayMs: 2500,
        searchLeaseMs: 12000,
        openCooldownMs: 45000,
        recentProcessedHours: 24,
        bossEnabled: true,
        zhaopinEnabled: true,
        zhaopinJobUrls: ['https://www.zhaopin.com/recommend'],
        zhaopinResumeName: '',
        zhaopinApplyDelayMinSeconds: 3,
        zhaopinApplyDelayMaxSeconds: 10,
        zhaopinMaxApplicationsPerRun: 0,
        zhaopinMaxApplicationsPerDay: 0,
    };

    let backendOfflineNotified = false;
    let backendOfflineFailures = 0;
    const BACKEND_OFFLINE_NOTIFY_THRESHOLD = 2;
    const PAGE_INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    function applyBackendConfig(config) {
        if (!config) return;
        if (Number.isFinite(Number(config.score_threshold))) {
            OPTIONS.thread = Number(config.score_threshold);
        }
        if (Number.isFinite(Number(config.search_round_cooldown_minutes))) {
            OPTIONS.searchRoundCooldownMinutes = Math.max(1, Math.min(240, Number(config.search_round_cooldown_minutes)));
        }
        if (Number.isFinite(Number(config.search_round_cooldown_min_minutes))) {
            OPTIONS.searchRoundCooldownMinMinutes = Math.max(1, Math.min(OPTIONS.searchRoundCooldownMinutes, Number(config.search_round_cooldown_min_minutes)));
        } else {
            OPTIONS.searchRoundCooldownMinMinutes = Math.min(OPTIONS.searchRoundCooldownMinMinutes, OPTIONS.searchRoundCooldownMinutes);
        }
        if (Number.isFinite(Number(config.tag_search_delay_seconds))) {
            OPTIONS.tagSearchDelaySeconds = Math.max(3, Math.min(60, Number(config.tag_search_delay_seconds)));
        }
        if (Number.isFinite(Number(config.tag_search_delay_max_seconds))) {
            OPTIONS.tagSearchDelayMaxSeconds = Math.max(
                OPTIONS.tagSearchDelaySeconds,
                Math.min(60, Number(config.tag_search_delay_max_seconds)),
            );
        }
        if (Number.isFinite(Number(config.max_search_submissions_per_hour))) {
            OPTIONS.maxSearchSubmissionsPerHour = Math.max(1, Math.min(60, Number(config.max_search_submissions_per_hour)));
        }
        if (Number.isFinite(Number(config.max_search_submissions_per_day))) {
            OPTIONS.maxSearchSubmissionsPerDay = Math.max(1, Math.min(300, Number(config.max_search_submissions_per_day)));
        }
        if (Number.isFinite(Number(config.search_result_scroll_rounds))) {
            OPTIONS.searchResultScrollRounds = Math.max(0, Math.min(20, Number(config.search_result_scroll_rounds)));
        }
        if (config.preferred_feed_mode === 'off' || config.preferred_feed_mode === 'all_custom_tabs') {
            OPTIONS.preferredFeedMode = config.preferred_feed_mode;
        }
        if (Number.isFinite(Number(config.preferred_feed_max_jobs_per_tab))) {
            OPTIONS.preferredFeedMaxJobsPerTab = Math.max(0, Math.min(500, Number(config.preferred_feed_max_jobs_per_tab)));
        }
        OPTIONS.bossEnabled = config.boss_enabled !== false;
        OPTIONS.zhaopinEnabled = config.zhaopin_enabled !== false;
        if (Array.isArray(config.zhaopin_job_urls) && config.zhaopin_job_urls.length) {
            OPTIONS.zhaopinJobUrls = config.zhaopin_job_urls.map(String).filter(Boolean);
        }
        OPTIONS.zhaopinResumeName = String(config.zhaopin_resume_name || '');
        if (Number.isFinite(Number(config.zhaopin_apply_delay_min_seconds))) {
            OPTIONS.zhaopinApplyDelayMinSeconds = Math.max(3, Math.min(60, Number(config.zhaopin_apply_delay_min_seconds)));
        }
        if (Number.isFinite(Number(config.zhaopin_apply_delay_max_seconds))) {
            OPTIONS.zhaopinApplyDelayMaxSeconds = Math.max(
                OPTIONS.zhaopinApplyDelayMinSeconds,
                Math.min(60, Number(config.zhaopin_apply_delay_max_seconds)),
            );
        }
        OPTIONS.zhaopinMaxApplicationsPerRun = Math.max(0, Number(config.zhaopin_max_applications_per_run || 0));
        OPTIONS.zhaopinMaxApplicationsPerDay = Math.max(0, Number(config.zhaopin_max_applications_per_day || 0));
    }

    // 元素选择器
    const SELECTORS = {
        ZHIPIN: {
            SEARCH: {
                SEARCHINPUT: 'input', // 搜索框
                SEARCHBTN: '.search-btn', // 搜索按钮
                JOBLISTCTN: '.job-list-container', // 职位列表容器
                JOBLIST: '.rec-job-list', // 职位列表
                JOBHREFS: '.job-card-box .job-name', // 职位链接
                JOBLIST_CANDIDATES: [
                    '.rec-job-list',
                    '.job-list-box',
                    '.job-list-container',
                    '.search-job-result',
                    '.recommend-job-list',
                    '.job-recommend-list',
                    '.job-card-list',
                    '[class*="job-list"]',
                    '[class*="recommend-list"]',
                ],
                JOB_SCROLL_CANDIDATES: [
                    '.job-list-container',
                    '.job-list-box',
                    '.search-job-result',
                    '.rec-job-list',
                    '.recommend-job-list',
                    '.job-recommend-list',
                    '.job-card-list',
                    '[class*="job-list"]',
                    '[class*="recommend-list"]',
                    '[class*="job-recommend"]',
                ],
                JOBHREFS_CANDIDATES: [
                    '.job-card-box .job-name',
                    '.job-card-wrapper .job-title a',
                    '[class*="job-card"] a[href*="/job_detail/"]',
                    '[class*="job-list"] a[href*="/job_detail/"]',
                    '[class*="recommend"] a[href*="/job_detail/"]',
                    'a[href*="/job_detail/"]',
                ],
            },
            DETAIL: {
                STARTCHAT: [
                    '.btn-startchat',
                    '.btn-chat',
                    '[ka*="start_chat"]',
                    '[ka*="geek_chat"]',
                    'a[href*="/web/geek/chat"]',
                    'a[href*="/geek/chat"]',
                    'button[class*="startchat"]',
                    'button[class*="chat"]',
                ], // 开始聊天按钮
                NAMEBOX: '.name', // 职位名称盒子
                JOBNAME: 'h1', // 职位名称
                SALARY: '.salary', // 职位薪资
                DETAIL: '.job-sec-text', // 职位详情
                CHATURL: 'redirect-url', // 聊天链接
                JOBNAME_CANDIDATES: ['.job-banner .name h1', '.job-primary .name h1', '.info-primary .name h1', '.name h1', 'h1'],
                SALARY_CANDIDATES: ['.job-banner .salary', '.job-primary .salary', '.info-primary .salary', '.name .salary', '.salary'],
                DETAIL_CANDIDATES: ['.job-sec-text', '.job-detail-section .text', '.job-description', '[class*="job-sec-text"]'],
                COMPANY_CANDIDATES: ['.company-info .name', '.company-name', '.job-detail-company .name', '.sider-company .name', '.company-card .name', '.job-company-info .name'],
                CITY_CANDIDATES: ['.job-location', '.location-address', '.job-address', '.job-area', '.city'],
            },
            CHAT: {
                // 聊天
                CHATINPUT: [
                    '#chat-input',
                    '.chat-input [contenteditable="true"]',
                    '.input-area [contenteditable="true"]',
                    '.message-input [contenteditable="true"]',
                    '.chat-editor [contenteditable="true"]',
                    '.boss-chat-editor [contenteditable="true"]',
                    '[class*="editor"] [contenteditable="true"]',
                    '[class*="input"] [contenteditable="true"]',
                    '[contenteditable="true"][data-placeholder]',
                    '[role="textbox"][contenteditable="true"]',
                    '.ProseMirror[contenteditable="true"]',
                    '[data-slate-editor="true"]',
                    '[contenteditable="plaintext-only"]',
                    'textarea[id*="chat"]',
                    'textarea[class*="chat"]',
                    'textarea[placeholder*="消息"]',
                    'textarea[placeholder*="沟通"]',
                    '[contenteditable="true"]',
                ], // 聊天输入框
                MSGSEND: [
                    '.btn-send',
                    '.send-btn',
                    '.btn-send-message',
                    '.send-message',
                    '[class*="btn-send"]',
                    '[class*="send-btn"]',
                    '[class*="send-message"]',
                    '[ka*="send"]',
                    '[ka*="chat_send"]',
                    '[ka*="send_message"]',
                    'button[class*="send"]:not(.disabled)',
                ], // 消息发送按钮
                // 聊天记录
                HISTORYCTN: '.chat-message', // 聊天记录容器
                USEFULMSG: '.item-friend,.item-myself', // 有效的文字聊天记录项
                MSGCONTENT: '.message-content .text', // 聊天记录内容
                // 职位
                JOBEL: '*[ka=geek_chat_job_detail]', // 职位元素
                JOBCITY: '.city', // 职位城市
            }
        },
    };

    // 搜索路径
    const SEARCHPATH = {
        zhipin: '/web/geek/job',
        preferred: '/web/geek/jobs',
    };

    // 白名单
    const WHITELIST = {
        zhipin: {
            detail: ['/job_detail', '/web/geek/job_detail'],
            chat: ['/web/geek/chat']
        },
    };

    // 工具函数
    const tools = {
        inWhiteList: function (pathObj) {
            return Object.values(pathObj).some((path) => {
                const list = Array.isArray(path) ? path : [path];
                return list.some(item => location.pathname.startsWith(item) || location.pathname.includes(item));
            });
        },
        pathMatches(pathObj) {
            const list = Array.isArray(pathObj) ? pathObj : [pathObj];
            return list.some(item => location.pathname.startsWith(item) || location.pathname.includes(item));
        },
        isSearchPath(path = location.pathname) {
            return this.isKeywordSearchPath(path) || this.isPreferredFeedPath(path);
        },
        isKeywordSearchPath(path = location.pathname) {
            return path.startsWith(SEARCHPATH.zhipin) && !this.isPreferredFeedPath(path);
        },
        isPreferredFeedPath(path = location.pathname) {
            return path.startsWith(SEARCHPATH.preferred);
        },
        isCityHomePath(path = location.pathname) {
            return /^\/[a-z][a-z0-9-]*\/?$/.test(path);
        },
        findOne(selectors, root = document) {
            const list = Array.isArray(selectors) ? selectors : [selectors];
            for (const selector of list) {
                try {
                    const el = root.querySelector(selector);
                    if (el) return el;
                } catch (e) {
                    // Ignore stale or unsupported selectors and continue fallback list.
                }
            }
            return null;
        },
        textOf(selectors, root = document) {
            const el = this.findOne(selectors, root);
            return el ? el.innerText.trim() : '';
        },
        endlessFind: function (selector, timeout = 10000) {
            return new Promise((resolve, reject) => {
                // 初始立即检查元素是否存在
                let element;
                try {
                    element = this.findOne(selector);
                } catch (e) {
                    reject(e); // 处理无效选择器
                    return;
                }
                if (element) {
                    resolve(element);
                    return;
                }

                // 设置超时
                const timeoutId = setTimeout(() => {
                    observer.disconnect();
                    const platformLimit = this.detectPlatformLimit();
                    if (platformLimit) {
                        reject(new Error(`平台次数限制: ${platformLimit}`));
                        return;
                    }
                    const interruption = this.detectManualInterruption();
                    if (interruption) {
                        reject(new Error(`需要人工处理: ${interruption}`));
                        return;
                    }
                    reject(new Error(`未找到目标元素: ${Array.isArray(selector) ? selector.join(', ') : selector}`));
                }, timeout);

                // 定义 MutationObserver 回调
                const observer = new MutationObserver((_, obs) => {
                    try {
                        const el = this.findOne(selector);
                        if (el) {
                            obs.disconnect();
                            clearTimeout(timeoutId);
                            resolve(el);
                        }
                    } catch (e) {
                        obs.disconnect();
                        clearTimeout(timeoutId);
                        reject(e);
                    }
                });

                // 开始观察整个文档的 DOM 变化
                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true
                });
            });
        },
        waitForOne(selectors, timeout = 10000) {
            const list = Array.isArray(selectors) ? selectors : [selectors];
            return new Promise((resolve, reject) => {
                const existing = this.findOne(list);
                if (existing) {
                    resolve(existing);
                    return;
                }
                const startedAt = Date.now();
                const observer = new MutationObserver((_, obs) => {
                    const el = this.findOne(list);
                    if (el) {
                        obs.disconnect();
                        clearTimeout(timeoutId);
                        resolve(el);
                    }
                });
                const timeoutId = setTimeout(() => {
                    observer.disconnect();
                    const platformLimit = this.detectPlatformLimit();
                    if (platformLimit) {
                        reject(new Error(`平台次数限制: ${platformLimit}`));
                        return;
                    }
                    const interruption = this.detectManualInterruption();
                    if (interruption) {
                        reject(new Error(`需要人工处理: ${interruption}`));
                        return;
                    }
                    reject(new Error(`未找到目标元素: ${list.join(', ')}, 等待 ${Date.now() - startedAt}ms`));
                }, timeout);
                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true,
                });
            });
        },
        inputText: function (el, text) {
            el.value = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        },
        inputEditableText: function (el, text) {
            const doc = el?.ownerDocument || document;
            const view = doc.defaultView || window;
            const makeInputEvent = () => {
                try {
                    return new view.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text });
                } catch (e) {
                    return new view.Event('input', { bubbles: true });
                }
            };
            if ('value' in el) {
                el.focus();
                el.value = text;
                el.dispatchEvent(makeInputEvent());
                el.dispatchEvent(new view.Event('change', { bubbles: true }));
                return String(el.value || '').trim();
            }
            el.focus();
            const selection = view.getSelection();
            const range = doc.createRange();
            range.selectNodeContents(el);
            selection.removeAllRanges();
            selection.addRange(range);
            if (typeof doc.execCommand === 'function') doc.execCommand('delete', false);
            const inserted = typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, text);
            if (!inserted || !el.innerText.includes(text)) {
                el.innerText = text;
                el.textContent = text;
            }
            el.dispatchEvent(new view.KeyboardEvent('keydown', { bubbles: true, key: 'Process' }));
            el.dispatchEvent(makeInputEvent());
            el.dispatchEvent(new view.KeyboardEvent('keyup', { bubbles: true, key: 'Process' }));
            el.dispatchEvent(new view.Event('change', { bubbles: true }));
            selection.removeAllRanges();
            return el.innerText.trim() || el.textContent.trim() || '';
        },
        elementBrief(el) {
            if (!el) return {};
            return {
                tag: el.tagName || '',
                id: el.id || '',
                className: String(el.className || ''),
                text: String(el.innerText || el.textContent || '').trim().slice(0, 80),
                role: el.getAttribute ? (el.getAttribute('role') || '') : '',
                ka: el.getAttribute ? (el.getAttribute('ka') || '') : '',
            };
        },
        isVisible(el) {
            if (!el) return false;
            try {
                const view = el.ownerDocument?.defaultView || window;
                const style = view.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            } catch (e) {
                return false;
            }
        },
        isDisabled(el) {
            if (!el) return true;
            const disabledAttr = el.disabled
                || el.getAttribute('disabled') !== null
                || el.getAttribute('aria-disabled') === 'true';
            const classText = String(el.className || '').toLowerCase();
            const parentClassText = String(el.parentElement?.className || '').toLowerCase();
            return Boolean(disabledAttr)
                || classText.includes('disabled')
                || classText.includes('forbid')
                || parentClassText.includes('disabled')
                || parentClassText.includes('forbid');
        },
        clickableAncestor(el, boundary = null) {
            if (!el) return null;
            const selector = [
                'button',
                'a',
                '[role="button"]',
                '.btn',
                '[class*="btn"]',
                '[class*="button"]',
                '[class*="confirm"]',
                '[class*="ok"]',
            ].join(',');
            const closest = el.closest?.(selector);
            if (closest && (!boundary || boundary === closest || boundary.contains(closest))) {
                return closest;
            }
            return el;
        },
        clickLikeUser(el) {
            const target = this.clickableAncestor(el) || el;
            if (!target) return null;
            try {
                target.scrollIntoView({ block: 'center', inline: 'center' });
            } catch (e) {}
            try {
                target.focus?.({ preventScroll: true });
            } catch (e) {
                try { target.focus?.(); } catch (ignore) {}
            }
            const rect = target.getBoundingClientRect();
            const view = target.ownerDocument?.defaultView || window;
            const eventInit = {
                bubbles: true,
                cancelable: true,
                view,
                button: 0,
                clientX: Math.round(rect.left + Math.max(1, rect.width / 2)),
                clientY: Math.round(rect.top + Math.max(1, rect.height / 2)),
            };
            for (const type of ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']) {
                try {
                    target.dispatchEvent(new view.MouseEvent(type, eventInit));
                } catch (e) {}
            }
            try {
                target.click();
            } catch (e) {}
            return target;
        },
        asyncSleep(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        },
        actionSleep(baseMs = OPTIONS.actionDelayMs) {
            const jitter = Math.floor(Math.random() * 1200);
            return this.asyncSleep(baseMs + jitter);
        },
        readJson(key, fallback = {}) {
            try {
                return JSON.parse(localStorage.getItem(key) || '') || fallback;
            } catch (e) {
                return fallback;
            }
        },
        writeJson(key, value) {
            localStorage.setItem(key, JSON.stringify(value));
        },
        getTimestamp(key) {
            return Number(localStorage.getItem(key));
        },
        openCooldownKey(key, href) {
            const identity = String(href || '').includes('/job_detail/')
                ? this.jobIdentityUrl(href)
                : this.normalUrl(href);
            return `__job_seeker_open_cooldown:${key}:${identity || href}`;
        },
        canOpenUrl(href, key, cooldownMs = OPTIONS.openCooldownMs) {
            const cooldownKey = this.openCooldownKey(key, href);
            const previous = Number(localStorage.getItem(cooldownKey) || 0);
            return !previous || Date.now() - previous > cooldownMs;
        },
        markOpenUrl(href, key) {
            localStorage.setItem(this.openCooldownKey(key, href), String(Date.now()));
        },
        closeTabHandle(handle) {
            try {
                if (handle && typeof handle.close === 'function') {
                    handle.close();
                    return true;
                }
            } catch (e) {
                return false;
            }
            return false;
        },
        openTabNSetTimestamp(href, key, self = false, options = {}) {
            localStorage.setItem(key, new Date().getTime());

            if (self) {
                location.href = href;
                return true;
            }
            if (!options.force && !this.canOpenUrl(href, key, options.cooldownMs || OPTIONS.openCooldownMs)) {
                return null;
            }
            this.markOpenUrl(href, key);

            if (typeof GM_openInTab === 'function') {
                return GM_openInTab(href, {
                    active: false,
                    insert: true,
                    setParent: true,
                });
            }

            return window.open(href, key);
        },
        absoluteUrl(href) {
            if (!href) return '';
            try {
                const origin = typeof location !== 'undefined' && location.origin
                    ? location.origin
                    : 'https://www.zhipin.com';
                return new URL(href, origin).href;
            } catch (e) {
                return href;
            }
        },
        normalUrl(href) {
            const absolute = this.absoluteUrl(href);
            if (!absolute) return '';
            const currentHref = typeof location !== 'undefined' ? location.href : '';
            if (absolute.startsWith('javascript:') || (currentHref && absolute === currentHref) || absolute.endsWith('#')) {
                return '';
            }
            return absolute;
        },
        jobIdentityUrl(href) {
            const absolute = this.normalUrl(href);
            if (!absolute) return '';
            try {
                const origin = typeof location !== 'undefined' && location.origin
                    ? location.origin
                    : 'https://www.zhipin.com';
                const parsed = new URL(absolute, origin);
                if (!parsed.pathname.includes('/job_detail/')) return absolute;
                return `${parsed.origin}${parsed.pathname}`;
            } catch (e) {
                return absolute.split(/[?#]/, 1)[0];
            }
        },
        jobIdentityKey(href) {
            return this.jobIdentityUrl(href) || this.normalUrl(href) || String(href || '');
        },
        jobIdFromValue(value) {
            const raw = String(value || '');
            if (!raw) return '';
            try {
                const origin = typeof location !== 'undefined' && location.origin
                    ? location.origin
                    : 'https://www.zhipin.com';
                const parsed = new URL(raw, origin);
                const queryJobId = parsed.searchParams.get('jobId') || parsed.searchParams.get('jobid');
                if (queryJobId) return queryJobId;
                const match = parsed.pathname.match(/\/job_detail\/([^/?#]+?)(?:\.html)?$/i);
                return match ? match[1] : '';
            } catch (e) {
                const queryMatch = raw.match(/[?&]jobId=([^&#]+)/i);
                if (queryMatch) return decodeURIComponent(queryMatch[1]);
                const pathMatch = raw.match(/\/job_detail\/([^/?#]+?)(?:\.html)?(?:[?#]|$)/i);
                return pathMatch ? pathMatch[1] : '';
            }
        },
        zhaopinJobIdFromValue(value) {
            const raw = String(value || '');
            if (!raw) return '';
            try {
                const parsed = new URL(raw, 'https://www.zhaopin.com');
                for (const key of ['positionNumber', 'positionnumber', 'jobId', 'jobid', 'positionId', 'positionid']) {
                    const candidate = parsed.searchParams.get(key);
                    if (candidate) return candidate;
                }
                const match = parsed.pathname.match(/\/(?:jobdetail|job-detail|job)\/([^/?#]+?)(?:\.html)?$/i);
                return match ? match[1] : '';
            } catch (e) {
                return '';
            }
        },
        zhaopinJobIdentityUrl(value) {
            const absolute = this.normalUrl(value);
            if (!absolute) return '';
            try {
                const parsed = new URL(absolute, 'https://www.zhaopin.com');
                const path = parsed.pathname.replace(/\/+$/, '') || '/';
                return `${parsed.origin}${path}`;
            } catch (e) {
                return String(absolute).split(/[?#]/, 1)[0];
            }
        },
        isZhaopinListUrl(value) {
            try {
                const parsed = new URL(String(value || ''), 'https://www.zhaopin.com');
                if (parsed.hostname !== 'www.zhaopin.com') return false;
                const path = parsed.pathname.toLowerCase();
                return path === '/recommend'
                    || path.startsWith('/recommend/')
                    || path === '/sou'
                    || path.startsWith('/sou/');
            } catch (e) {
                return false;
            }
        },
        zhaopinActionState(value) {
            const text = this.normalizePlainText(value).replace(/\s+/g, '');
            if (text === '已投递' || text.includes('已投递')) return 'already_applied';
            if (text === '立即投递') return 'apply';
            return 'ignore';
        },
        zhaopinPaginationControlState(meta = {}) {
            const text = this.normalizePlainText(meta.text || '');
            const ariaLabel = this.normalizePlainText(meta.ariaLabel || '');
            const title = this.normalizePlainText(meta.title || '');
            const rel = this.normalizePlainText(meta.rel || '').toLowerCase();
            const classText = `${meta.className || ''} ${meta.parentClassName || ''}`.toLowerCase();
            const inPagination = Boolean(meta.inPagination);
            const namedNext = rel === 'next'
                || /^(?:下一页|下页|next(?:\s*page)?)(?:\s*[>›»])?$/i.test(text)
                || /(?:下一页|下页|next\s*page)/i.test(`${ariaLabel} ${title}`)
                || (inPagination && /^[>›»]$/.test(text))
                || (inPagination && /(?:^|[-_\s])next(?:$|[-_\s])/.test(classText));
            if (!namedNext) return 'ignore';
            const disabled = Boolean(meta.disabled)
                || String(meta.ariaDisabled || '').toLowerCase() === 'true'
                || /disabled|forbid/.test(classText);
            return disabled ? 'disabled' : 'next';
        },
        zhaopinListSourceIdentity(value) {
            try {
                const parsed = new URL(String(value || ''), 'https://www.zhaopin.com');
                const pageKeys = new Set(['p', 'page', 'pageno', 'pagenum', 'pageindex', 'current', 'currentpage']);
                for (const key of Array.from(parsed.searchParams.keys())) {
                    if (pageKeys.has(String(key).toLowerCase())) parsed.searchParams.delete(key);
                }
                parsed.hash = '';
                parsed.searchParams.sort();
                return `${parsed.origin}${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
            } catch (e) {
                return String(value || '').split('#')[0];
            }
        },
        zhaopinPageTransitionOutcome(before = {}, after = {}) {
            const beforeUrl = String(before.url || '').split('#')[0];
            const afterUrl = String(after.url || '').split('#')[0];
            const beforePage = String(before.page || '');
            const afterPage = String(after.page || '');
            const beforeFingerprint = String(before.fingerprint || '');
            const afterFingerprint = String(after.fingerprint || '');
            const urlChanged = Boolean(beforeUrl && afterUrl && beforeUrl !== afterUrl);
            const pageChanged = Boolean(beforePage && afterPage && beforePage !== afterPage);
            const jobsChanged = Boolean(afterFingerprint && beforeFingerprint !== afterFingerprint);
            const navigationChanged = urlChanged || pageChanged;
            const jobsReady = Number(after.jobCount || 0) > 0;
            return {
                urlChanged,
                pageChanged,
                jobsChanged,
                navigationChanged,
                changed: navigationChanged || jobsChanged,
                ready: jobsChanged || (navigationChanged && jobsReady),
            };
        },
        randomApplyDelayMs(minSeconds = 3, maxSeconds = 10, randomValue = Math.random()) {
            const min = Math.max(3, Math.min(60, Number(minSeconds) || 3));
            const max = Math.max(min, Math.min(60, Number(maxSeconds) || min));
            const ratio = Math.max(0, Math.min(1, Number(randomValue) || 0));
            return Math.floor((min + (max - min) * ratio) * 1000);
        },
        isJobSearchPath(path = location.pathname) {
            const value = String(path || '').replace(/\/+$/, '');
            return value === '/web/geek/job' || value === '/web/geek/jobs';
        },
        documentScrollFallbackEligible(metrics = {}) {
            if (!this.isJobSearchPath(metrics.path || '')) return false;
            if (metrics.riskBlocked) return false;
            if (Number(metrics.jobLinkCount || 0) < 2 && Number(metrics.jobCardCount || 0) < 2) return false;
            return Number(metrics.scrollHeight || 0) > Number(metrics.clientHeight || 0) + 40;
        },
        scrollMetricsOutcome(before = {}, after = {}) {
            const moved = Math.abs(Number(after.position || 0) - Number(before.position || 0)) >= 5;
            const changed = String(after.fingerprint || '') !== String(before.fingerprint || '')
                || String(after.documentFingerprint || '') !== String(before.documentFingerprint || '')
                || Number(after.contentHeight || 0) !== Number(before.contentHeight || 0)
                || Number(after.jobCount || 0) !== Number(before.jobCount || 0);
            const exhausted = Number(after.position || 0) + Number(after.viewportHeight || 0)
                >= Number(after.contentHeight || 0) - 5;
            return { moved, changed, exhausted };
        },
        logSafeUrl(value) {
            const raw = String(value || '');
            if (!raw) return '';
            try {
                const origin = typeof location !== 'undefined' && location.origin
                    ? location.origin
                    : 'https://www.zhipin.com';
                const parsed = new URL(raw, origin);
                if (!/^https?:$/i.test(parsed.protocol)) return raw;
                const jobId = parsed.searchParams.get('jobId');
                const suffix = jobId ? `?jobId=${encodeURIComponent(jobId)}` : '';
                return `${parsed.origin}${parsed.pathname}${suffix}`;
            } catch (e) {
                return raw
                    .replace(/([?&](?:securityId|token|access_token|authorization|secret|api_key)=)[^&\s]+/gi, '$1[redacted]')
                    .replace(/#.*$/, '');
            }
        },
        sanitizeTelemetryText(value) {
            return String(value || '')
                .replace(/https?:\/\/[^\s"'<>]+/gi, url => this.logSafeUrl(url))
                .replace(/([?&](?:securityId|token|access_token|authorization|secret|api_key)=)[^&\s]+/gi, '$1[redacted]');
        },
        sanitizeTelemetryValue(value, depth = 0) {
            if (depth > 6 || value == null) return value;
            if (typeof value === 'string') return this.sanitizeTelemetryText(value);
            if (Array.isArray(value)) {
                return value.slice(0, 200).map(item => this.sanitizeTelemetryValue(item, depth + 1));
            }
            if (typeof value === 'object') {
                const result = {};
                for (const [key, item] of Object.entries(value)) {
                    if (/(?:securityid|access_token|authorization|api_key|secret)/i.test(key)) {
                        result[key] = '[redacted]';
                    } else {
                        result[key] = this.sanitizeTelemetryValue(item, depth + 1);
                    }
                }
                return result;
            }
            return value;
        },
        findUrlDeep(value, matcher, depth = 0, seen = new Set()) {
            if (!value || depth > 5) return '';
            if (typeof value === 'string') {
                const url = this.normalUrl(value);
                return url && matcher(url) ? url : '';
            }
            if (typeof value !== 'object' || seen.has(value)) return '';
            seen.add(value);
            if (Array.isArray(value)) {
                for (const item of value) {
                    const found = this.findUrlDeep(item, matcher, depth + 1, seen);
                    if (found) return found;
                }
                return '';
            }
            const likelyKeys = ['chatUrl', 'redirectUrl', 'redirect-url', 'url', 'href', 'link'];
            const entries = Object.entries(value).sort(([a], [b]) => {
                const aLikely = likelyKeys.some(key => a.toLowerCase().includes(key.toLowerCase()));
                const bLikely = likelyKeys.some(key => b.toLowerCase().includes(key.toLowerCase()));
                return Number(bLikely) - Number(aLikely);
            });
            for (const [, item] of entries) {
                const found = this.findUrlDeep(item, matcher, depth + 1, seen);
                if (found) return found;
            }
            return '';
        },
        findChatUrlDeep(value) {
            return this.findUrlDeep(value, url => this.isChatUrl(url));
        },
        isChatUrl(url) {
            return Boolean(url && (url.includes('/web/geek/chat') || url.includes('/geek/chat')));
        },
        hrefFromJobNode(node) {
            if (!node) return '';
            const direct = node.matches && node.matches('a[href]') ? node : null;
            const closest = node.closest ? node.closest('a[href]') : null;
            const child = node.querySelector ? node.querySelector('a[href]') : null;
            const link = direct || closest || child;
            return link ? this.normalUrl(link.getAttribute('href') || link.href) : '';
        },
        greetContextKey: '__chatbot_zhou_greet_context',
        greetClaimKey: '__chatbot_zhou_greet_claim',
        greetTransactionKey: '__job_seeker_greet_transactions',
        dailyGreetKey: '__chatbot_zhou_daily_greet_count',
        newGreetRequestId() {
            return `greet_${Date.now()}_${Math.floor(Math.random() * 100000)}_${PAGE_INSTANCE_ID}`;
        },
        getGreetContext() {
            return this.readJson(this.greetContextKey, {});
        },
        saveGreetContext(context) {
            const next = {
                ...context,
                requestId: String(context.requestId || this.newGreetRequestId()),
                createdAt: Number(context.createdAt || Date.now()),
                maxAttempts: Number(context.maxAttempts || OPTIONS.greetMaxAttempts || 3),
                attempt: Number(context.attempt || 1),
            };
            this.writeJson(this.greetContextKey, next);
            return next;
        },
        greetTransactionId(runId, jobUrl) {
            return `${String(runId || 'unknown')}::${this.normalUrl(jobUrl) || String(jobUrl || '')}`;
        },
        getGreetTransactions() {
            const value = this.readJson(this.greetTransactionKey, {});
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        },
        getGreetTransaction(runId, jobUrl) {
            const transactions = this.getGreetTransactions();
            return transactions[this.greetTransactionId(runId, jobUrl)] || {};
        },
        updateGreetTransaction(runId, jobUrl, state, detail = {}) {
            const transactions = this.getGreetTransactions();
            const id = this.greetTransactionId(runId, jobUrl);
            const previous = transactions[id] || {};
            transactions[id] = {
                ...previous,
                ...detail,
                id,
                runId: String(runId || previous.runId || ''),
                jobUrl: this.normalUrl(jobUrl) || String(jobUrl || previous.jobUrl || ''),
                state,
                updatedAt: Date.now(),
                createdAt: Number(previous.createdAt || Date.now()),
            };
            const entries = Object.entries(transactions)
                .sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0))
                .slice(0, 500);
            this.writeJson(this.greetTransactionKey, Object.fromEntries(entries));
            return transactions[id];
        },
        isTerminalGreetTransaction(transaction) {
            return ['send_clicked', 'confirmed', 'unknown'].includes(String(transaction?.state || ''));
        },
        clearGreetContext(requestId = '') {
            const context = this.getGreetContext();
            if (requestId && context.requestId && context.requestId !== requestId) return false;
            localStorage.removeItem(this.greetContextKey);
            const claim = this.readJson(this.greetClaimKey, {});
            if (!requestId || claim.requestId === requestId) {
                localStorage.removeItem(this.greetClaimKey);
            }
            return true;
        },
        claimGreetContext() {
            const context = this.getGreetContext();
            if (!context || !context.requestId) {
                return { claimed: false, reason: 'missing_request_id', context };
            }
            const createdAt = Number(context.createdAt || 0);
            if (!createdAt || Date.now() - createdAt > OPTIONS.timestampTimeout) {
                return { claimed: false, reason: 'expired', context };
            }
            const claim = this.readJson(this.greetClaimKey, {});
            const claimExpired = !claim.claimedAt || Date.now() - Number(claim.claimedAt) > OPTIONS.timestampTimeout;
            if (claim.requestId === context.requestId && claim.pageInstanceId && claim.pageInstanceId !== PAGE_INSTANCE_ID && !claimExpired) {
                return { claimed: false, reason: 'claimed_by_other_page', context, claim };
            }
            const nextClaim = {
                requestId: context.requestId,
                pageInstanceId: PAGE_INSTANCE_ID,
                claimedAt: Date.now(),
                url: location.href,
            };
            this.writeJson(this.greetClaimKey, nextClaim);
            const confirmed = this.readJson(this.greetClaimKey, {});
            const claimed = confirmed.requestId === context.requestId && confirmed.pageInstanceId === PAGE_INSTANCE_ID;
            return { claimed, reason: claimed ? '' : 'claim_race_lost', context, claim: confirmed };
        },
        releaseGreetClaim(requestId = '') {
            const claim = this.readJson(this.greetClaimKey, {});
            if (claim.pageInstanceId !== PAGE_INSTANCE_ID) return false;
            if (requestId && claim.requestId !== requestId) return false;
            localStorage.removeItem(this.greetClaimKey);
            return true;
        },
        claimTimestampGreetFallback(openedAt) {
            const fallbackId = `timestamp_${openedAt || 0}`;
            const claim = this.readJson(this.greetClaimKey, {});
            const claimExpired = !claim.claimedAt || Date.now() - Number(claim.claimedAt) > OPTIONS.timestampTimeout;
            if (claim.requestId === fallbackId && claim.pageInstanceId && claim.pageInstanceId !== PAGE_INSTANCE_ID && !claimExpired) {
                return { claimed: false, reason: 'fallback_claimed_by_other_page', claim };
            }
            const nextClaim = {
                requestId: fallbackId,
                pageInstanceId: PAGE_INSTANCE_ID,
                claimedAt: Date.now(),
                url: location.href,
                fallback: true,
            };
            this.writeJson(this.greetClaimKey, nextClaim);
            const confirmed = this.readJson(this.greetClaimKey, {});
            const claimed = confirmed.requestId === fallbackId && confirmed.pageInstanceId === PAGE_INSTANCE_ID;
            return { claimed, reason: claimed ? 'timestamp_fallback_claimed' : 'fallback_claim_race_lost', claim: confirmed };
        },
        sessionStateKey: '__chatbot_zhou_greet_session',
        getGreetSession() {
            try {
                const value = JSON.parse(localStorage.getItem(this.sessionStateKey) || '{}');
                return {
                    runId: String(value.runId || ''),
                    backendRunId: String(value.backendRunId || ''),
                    count: Number(value.count || 0),
                    startedAt: String(value.startedAt || ''),
                    ended: Boolean(value.ended),
                };
            } catch (e) {
                return { runId: '', backendRunId: '', count: 0, startedAt: '', ended: true };
            }
        },
        saveGreetSession(session) {
            const state = {
                runId: String(session.runId || ''),
                backendRunId: String(session.backendRunId || ''),
                count: Math.max(0, Number(session.count || 0)),
                startedAt: String(session.startedAt || new Date().toISOString()),
                ended: Boolean(session.ended),
            };
            localStorage.setItem(this.sessionStateKey, JSON.stringify(state));
            return state;
        },
        startGreetSession(force = false, backendRunId = '') {
            const current = this.getGreetSession();
            if (!force && current.runId && !current.ended && (!backendRunId || current.backendRunId === backendRunId)) {
                return current;
            }
            return this.saveGreetSession({
                runId: `run_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
                backendRunId,
                count: 0,
                startedAt: new Date().toISOString(),
                ended: false,
            });
        },
        endGreetSession() {
            const current = this.getGreetSession();
            if (!current.runId) return current;
            return this.saveGreetSession({ ...current, ended: true });
        },
        getSessionGreetCount() {
            return this.getGreetSession().count;
        },
        increaseSessionGreetCount() {
            const current = this.startGreetSession(false);
            const next = this.saveGreetSession({ ...current, count: current.count + 1, ended: false });
            return next.count;
        },
        todayString() {
            const now = new Date();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            return `${now.getFullYear()}-${month}-${day}`;
        },
        getDailyGreetState() {
            const today = this.todayString();
            const state = this.readJson(this.dailyGreetKey, {});
            if (!state || state.date !== today) {
                const next = { date: today, count: 0 };
                this.writeJson(this.dailyGreetKey, next);
                return next;
            }
            return { date: today, count: Math.max(0, Number(state.count || 0)) };
        },
        getDailyGreetCount() {
            return this.getDailyGreetState().count;
        },
        increaseDailyGreetCount() {
            const current = this.getDailyGreetState();
            const next = { date: current.date, count: current.count + 1 };
            this.writeJson(this.dailyGreetKey, next);
            return next.count;
        },
        riskSurfaceText() {
            const selectors = [
                '[role="dialog"]', '.dialog-wrap', '.boss-dialog', '.boss-popup', '.toast',
                '[class*="captcha"]', '[id*="captcha"]', '[class*="verify"]', '[id*="verify"]',
                '[class*="security"]', '[id*="security"]', 'iframe[src*="captcha"]',
                'iframe[src*="verify"]', '.geetest_panel', '.nc-container', '.login-dialog',
                '[class*="modal"]', '[class*="popup"]', '[class*="dialog"]', '[class*="layer"]',
            ];
            const texts = [];
            for (const selector of selectors) {
                let nodes = [];
                try {
                    nodes = Array.from(document.querySelectorAll(selector));
                } catch (e) {
                    continue;
                }
                for (const node of nodes.slice(0, 20)) {
                    if (node.tagName === 'IFRAME') {
                        texts.push(`${node.getAttribute('src') || ''} ${node.getAttribute('title') || ''}`);
                        continue;
                    }
                    if (!this.isVisible(node)) continue;
                    texts.push(node.innerText || node.textContent || '');
                }
            }
            return texts.join(' ').replace(/\s+/g, ' ').trim();
        },
        normalizedText(node) {
            return String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
        },
        normalizePlainText(value) {
            return String(value || '').replace(/\s+/g, ' ').trim();
        },
        sanitizeCompanyName(value, title = '', salary = '') {
            const raw = String(value || '').trim();
            if (!raw) return '';
            const titleText = this.normalizePlainText(title);
            const salaryText = this.normalizePlainText(salary);
            const salaryLike = /(?:\d+(?:\.\d+)?\s*[-~至]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*以上|\d+(?:\.\d+)?\s*以下)\s*[kK千万]?|面议|薪资open/i;
            const badFragments = /职位|岗位|经验|学历|立即沟通|收藏|举报/;
            const parts = raw
                .split(/\r?\n|\t| {2,}/)
                .map(text => this.normalizePlainText(text))
                .filter(Boolean);
            const candidates = parts.length ? parts : [this.normalizePlainText(raw)];
            for (const candidate of candidates) {
                if (!candidate || candidate.length > 80) continue;
                if (titleText && candidate === titleText) continue;
                if (salaryText && candidate.includes(salaryText)) continue;
                if (salaryLike.test(candidate)) continue;
                if (titleText && candidate.includes(titleText) && (salaryLike.test(candidate) || candidate.length > titleText.length + 4)) continue;
                if (badFragments.test(candidate) && titleText && candidate.includes(titleText)) continue;
                return candidate;
            }
            return '';
        },
        isBackendUnavailableError(value) {
            const text = String(value?.message || value || '').toLowerCase();
            if (!text) return false;
            if (text.includes('background shutdown')) return true;
            if (text.includes('后端未连接') || text.includes('api 服务未连接')) return true;
            if (text.includes('failed to fetch') || text.includes('networkerror')) return true;
            if (text.includes('econnrefused') || text.includes('connection refused') || text.includes('winerror 10061')) return true;
            return text.includes('/jobs/analyze') && (
                text.includes('请求出错')
                || text.includes('请求失败')
                || text.includes('network')
                || text.includes('refused')
            );
        },
        jsonVisibleText(value, maxItems = 80) {
            const parts = [];
            const walk = (item, depth = 0) => {
                if (parts.length >= maxItems || depth > 5 || item == null) return;
                if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
                    parts.push(String(item));
                    return;
                }
                if (Array.isArray(item)) {
                    item.slice(0, 20).forEach(child => walk(child, depth + 1));
                    return;
                }
                if (typeof item === 'object') {
                    Object.keys(item).slice(0, 40).forEach(key => {
                        parts.push(String(key));
                        walk(item[key], depth + 1);
                    });
                }
            };
            walk(value);
            return parts.join(' ').replace(/\s+/g, ' ').trim();
        },
        isQuotaReminderText(text) {
            const content = String(text || '').replace(/\s+/g, ' ');
            if (!content) return false;
            const hasBossCount = /今天已与\s*\d+\s*位?\s*BOSS\s*沟通/.test(content)
                || /已与\s*\d+\s*位?\s*BOSS\s*沟通/.test(content);
            const hasRemaining = /(还剩|剩余)\s*\d+\s*次\s*(沟通机会|沟通|机会)?/.test(content)
                || /还有\s*\d+\s*次\s*(沟通机会|沟通|机会)?/.test(content);
            const hasFriendlyTitle = content.includes('温馨提示');
            return (hasBossCount && hasRemaining) || (hasFriendlyTitle && hasRemaining && content.includes('BOSS'));
        },
        quotaReminderReasonFromValue(value) {
            const text = typeof value === 'string' ? value : this.jsonVisibleText(value);
            if (this.isQuotaReminderText(text)) return 'BOSS 温馨提示额度弹窗';
            return this.detectQuotaWarningText(text);
        },
        findQuotaReminderDialog() {
            const selector = [
                '[role="dialog"]',
                '[aria-modal="true"]',
                '.dialog-wrap',
                '.boss-dialog',
                '.boss-popup',
                '[class*="dialog"]',
                '[class*="modal"]',
                '[class*="popup"]',
                '[class*="layer"]',
                'body > div',
            ].join(',');
            let nodes = [];
            try {
                nodes = Array.from(document.querySelectorAll(selector));
            } catch (e) {
                nodes = [];
            }
            const textMatched = [];
            for (const node of nodes.slice(0, 250)) {
                if (!this.isVisible(node)) continue;
                const text = this.normalizedText(node);
                if (!this.isQuotaReminderText(text)) continue;
                const rect = node.getBoundingClientRect();
                textMatched.push({ node, text, area: Math.max(1, rect.width * rect.height) });
            }
            textMatched.sort((a, b) => a.area - b.area);
            for (const item of textMatched) {
                const buttons = Array.from(item.node.querySelectorAll('button,a,[role="button"],.btn,[class*="btn"],[class*="button"],[class*="confirm"],[class*="ok"],span,div'))
                    .filter(el => this.isVisible(el) && !this.isDisabled(el));
                const confirmButton = buttons.find(el => /^(好|确定|确认|知道了|我知道了)$/.test(this.normalizedText(el)));
                if (confirmButton) {
                    const clickable = this.clickableAncestor(confirmButton, item.node) || confirmButton;
                    return {
                        dialog: item.node,
                        button: clickable,
                        textElement: confirmButton,
                        text: item.text.slice(0, 160),
                    };
                }
            }
            return null;
        },
        async confirmQuotaReminderDialog() {
            const found = this.findQuotaReminderDialog();
            if (!found) return null;
            const clicked = this.clickLikeUser(found.button) || found.button;
            const deadline = Date.now() + 5000;
            let stillVisible = true;
            while (Date.now() < deadline) {
                await this.asyncSleep(250);
                if (!this.findQuotaReminderDialog()) {
                    stillVisible = false;
                    break;
                }
            }
            return {
                confirmed: !stillVisible,
                text: found.text,
                button: this.normalizedText(found.textElement || found.button),
                dialog: this.elementBrief(found.dialog),
                clicked: this.elementBrief(clicked),
            };
        },
        compactPageText(maxLength = 1800) {
            const text = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
            return text.length <= maxLength ? text : '';
        },
        interruptionLocationReason() {
            const url = `${location.pathname || ''}${location.search || ''}${location.hash || ''}`.toLowerCase();
            if (/(captcha|verify|security-check|safe-check|challenge)/.test(url)) return '安全验证页面';
            if (/\/(login|signin)(\/|$)/.test(url)) return '登录页面';
            return '';
        },
        detectInterruptionText(text) {
            const content = String(text || '').replace(/\s+/g, ' ').toLowerCase();
            const patterns = [
                '安全验证',
                '访问异常',
                '请完成验证',
                '登录已过期',
                '登录状态已失效',
                '请先登录',
                '账号存在异常',
                '系统检测到异常',
                '拖动滑块',
                '向右滑动',
                '滑动验证',
                '图形验证码',
                '请输入验证码',
                '完成验证码',
                'security verification',
                'please complete verification',
                'please log in',
                'captcha verification',
            ];
            return patterns.find(pattern => content.includes(pattern)) || '';
        },
        detectPlatformLimitText(text) {
            const content = String(text || '').replace(/\s+/g, ' ');
            const patterns = [
                '次数已用完',
                '次数已达上限',
                '达到上限',
                '今日无法继续沟通',
                '今日招呼次数',
                '明日再试',
                '明天再试',
                '今日已达上限',
                '沟通名额已用完',
                '打招呼次数已用完',
                '操作过于频繁',
                '访问过于频繁',
                'too frequent',
                'rate limit exceeded',
            ];
            return patterns.find(pattern => content.includes(pattern)) || '';
        },
        detectQuotaWarningText(text) {
            const content = String(text || '').replace(/\s+/g, ' ');
            const regexPatterns = [
                /剩余[^，。；;]*\d+\s*次/,
                /今天[^，。；;]*剩余[^，。；;]*\d+\s*次/,
                /今日[^，。；;]*剩余[^，。；;]*\d+\s*次/,
                /今日[^，。；;]*还可[^，。；;]*\d+\s*次/,
            ];
            const keywordPatterns = [
                '今天剩余',
                '今日剩余',
                '剩余沟通次数',
                '剩余打招呼',
                '沟通次数提醒',
                '今日沟通次数',
                '今日还可',
                '剩余次数',
            ];
            const matchedRegex = regexPatterns.find(pattern => pattern.test(content));
            if (matchedRegex) return '平台额度提醒';
            return keywordPatterns.find(pattern => content.includes(pattern)) || '';
        },
        detectManualInterruption() {
            const locationReason = this.interruptionLocationReason();
            if (locationReason) return locationReason;
            return this.detectInterruptionText(this.riskSurfaceText())
                || this.detectInterruptionText(this.compactPageText());
        },
        detectPlatformLimit() {
            return this.detectPlatformLimitText(this.riskSurfaceText())
                || this.detectPlatformLimitText(this.compactPageText());
        },
        manualInterruptionReason(value) {
            const content = String(value || '');
            const detected = this.detectInterruptionText(content);
            if (detected) return detected;
            return content.slice(0, 120);
        },
        isManualInterruptionError(value) {
            return Boolean(this.manualInterruptionReason(value) && this.detectInterruptionText(String(value || '')));
        },
        platformLimitReason(value) {
            const content = String(value || '');
            const detected = this.detectPlatformLimitText(content);
            if (detected) return detected;
            return '';
        },
        isPlatformLimitError(value) {
            return Boolean(this.platformLimitReason(value));
        },
        quotaWarningReason(value) {
            const content = String(value || '');
            const detected = this.detectQuotaWarningText(content);
            if (detected) return detected;
            return '';
        },
        isQuotaWarningError(value) {
            return Boolean(this.quotaWarningReason(value));
        },
        isElementMissingError(value) {
            const content = String(value || '');
            return content.includes('未找到目标元素') || content.includes('target element') || content.includes('not found');
        },
        isChatEntryRejectedError(value) {
            const content = String(value || '');
            const patterns = [
                '无法进行沟通',
                '不能进行沟通',
                '暂无法沟通',
                '沟通失败',
                '打招呼入口失败',
                'BOSS 拒绝打招呼入口请求',
                'chat_entry_quota_reminder_unconfirmed',
                'chat_entry_quota_reminder_no_chat_url',
                'chat_entry_quota_reminder_repeated',
            ];
            return patterns.some(pattern => content.includes(pattern));
        },
        contactedReasonFromElement(el) {
            if (!el) return '';
            const text = String(el.innerText || el.textContent || '').replace(/\s+/g, '');
            const attrText = [
                el.getAttribute && el.getAttribute('ka'),
                el.getAttribute && el.getAttribute('class'),
                el.getAttribute && el.getAttribute('data-isfriend'),
                el.dataset && el.dataset.isfriend,
            ].filter(Boolean).join(' ');
            if (el.dataset && el.dataset.isfriend === 'true') return '页面标记已沟通';
            const contactedPatterns = ['继续沟通', '去聊天', '已沟通', '沟通中', '查看聊天', '进入聊天'];
            const matched = contactedPatterns.find(pattern => text.includes(pattern));
            if (matched) return `页面显示${matched}`;
            if (String(attrText).includes('isfriend') && String(attrText).includes('true')) {
                return '页面属性标记已沟通';
            }
            return '';
        },
        normalizeFeedTabText(value) {
            return String(value || '').replace(/\s+/g, ' ').trim();
        },
        isSystemFeedName(value) {
            return ['推荐', '系统推荐', '为你推荐'].includes(this.normalizeFeedTabText(value));
        },
        isIgnoredFeedName(value) {
            const text = this.normalizeFeedTabText(value);
            if (!text) return true;
            const exactIgnored = new Set([
                '职位', '公司', '消息', '我的', '首页', '搜索', '筛选', '全部', '城市',
                '经验', '学历', '薪资', '行业', '附近', '地图', '最新', '默认', '清空', '确定',
                '取消', '重置', '保存', '更多', '排序', '区域', '地铁', '要求', '校园', '海归',
                'APP', '有了', '海外', '无障碍专区', '简历', 'BOSS直聘', '求职类型', '薪资待遇',
                '工作经验', '学历要求', '公司行业', '公司规模', '收藏', '立即沟通', '举报',
            ]);
            if (exactIgnored.has(text)) return true;
            if (/地图|筛选|附近|全部|清空|确定|取消|重置|排序|扫码|分享|举报|收藏|立即沟通/.test(text)) return true;
            if (/客服|不加班|办公室|坐班|工作制|居家办公|销售|大专|年以内|企业客服/.test(text)) return true;
            if (/^[-\s\d.,，。+\-~—_（）()]+K?$/i.test(text)) return true;
            if (/^\d+$/.test(text)) return true;
            return false;
        },
        isCompositeFeedName(value) {
            const text = this.normalizeFeedTabText(value);
            if (!text) return false;
            if (/^(推荐|系统推荐|为你推荐)\s+.+/.test(text)) return true;
            const cityGroups = text.match(/[（(][^）)]{1,10}[）)]/g) || [];
            if (cityGroups.length >= 2) return true;
            const jobWordMatches = text.match(/(算法|大模型|自然语言|NLP|AI|AIGC|Agent|RAG|开发|工程师|后端|前端|测试|运维|产品|数据|架构|Java|Python|Go|C\+\+|Dify|Coze|LangChain)/gi) || [];
            if (jobWordMatches.length >= 2 && /\s+/.test(text)) return true;
            return false;
        },
        isLikelyCustomFeedName(value) {
            const text = this.normalizeFeedTabText(value);
            if (!text || text.length > 32) return false;
            if (this.isCompositeFeedName(text)) return false;
            if (this.isSystemFeedName(text) || this.isIgnoredFeedName(text)) return false;
            return /[\u4e00-\u9fa5A-Za-z]/.test(text);
        },
        isStrongCustomFeedName(value) {
            const text = this.normalizeFeedTabText(value);
            if (!this.isLikelyCustomFeedName(text)) return false;
            if (/[、，,。；;]/.test(text)) return false;
            const jobWords = /(算法|大模型|自然语言|NLP|AI|AIGC|Agent|RAG|开发|工程师|后端|前端|测试|运维|产品|数据|架构|Java|Python|Go|C\+\+|Dify|Coze|LangChain)/i;
            const citySuffix = /[（(][^）)]{1,10}[）)]$/.test(text);
            return jobWords.test(text) || (citySuffix && text.length <= 24);
        },
    };

    /**
     * 横幅
     * @param {string} text 显示的文本
     */
    function banner(text) {
        const el = document.createElement('div');
        el.style.cssText = `
                position: fixed;
                top: 60px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 9999;
                background-color: rgba(0,0,0,.5);
                padding: 4px 20px;
                text-align: center;
                border-radius: 8px;
                color: #fff;
        `;
        el.innerText = text;
        document.body.appendChild(el);
        setTimeout(function () {
            el.remove();
        }, 3000);
    }

    /**
     * 转换时间
     * @param {number} seconds 秒数
     * @returns {string} 转换后的时间字符串
     */
    function convertTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toFixed(0).padStart(2, '0')}`;
    }


    class WebBroadcastError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
            this.name = 'WebBroadcastError';
        }
    }

    class WebBroadcast {
        static ID_COUNTER = 0; // 自增序列，避免时间戳冲突

        /**
         * @param {string} name 频道名称
         * @param {string} target 当前页面标识
         * @param {object} [options] 配置项
         * @param {number} [options.retry=3] 发送失败重试次数
         * @param {number} [options.retryInterval=1000] 重试间隔(毫秒)
         */
        constructor(name, target, options = {}) {
            this.name = name;
            this.target = target;
            this.retry = options.retry ?? 3;
            this.retryInterval = options.retryInterval ?? 1000;
            this.evts = {};
            this.pendingResponses = {};
            this.pendingReceives = {};

            // 初始化通信通道
            this.initChannel();
        }

        /* -------------------- 核心通信逻辑 -------------------- */
        initChannel() {
            // 优先使用 BroadcastChannel
            if (typeof BroadcastChannel !== 'undefined') {
                this.setupBroadcastChannel();
            } else {
                this.setupStorageFallback();
            }
            window.addEventListener('beforeunload', () => this.destroy());
        }

        setupBroadcastChannel() {
            this.channelType = 'broadcast';
            this.channel = new BroadcastChannel(this.name);
            this.channel.addEventListener('message', this.handleMessage.bind(this));
            this.channel.addEventListener('messageerror', (e) => {
                this.emitError('MESSAGE_ERROR', '消息解析失败', e);
            });
        }

        setupStorageFallback() {
            this.channelType = 'storage';
            this.storageKey = `web_broadcast_${this.name}`;

            // 监听 storage 事件
            window.addEventListener('storage', (e) => {
                if (e.key === this.storageKey && e.newValue) {
                    const message = JSON.parse(e.newValue);
                    this.handleMessage({ data: message });
                }
            });
        }

        handleMessage(e) {
            const resp = e.data;
            if (![this.target, 'all'].includes(resp.to)) return;

            // 处理事件监听
            if (this.evts[resp.type]) {
                Promise.resolve().then(() => this.evts[resp.type](resp.from, resp.data));
            }

            // 处理 receive 等待
            const receiveKey = `${resp.from}-${resp.type}`;
            if (this.pendingReceives[receiveKey]) {
                const pending = this.pendingReceives[receiveKey];
                pending.resolve(resp.data);
                clearTimeout(pending.timer);
                delete this.pendingReceives[receiveKey];
            }

            // 处理 sendAndReceive 响应
            if (this.pendingResponses[resp.data?.requestId]) {
                const pending = this.pendingResponses[resp.data.requestId];
                pending.resolve(resp.data);
                clearTimeout(pending.timer);
                delete this.pendingResponses[resp.data.requestId];
            }
        }

        /* -------------------- 消息收发方法 -------------------- */
        send(to, type, data = null, attempt = 0) {
            const message = { from: this.target, to, type, data };

            return new Promise((resolve, reject) => {
                try {
                    if (this.channelType === 'broadcast') {
                        this.channel.postMessage(message);
                    } else {
                        // storage 方案需要先写入再删除，以触发事件
                        localStorage.setItem(this.storageKey, JSON.stringify(message));
                        localStorage.removeItem(this.storageKey);
                    }
                    resolve();
                } catch (err) {
                    if (attempt < this.retry) {
                        setTimeout(() => this.send(to, type, data, attempt + 1), this.retryInterval);
                    } else {
                        this.emitError('SEND_FAILED', `消息发送失败: ${type}`, err);
                        reject(`消息发送失败: ${type}, ${err.message}`);
                    }
                }
            });
        }

        receive(from, type, timeout = 30000) {
            const key = `${from}-${type}`;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new WebBroadcastError('TIMEOUT', `接收超时: ${type}`));
                    delete this.pendingReceives[key];
                }, timeout);

                this.pendingReceives[key] = { resolve, reject, timer };
            });
        }

        sendAndReceive(to, type, data = null, timeout = 30000) {
            const requestId = this.generateRequestId();
            const responseType = `${type}_response`;

            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new WebBroadcastError('TIMEOUT', `请求超时: ${type}`));
                    delete this.pendingResponses[requestId];
                }, timeout);


                this.pendingResponses[requestId] = { resolve, reject, timer };
                // 发送时携带 responseType
                this.send(to, type, { ...data, requestId, responseType });
            });
        }

        reply(originalFrom, originalType, data, requestId, responseType) {
            const finalResponseType = responseType || `${originalType}_response`;
            return this.send(originalFrom, finalResponseType, { ...data, requestId });
        }

        /* -------------------- 工具方法 -------------------- */
        generateRequestId() {
            const time = Date.now().toString(36);
            const random = Math.random().toString(36).slice(2, 6);
            WebBroadcast.ID_COUNTER = (WebBroadcast.ID_COUNTER + 1) % 0xfff;
            return `${time}-${random}-${WebBroadcast.ID_COUNTER.toString(36).padStart(2, '0')}`;
        }

        emitError(code, message, error) {
            const err = new WebBroadcastError(code, `${message}: ${error?.message || error}`);
            console.error(err);
            if (this.evts['error']) {
                this.evts['error'](code, err.message);
            }
        }

        on(evt, fn) {
            if (typeof fn !== 'function') throw new Error('callback must be a function');
            this.evts[evt] = fn;
        }

        off(evt) {
            delete this.evts[evt];
        }

        destroy() {
            if (this.channel) {
                this.channel.close();
            }
            window.removeEventListener('storage', this.handleMessage);
            this.pendingResponses = {};
            this.pendingReceives = {};
        }
    }

    // API 请求
    class Api {
        constructor(platform = 'boss') {
            this.platform = platform === 'zhaopin' ? 'zhaopin' : 'boss';
        }

        /**
         * 封装请求
         * @param {string} path 请求路径
         * @param {string} method 请求方法
         * @param {any} data 请求数据
         * @returns {Promise<any>} 请求结果
         */
        __http(path, method = 'GET', data = null) {
            return new Promise(async (resolve, reject) => {
                const hasLegacyRequest = typeof GM_xmlhttpRequest !== 'undefined';
                const hasPromiseRequest = typeof GM !== 'undefined' && GM.xmlHttpRequest;
                const request = hasLegacyRequest ? GM_xmlhttpRequest : (hasPromiseRequest ? GM.xmlHttpRequest : null);
                if (!request) {
                    banner('缺少 GM.xmlHttpRequest 权限');
                    reject('缺少 GM.xmlHttpRequest 权限');
                    return;
                }
                const handleResponse = (resp) => {
                    if (resp.status != 200) {
                        banner(`请求失败: ${resp.status}`);
                        const raw = resp.responseText ?? resp.response ?? '';
                        let detail = '';
                        try {
                            const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
                            detail = parsed?.detail || parsed?.message || '';
                        } catch (e) {
                            detail = String(raw || '').slice(0, 240);
                        }
                        reject(`请求失败: ${path} HTTP ${resp.status}${detail ? ` ${detail}` : ''}`);
                        return;
                    }
                    try {
                        const raw = resp.responseText ?? resp.response ?? '{}';
                        resolve(typeof raw === 'string' ? JSON.parse(raw) : raw);
                    } catch (e) {
                        banner('响应解析失败');
                        reject(`响应解析失败: ${e}`);
                    }
                };
                const handleError = (err) => {
                    const message = err?.error || err?.message || err?.statusText || JSON.stringify(err);
                    banner(`请求出错: ${path}`);
                    reject(`请求出错: ${path} ${message}`);
                };
                const options = {
                    method: method,
                    url: OPTIONS.serverHost + path,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    data: data,
                    timeout: 1000 * 60 * 10,
                    onload: handleResponse,
                    onerror: handleError,
                    ontimeout: handleError,
                };
                try {
                    const result = request(options);
                    if (!hasLegacyRequest && result && typeof result.then === 'function') {
                        result.then(handleResponse).catch(handleError);
                    }
                } catch (err) {
                    handleError(err);
                }
            });
        }

        /**
         * 获取自我介绍
         */
        getIntroduce() {
            return new Promise((resolve, reject) => this.__http('/get-introduce').then(res => {
                resolve(res.introduce);
            }).catch(reject));
        }

        /**
         * 获取标签
         */
        getTags() {
            return new Promise((resolve, reject) => this.__http('/tags').then(res => {
                resolve(res.tags);
            }).catch(reject));
        }

        getRecentJobs() {
            return this.__http(`/jobs/recent?limit=800&hours=${OPTIONS.recentProcessedHours}`)
                .then(res => Array.isArray(res.jobs) ? res.jobs : [])
                .catch(() => []);
        }

        /**
         * 上报脚本状态
         */
        heartbeat(page, status = 'running', currentAction = '', detail = {}) {
            return this.__http('/script/heartbeat', 'POST', JSON.stringify({
                platform: this.platform,
                instance_id: PAGE_INSTANCE_ID,
                page_kind: page,
                page,
                status,
                current_action: tools.sanitizeTelemetryText(currentAction),
                detail: tools.sanitizeTelemetryValue(detail),
            })).catch(() => ({
                control: 'paused',
                should_pause: true,
                should_start: false,
                should_stop: false,
                offline: true,
                message: '后端未连接，已暂停脚本动作',
            }));
        }

        control(command, reason = '', global = false) {
            return this.__http('/control', 'POST', JSON.stringify({
                command,
                reason,
                platform: global ? null : this.platform,
            }));
        }

        event(type, message, source = 'script', level = 'info', detail = {}) {
            return this.__http('/events', 'POST', JSON.stringify({
                type,
                source,
                level,
                message: tools.sanitizeTelemetryText(message),
                detail: tools.sanitizeTelemetryValue({ platform: this.platform, ...detail }),
            })).catch(() => null);
        }

        /**
         * 结构化职位分析
         */
        analyzeJob(jobInfo) {
            return this.__http('/jobs/analyze', 'POST', JSON.stringify({ platform: this.platform, ...jobInfo })).then(res => res.analysis);
        }

        /**
         * 创建待确认动作
         */
        createAction(actionType, payload = {}, jobInfo = {}, status = 'pending') {
            return this.__http('/actions', 'POST', JSON.stringify({
                action_type: actionType,
                status,
                platform: this.platform,
                idempotency_key: payload.idempotencyKey || '',
                external_job_id: jobInfo.external_job_id || '',
                job_url: jobInfo.url || '',
                company: jobInfo.company || '',
                title: jobInfo.title || '',
                payload,
            }));
        }

        getAction(id) {
            return this.__http(`/actions/${id}`);
        }

        async waitActionApproved(id, timeout = 1000 * 60 * 10) {
            const start = Date.now();
            while (Date.now() - start < timeout) {
                const action = await this.getAction(id);
                if (action.status === 'approved') return true;
                if (action.status === 'rejected') return false;
                await tools.asyncSleep(2000);
            }
            return false;
        }
    }

    // 日志记录
    class Logger {
        constructor(startFn, pauseFn) {
            // 校验回调函数
            if (startFn && typeof startFn !== 'function') {
                throw new Error('参数错误：startFn 应为函数');
            }
            if (pauseFn && typeof pauseFn !== 'function') {
                throw new Error('参数错误：pauseFn 应为函数');
            }
            // 创建元素
            const ctn = document.createElement('div');
            const btnBox = document.createElement('div');
            const clearBtn = document.createElement('div');
            const runBtn = document.createElement('div');
            const foldBtn = document.createElement('div');
            const msgList = document.createElement('div');
            ctn.dataset.jobSeekerOverlay = '1';
            msgList.dataset.jobSeekerOverlay = '1';
            ctn.style.cssText = `
                position: fixed;
                bottom: 16px;
                left: 16px;
                width: 380px;
                background-color: rgba(0, 0, 0, 0.5);
                color: #fff;
                z-index: 9999;
                font-size: 14px;
                border-radius: 10px;
            `;
            btnBox.style.cssText = `
                width: 380px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: flex-end;
            `;
            clearBtn.style.cssText = runBtn.style.cssText = foldBtn.style.cssText = `
                width: 60px;
                height: 32px;
                line-height: 32px;
                text-align: center;
                cursor: pointer;
            `;
            msgList.style.cssText = `
                width: 380px;
                height: 240px;
                padding: 2px 12px 8px;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 4px;
            `;
            clearBtn.innerText = "清空";
            runBtn.innerText = "开始";
            foldBtn.innerText = "收起";
            document.body.appendChild(ctn);
            ctn.appendChild(btnBox);
            btnBox.appendChild(clearBtn);
            btnBox.appendChild(runBtn);
            btnBox.appendChild(foldBtn);
            ctn.appendChild(msgList);
            this.ctn = ctn;
            this.list = msgList;
            this.runBtn = runBtn;
            this.clearBtn = clearBtn;
            this.__startFn = startFn || (() => void 0);
            this.__pauseFn = pauseFn || (() => void 0);
            this.__pause = true;
            clearBtn.addEventListener('click', () => this.clear());
            runBtn.addEventListener('click', async () => {
                const nextPaused = !this.__pause;
                this.setPaused(nextPaused);
                try {
                    if (nextPaused) {
                        await this.__pauseFn();
                    } else {
                        await this.__startFn();
                    }
                } catch (e) {
                    this.add(`控制命令发送失败: ${e}`);
                }
            });
            foldBtn.addEventListener('click', () => {
                if (foldBtn.innerText === "展开") {
                    msgList.style.height = "240px";
                    foldBtn.innerText = "收起";
                } else {
                    msgList.style.height = "32px";
                    this.list.scrollTop = this.list.scrollHeight;
                    foldBtn.innerText = "展开";
                }
            });
        }

        setPaused(paused) {
            this.__pause = Boolean(paused);
            this.runBtn.innerText = this.__pause ? "继续" : "暂停";
        }

        add(message) {
            const item = document.createElement('div');
            item.textContent = message;
            this.list.appendChild(item);
            this.list.scrollTop = this.list.scrollHeight;
        }

        divider() {
            const item = document.createElement('div');
            item.style.cssText = `
                width: 100%;
                border-top: 1px dashed rgba(255, 255, 255, 0.6);
            `;
            this.list.appendChild(item);
            this.list.scrollTop = this.list.scrollHeight;
        }

        clear() {
            while (this.list.firstChild) {
                this.list.removeChild(this.list.firstChild);
            }
        }

        remove() {
            this.ctn.remove();
        }
    }

    // BOSS 直聘
    class Zhipin {
        constructor() {
            // 窗口标签
            this.targets = {
                search: "__zhipin_search",
                detail: "__zhipin_detail",
                chat: "__zhipin_chat",
                chatGreet: "__zhipin_chat_greet",
            };
            // 广播类型
            this.bcTypes = {
                // 全局
                STATUS: "status",
                RUN: 'run',
                DIVIDER: 'divider',
                INTRODUCE: 'introduce',
                HEART_BEAT: 'heart-beat',
                // 聊天页和职位详情页
                GET_JOB_INFO: 'get-job-info',
                SAY_HI: 'say-hi',
            };
            // 白名单
            this.whiteList = WHITELIST.zhipin;
            // 记录状态
            this.pause = false;
            this.tags = [];
            this.introduce = ''
        }

        // 注册广播
        __broadcast(target) {
            this.broadcast = new WebBroadcast('__zhipin_broadcast', target);
        }

        // 搜索页
        async __search(tagIdx) {
            // api
            const api = new Api();
            let currentTagIdx = Math.max(0, Number(tagIdx) || 0);
            this.pause = true;
            const searchPageOpenedAt = new Date().getTime();
            const nowMs = () => (
                window.performance && typeof window.performance.now === 'function'
                    ? window.performance.now()
                    : Date.now()
            );
            let runStartedAt = 0;
            let processedCount = 0;
            let totalProcessedMs = 0;
            let currentJobProgress = null;
            let page = 0;
            // 记录职位链接
            let jobHrefs = [];
            let elsLen = 0;
            const seenJobHrefs = new Set();
            const backendProcessedHrefs = new Set();
            let lastJobListEventKey = '';
            let searchRoundId = 0;
            let tagsCheckedThisRound = new Set();
            let cooldownUntil = 0;
            let cooldownTimer = null;
            let cooldownStartedEventKey = '';
            let cooldownResumeRedirecting = false;
            let currentJobSource = tools.isPreferredFeedPath() ? 'preferred_feed' : 'keyword_search';
            let feedTabs = [];
            let currentFeedTabIndex = -1;
            let currentFeedTabName = '';
            let feedTabProcessedCount = 0;
            let feedTabMaxJobs = OPTIONS.preferredFeedMaxJobsPerTab;
            let preferredFeedsDone = false;
            let feedSwitchAttempted = false;
            let feedSwitchReason = '';
            // 缓存
            let started = false;
            let booting = false;
            let loopRunning = false;
            let waitingForGreeting = false;
            let greetTimeoutId = null;
            let activeGreetingJob = null;
            let currentSearchAction = '等待启动';
            let scrollMode = 'none';
            let scrollTarget = '';
            let scrollRound = 0;
            let lastScrollOutcome = 'idle';
            let scrollBefore = 0;
            let scrollAfter = 0;
            let scrollJobCountBefore = 0;
            let scrollJobCountAfter = 0;
            let lastBackendControl = 'paused';
            let lastBackendRunId = '';
            let hasSearchLease = false;
            let leaseTimer = null;
            let activeTempTab = null;
            const searchLeaseKey = '__job_seeker_search_lease';
            localStorage.removeItem('__job_seeker_manual_recovery');
            const pageFailureStateKey = '__job_seeker_page_failure_recovery';
            let pageFailureRetryCount = 0;
            const preferredFeedStateKey = '__job_seeker_preferred_feed_state';
            const preferredFeedCooldownStateKey = '__job_seeker_preferred_feed_cooldown_state';
            const cooldownResumeStateKey = '__job_seeker_search_cooldown_resume_state';
            const searchBudgetStateKey = '__job_seeker_search_budget';
            const searchRoundStateKey = '__job_seeker_search_round_state';

            const loadPageFailureState = () => {
                try {
                    const state = JSON.parse(localStorage.getItem(pageFailureStateKey) || '{}');
                    if (!state || !state.timestamp || Date.now() - Number(state.timestamp) > 5 * 60 * 1000) {
                        return {};
                    }
                    return state;
                } catch (e) {
                    return {};
                }
            };

            const savePageFailureState = (state) => {
                localStorage.setItem(pageFailureStateKey, JSON.stringify({
                    ...state,
                    timestamp: Date.now(),
                }));
            };

            const clearPageFailureState = () => {
                localStorage.removeItem(pageFailureStateKey);
            };

            const preferredFeedRunKey = () => {
                const session = tools.getGreetSession();
                return lastBackendRunId || session.backendRunId || session.runId || 'unknown';
            };

            const localDateKey = (timestamp = Date.now()) => {
                const date = new Date(timestamp);
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${date.getFullYear()}-${month}-${day}`;
            };

            const searchBudgetSnapshot = () => {
                const now = Date.now();
                const today = localDateKey(now);
                const raw = tools.readJson(searchBudgetStateKey, {});
                const submissions = Array.isArray(raw.submissions)
                    ? raw.submissions.map(Number).filter(value => Number.isFinite(value) && value > 0 && now - value < 24 * 60 * 60 * 1000)
                    : [];
                const dailySubmissions = raw.date === today ? submissions : [];
                const hourlySubmissions = dailySubmissions.filter(value => now - value < 60 * 60 * 1000);
                const hourlyLimit = Number(OPTIONS.maxSearchSubmissionsPerHour || 6);
                const dailyLimit = Number(OPTIONS.maxSearchSubmissionsPerDay || 30);
                let blockedReason = '';
                let nextAllowedAt = 0;
                if (dailySubmissions.length >= dailyLimit) {
                    const tomorrow = new Date();
                    tomorrow.setHours(24, 0, 0, 0);
                    blockedReason = `今日关键词搜索预算已达 ${dailySubmissions.length}/${dailyLimit}`;
                    nextAllowedAt = tomorrow.getTime();
                } else if (hourlySubmissions.length >= hourlyLimit) {
                    blockedReason = `每小时关键词搜索预算已达 ${hourlySubmissions.length}/${hourlyLimit}`;
                    nextAllowedAt = Math.min(...hourlySubmissions) + 60 * 60 * 1000;
                }
                const state = {
                    date: today,
                    submissions: dailySubmissions,
                    hourlyCount: hourlySubmissions.length,
                    dailyCount: dailySubmissions.length,
                    hourlyLimit,
                    dailyLimit,
                    blockedReason,
                    nextAllowedAt,
                };
                tools.writeJson(searchBudgetStateKey, { date: today, submissions: dailySubmissions });
                return state;
            };

            const reserveSearchSubmission = () => {
                const state = searchBudgetSnapshot();
                if (state.blockedReason) {
                    return { ok: false, state };
                }
                state.submissions.push(Date.now());
                tools.writeJson(searchBudgetStateKey, { date: state.date, submissions: state.submissions });
                return { ok: true, state: searchBudgetSnapshot() };
            };

            const saveSearchRoundState = () => {
                tools.writeJson(searchRoundStateKey, {
                    runKey: preferredFeedRunKey(),
                    searchRoundId,
                    currentTagIdx,
                    tagsChecked: Array.from(tagsCheckedThisRound),
                    cooldownUntil,
                    timestamp: Date.now(),
                });
            };

            const restoreSearchRoundState = () => {
                const state = tools.readJson(searchRoundStateKey, {});
                if (!state.timestamp || Date.now() - Number(state.timestamp) > 24 * 60 * 60 * 1000) return false;
                if (state.runKey !== preferredFeedRunKey()) return false;
                searchRoundId = Math.max(0, Number(state.searchRoundId || 0));
                currentTagIdx = Math.max(0, Number(state.currentTagIdx || 0));
                tagsCheckedThisRound = new Set(Array.isArray(state.tagsChecked) ? state.tagsChecked.map(Number) : []);
                cooldownUntil = Math.max(0, Number(state.cooldownUntil || 0));
                return true;
            };

            const loadPreferredFeedState = () => {
                try {
                    const state = JSON.parse(localStorage.getItem(preferredFeedStateKey) || '{}');
                    if (!state || !state.timestamp || Date.now() - Number(state.timestamp) > 24 * 60 * 60 * 1000) {
                        return {};
                    }
                    return state;
                } catch (e) {
                    return {};
                }
            };

            const savePreferredFeedState = (state) => {
                localStorage.setItem(preferredFeedStateKey, JSON.stringify({
                    ...state,
                    runKey: preferredFeedRunKey(),
                    timestamp: Date.now(),
                }));
            };

            const hasPreferredFeedCompletedForRun = () => {
                const state = loadPreferredFeedState();
                return Boolean(state.done && state.runKey === preferredFeedRunKey());
            };

            const preferredFeedTabNames = () => feedTabs.map(tab => tab.name);

            const savePreferredFeedProgress = (status = 'active', extra = {}) => {
                if (currentJobSource !== 'preferred_feed') return;
                savePreferredFeedState({
                    done: false,
                    active: true,
                    status,
                    tabs: preferredFeedTabNames(),
                    currentFeedTabIndex,
                    currentFeedTabName,
                    feedTabProcessedCount,
                    feedTabMaxJobs,
                    pageInstanceId: PAGE_INSTANCE_ID,
                    ...extra,
                });
            };

            const restorePreferredFeedProgress = () => {
                const state = loadPreferredFeedState();
                if (!state || state.runKey !== preferredFeedRunKey() || state.done || !state.active) {
                    return null;
                }
                const savedName = tools.normalizeFeedTabText(state.currentFeedTabName || '');
                let index = -1;
                if (savedName) {
                    index = feedTabs.findIndex(tab => tools.normalizeFeedTabText(tab.name) === savedName);
                }
                const savedIndex = Number(state.currentFeedTabIndex);
                if (index < 0 && Number.isFinite(savedIndex) && savedIndex >= 0 && savedIndex < feedTabs.length) {
                    if (!savedName || tools.normalizeFeedTabText(feedTabs[savedIndex].name) === savedName) {
                        index = savedIndex;
                    }
                }
                if (index < 0) return null;
                const processed = Number(state.feedTabProcessedCount);
                return {
                    index,
                    name: feedTabs[index].name,
                    feedTabProcessedCount: Number.isFinite(processed) ? Math.max(0, Math.floor(processed)) : 0,
                    status: String(state.status || ''),
                };
            };

            const preferredFeedCooldownKey = () => (
                `${preferredFeedRunKey()}::${searchRoundId || 0}::${Math.floor(Number(cooldownUntil || 0) / 1000)}`
            );

            const cooldownResumeLockKey = () => (
                `${preferredFeedRunKey()}::${Math.floor(Number(cooldownUntil || 0) / 1000)}`
            );

            const loadPreferredFeedCooldownState = () => {
                const state = tools.readJson(preferredFeedCooldownStateKey, {});
                if (!state.timestamp || Date.now() - Number(state.timestamp) > 24 * 60 * 60 * 1000) return {};
                return state;
            };

            const savePreferredFeedCooldownState = (state) => {
                tools.writeJson(preferredFeedCooldownStateKey, {
                    ...state,
                    key: preferredFeedCooldownKey(),
                    runKey: preferredFeedRunKey(),
                    searchRoundId,
                    cooldownUntil,
                    timestamp: Date.now(),
                });
            };

            const preferredFeedCooldownStateMatches = (state = loadPreferredFeedCooldownState()) => (
                Boolean(state.key && state.key === preferredFeedCooldownKey())
            );

            const hasPreferredFeedCooldownCycleStarted = () => {
                const state = loadPreferredFeedCooldownState();
                return preferredFeedCooldownStateMatches(state) && ['started', 'done'].includes(String(state.status || ''));
            };

            const cooldownResumeState = () => tools.readJson(cooldownResumeStateKey, {});

            const tryAcquireCooldownResumeLock = () => {
                const lockKey = cooldownResumeLockKey();
                if (!lockKey || lockKey.endsWith('::0')) return false;
                const current = cooldownResumeState();
                const fresh = current.updatedAt && Date.now() - Number(current.updatedAt) < 2 * 60 * 1000;
                if (current.key === lockKey && current.owner && current.owner !== PAGE_INSTANCE_ID && fresh) {
                    return false;
                }
                tools.writeJson(cooldownResumeStateKey, {
                    key: lockKey,
                    owner: PAGE_INSTANCE_ID,
                    status: 'resuming',
                    updatedAt: Date.now(),
                });
                const confirmed = cooldownResumeState();
                return confirmed.key === lockKey && confirmed.owner === PAGE_INSTANCE_ID;
            };

            const markCooldownResumeDone = (status = 'done') => {
                const current = cooldownResumeState();
                if (current.owner !== PAGE_INSTANCE_ID) return;
                tools.writeJson(cooldownResumeStateKey, {
                    ...current,
                    status,
                    updatedAt: Date.now(),
                });
            };

            const shouldPreferFeedBeforeKeywordSearch = () => (
                OPTIONS.preferredFeedMode !== 'off'
                && !tools.isPreferredFeedPath()
                && !preferredFeedsDone
                && !hasPreferredFeedCompletedForRun()
            );

            const recoverySearchPath = () => (
                currentJobSource === 'preferred_feed' && !preferredFeedsDone
                    ? SEARCHPATH.preferred
                    : SEARCHPATH.zhipin
            );

            const loadedPageFailure = loadPageFailureState();
            if (Number.isFinite(Number(loadedPageFailure.retryCount))) {
                pageFailureRetryCount = Math.max(0, Number(loadedPageFailure.retryCount));
            }

            const scriptHeartbeatDetail = () => {
                const session = tools.getGreetSession();
                const daily = tools.getDailyGreetState();
                const searchBudget = searchBudgetSnapshot();
                return {
                    version: OPTIONS.scriptVersion,
                    threshold: OPTIONS.thread,
                    sessionGreetCount: session.count,
                    dailyGreetCount: daily.count,
                    dailyGreetDate: daily.date,
                    runId: session.runId,
                    localSessionRunId: session.runId,
                    backendRunId: session.backendRunId || lastBackendRunId,
                    sessionEnded: Boolean(session.ended),
                    pageInstanceId: PAGE_INSTANCE_ID,
                    searchRoundId,
                    currentTagIndex: currentTagIdx,
                    tagsCheckedThisRound: tagsCheckedThisRound.size,
                    cooldownUntil: cooldownUntil ? new Date(cooldownUntil).toISOString() : '',
                    cooldownMinMinutes: OPTIONS.searchRoundCooldownMinMinutes,
                    cooldownMinutes: OPTIONS.searchRoundCooldownMinutes,
                    cooldownLockKey: cooldownUntil ? cooldownResumeLockKey() : '',
                    cooldownResumeState: cooldownResumeState(),
                    activeSearchOwner: readSearchLease().owner || '',
                    searchBudgetHourlyCount: searchBudget.hourlyCount,
                    searchBudgetHourlyLimit: searchBudget.hourlyLimit,
                    searchBudgetDailyCount: searchBudget.dailyCount,
                    searchBudgetDailyLimit: searchBudget.dailyLimit,
                    searchBudgetBlockedReason: searchBudget.blockedReason,
                    searchBudgetNextAllowedAt: searchBudget.nextAllowedAt ? new Date(searchBudget.nextAllowedAt).toISOString() : '',
                    jobSource: currentJobSource,
                    feedTabs: feedTabs.map(tab => tab.name),
                    currentFeedTabName,
                    currentFeedTabIndex,
                    feedTabProcessedCount,
                    feedTabMaxJobs,
                    feedSwitchAttempted,
                    feedSwitchReason,
                    scrollMode,
                    scrollTarget,
                    scrollRound,
                    lastScrollOutcome,
                    scrollBefore,
                    scrollAfter,
                    scrollJobCountBefore,
                    scrollJobCountAfter,
                };
            };

            const setSearchAction = (action) => {
                currentSearchAction = action || (started ? '搜索/浏览职位' : '等待启动');
            };

            const getSearchAction = () => {
                if (this.pause) return '暂停中';
                return currentSearchAction || (started ? '搜索/浏览职位' : '等待启动');
            };

            const readSearchLease = () => tools.readJson(searchLeaseKey, {});

            const writeSearchLease = () => {
                hasSearchLease = true;
                tools.writeJson(searchLeaseKey, {
                    owner: PAGE_INSTANCE_ID,
                    updatedAt: Date.now(),
                    url: location.href,
                });
            };

            const acquireSearchLease = () => {
                const lease = readSearchLease();
                const expired = !lease.updatedAt || Date.now() - Number(lease.updatedAt) > OPTIONS.searchLeaseMs;
                if (lease.owner && lease.owner !== PAGE_INSTANCE_ID && !expired) {
                    hasSearchLease = false;
                    return false;
                }
                writeSearchLease();
                if (!leaseTimer) {
                    leaseTimer = setInterval(() => {
                        if (!hasSearchLease) return;
                        writeSearchLease();
                    }, Math.max(3000, Math.floor(OPTIONS.searchLeaseMs / 3)));
                }
                return true;
            };

            const releaseSearchLease = () => {
                closeActiveTempTab();
                if (cooldownTimer) {
                    clearTimeout(cooldownTimer);
                    cooldownTimer = null;
                }
                cooldownUntil = 0;
                const lease = readSearchLease();
                if (lease.owner === PAGE_INSTANCE_ID) {
                    localStorage.removeItem(searchLeaseKey);
                }
                hasSearchLease = false;
                if (leaseTimer) {
                    clearInterval(leaseTimer);
                    leaseTimer = null;
                }
            };

            const rememberTempTab = (handle) => {
                if (handle && handle !== true) {
                    activeTempTab = handle;
                }
            };

            const closeActiveTempTab = () => {
                if (activeTempTab) {
                    tools.closeTabHandle(activeTempTab);
                    activeTempTab = null;
                }
            };

            const ensureSearchLease = async (label = '运行检查') => {
                if (acquireSearchLease()) return true;
                setSearchAction('其他搜索页正在运行，本页待命');
                await api.heartbeat('search_standby', 'idle', `${label}: 其他搜索页正在运行`, {
                    ...scriptHeartbeatDetail(),
                    pageInstanceId: PAGE_INSTANCE_ID,
                    lease: readSearchLease(),
                });
                return false;
            };

            window.addEventListener('beforeunload', releaseSearchLease);

            // 日志启动/暂停事件
            const logger = new Logger(async () => {
                const res = await api.heartbeat('search', this.pause ? 'paused' : 'idle', '等待 CLI start', scriptHeartbeatDetail());
                applyBackendConfig(res.config);
                lastBackendRunId = res.run_id || lastBackendRunId;
                if (res.control === 'running' || res.should_start) {
                    if (!(await ensureSearchLease('手动启动'))) return;
                    await ensureSessionForBackendRun(lastBackendRunId, 'manual_start');
                    this.pause = false;
                    logger.setPaused(false);
                    started ? loop() : main();
                    return;
                }
                logger.setPaused(true);
                this.pause = true;
                logger.add('请回到 CLI 输入 start，确认岗位标签和运行配置后开始');
            }, async () => {
                await api.control('pause');
                this.pause = true;
            });

            const noteBackendOffline = (message) => {
                backendOfflineFailures += 1;
                if (backendOfflineFailures >= BACKEND_OFFLINE_NOTIFY_THRESHOLD && !backendOfflineNotified) {
                    logger.add(message);
                    backendOfflineNotified = true;
                }
            };

            const noteBackendOnline = () => {
                if (backendOfflineNotified) {
                    logger.add('后端连接已恢复');
                }
                backendOfflineFailures = 0;
                backendOfflineNotified = false;
            };

            const resetProgress = () => {
                runStartedAt = nowMs();
                processedCount = 0;
                totalProcessedMs = 0;
                currentJobProgress = null;
            };

            const beginGreetSession = (reason = '') => {
                const session = tools.startGreetSession(true, lastBackendRunId);
                resetProgress();
                if (reason) {
                    logger.add(`本轮打招呼计数已重置: ${reason}`);
                }
                return session;
            };

            const ensureSessionForBackendRun = async (backendRunId, reason = '') => {
                if (!backendRunId) return tools.getGreetSession();
                const session = tools.getGreetSession();
                const legacyOrDifferentRun = !session.backendRunId || session.backendRunId !== backendRunId;
                if (!legacyOrDifferentRun && session.runId && !session.ended) {
                    return session;
                }
                const previous = { ...session };
                const next = tools.startGreetSession(true, backendRunId);
                preferredFeedsDone = false;
                feedTabs = [];
                currentFeedTabIndex = -1;
                currentFeedTabName = '';
                feedTabProcessedCount = 0;
                localStorage.removeItem(preferredFeedStateKey);
                resetProgress();
                const message = `本轮计数已按后端运行重置: ${previous.count || 0} -> 0`;
                logger.add(message);
                await api.event('session_counter_reset', message, 'script', 'info', {
                    reason: reason || 'backend_run_changed',
                    previousRunId: previous.runId || '',
                    previousBackendRunId: previous.backendRunId || '',
                    backendRunId,
                    previousCount: previous.count || 0,
                    newRunId: next.runId,
                });
                return next;
            };

            const beginJobProgress = (href) => {
                currentJobProgress = {
                    href,
                    startedAt: nowMs(),
                };
            };

            const finishJobProgress = (label = '') => {
                if (!currentJobProgress) return;
                const jobMs = Math.max(0, nowMs() - currentJobProgress.startedAt);
                processedCount += 1;
                totalProcessedMs += jobMs;
                const jobSeconds = Math.round(jobMs / 1000);
                const averageSeconds = Math.round(totalProcessedMs / processedCount / 1000);
                const totalSeconds = Math.round((nowMs() - (runStartedAt || currentJobProgress.startedAt)) / 1000);
                const remaining = jobHrefs.length;
                const total = processedCount + remaining;
                const suffix = label ? `，${label}` : '';
                logger.add(`[进度] 已处理 ${processedCount}/${total}，剩余 ${remaining}，本岗位 ${jobSeconds}s，平均 ${averageSeconds}s，累计 ${convertTime(totalSeconds)}${suffix}`);
                if (pageFailureRetryCount > 0 && !label.includes('页面元素异常') && !label.includes('页面兼容失败')) {
                    pageFailureRetryCount = 0;
                    clearPageFailureState();
                }
                currentJobProgress = null;
            };

            const syncControlFromBackend = async (action = '') => {
                const isCooling = Boolean(cooldownUntil && Date.now() < cooldownUntil);
                const res = await api.heartbeat(
                    'search',
                    this.pause ? 'paused' : (isCooling ? 'cooldown' : 'running'),
                    action || getSearchAction(),
                    scriptHeartbeatDetail()
                );
                applyBackendConfig(res.config);
                lastBackendRunId = res.run_id || lastBackendRunId;
                const previousControl = lastBackendControl;
                lastBackendControl = res.control || lastBackendControl;
                if (res.offline) {
                    noteBackendOffline('后端未连接：请确认 python main.py 正在运行，端口为 33333，并重新保存油猴脚本权限');
                    logger.setPaused(true);
                    this.pause = true;
                    return false;
                }
                noteBackendOnline();
                if (res.should_stop || res.control === 'stopped') {
                    if (!this.pause) logger.add('CLI 已停止自动化');
                    tools.endGreetSession();
                    releaseSearchLease();
                    logger.setPaused(true);
                    this.pause = true;
                    return false;
                }
                if (res.should_pause || res.control === 'paused') {
                    if (!this.pause) logger.add('CLI 已暂停自动化');
                    releaseSearchLease();
                    logger.setPaused(true);
                    this.pause = true;
                    return false;
                }
                if (res.should_start || res.control === 'running') {
                    await ensureSessionForBackendRun(lastBackendRunId, previousControl === 'stopped' ? 'stopped_to_running' : 'backend_running');
                    const session = tools.getGreetSession();
                    if (!session.runId || session.ended || previousControl === 'stopped') {
                        beginGreetSession(previousControl === 'stopped' ? '停止后重新开始' : '开始新一轮');
                    }
                    if (this.pause) logger.add('CLI 已允许开始/继续运行');
                    logger.setPaused(false);
                    this.pause = false;
                    return true;
                }
                return !this.pause;
            };

            const handleBackendUnavailable = async (reason, sourcePage = 'search') => {
                const message = `后端不可用，脚本已暂停: ${reason}`;
                console.warn(message);
                logger.add(message);
                setSearchAction(message);
                this.pause = true;
                started = false;
                booting = false;
                logger.setPaused(true);
                finishGreetingWait();
                finishJobProgress('后端不可用暂停');
                releaseSearchLease();
                noteBackendOffline(message);
                await api.event('backend_unavailable_pause', message, 'script', 'error', {
                    reason: String(reason || ''),
                    sourcePage,
                    pageInstanceId: PAGE_INSTANCE_ID,
                    action: getSearchAction(),
                }).catch(() => null);
                await api.heartbeat('search', 'error', message, scriptHeartbeatDetail()).catch(() => null);
                return true;
            };

            setInterval(async () => {
                if (await syncControlFromBackend()) {
                    if (!(await ensureSearchLease('定时运行检查'))) return;
                    if (!started && !booting) {
                        main();
                    } else if (
                        started
                        && !booting
                        && !waitingForGreeting
                        && !cooldownResumeRedirecting
                        && !(cooldownUntil && Date.now() < cooldownUntil)
                    ) {
                        loop();
                    }
                }
            }, 3000);

            const startGreetingWait = (jobInfo, href, requestId, attempt = 1) => {
                waitingForGreeting = true;
                const transactionRunId = lastBackendRunId || tools.getGreetSession().backendRunId || tools.getGreetSession().runId;
                activeGreetingJob = {
                    jobInfo,
                    href,
                    requestId,
                    transactionRunId,
                    attempt: Math.max(1, Number(attempt || 1)),
                    maxAttempts: Math.max(1, Number(OPTIONS.greetMaxAttempts || 3)),
                };
                if (greetTimeoutId) clearTimeout(greetTimeoutId);
                greetTimeoutId = setTimeout(async () => {
                    if (!waitingForGreeting) return;
                    await handleGreetingResult({
                        success: false,
                        error: 'greet_window_timeout',
                        failureCode: 'greet_timeout',
                        retryable: true,
                        attempt: Math.max(1, Number(attempt || 1)),
                        requestId,
                    });
                    return;
                }, 120000);
            };

            const finishGreetingWait = (requestId = '', { preserveTempTab = false } = {}) => {
                waitingForGreeting = false;
                if (greetTimeoutId) {
                    clearTimeout(greetTimeoutId);
                    greetTimeoutId = null;
                }
                if (!preserveTempTab) closeActiveTempTab();
                else activeTempTab = null;
                tools.clearGreetContext(requestId);
                activeGreetingJob = null;
            };

            const confirmQuotaReminderIfPresent = async (sourcePage = 'search') => {
                const result = await tools.confirmQuotaReminderDialog();
                if (!result) return false;
                const level = result.confirmed ? 'info' : 'error';
                const message = result.confirmed
                    ? `BOSS 温馨提示已确认，继续执行: ${result.text}`
                    : `BOSS 温馨提示确认失败，已暂停: ${result.text}`;
                logger.add(message);
                setSearchAction(message);
                await api.event(
                    result.confirmed ? 'quota_reminder_confirmed' : 'quota_reminder_confirm_failed',
                    message,
                    'script',
                    level,
                    { sourcePage, text: result.text, button: result.button, dialog: result.dialog }
                );
                if (!result.confirmed) {
                    this.pause = true;
                    logger.setPaused(true);
                    await api.control('pause').catch(() => null);
                    lastBackendControl = 'paused';
                    throw new Error('quota_reminder_confirm_failed');
                }
                return true;
            };

            const waitForQuotaReminderConfirmation = async (sourcePage = 'search', timeout = 3000) => {
                const deadline = Date.now() + timeout;
                while (Date.now() < deadline) {
                    if (await confirmQuotaReminderIfPresent(sourcePage)) return true;
                    await tools.asyncSleep(250);
                }
                return false;
            };

            const isNonRetryableGreetingError = (error) => {
                const text = String(error || '');
                return tools.isPlatformLimitError(text)
                    || tools.isManualInterruptionError(text)
                    || text.includes('未启用打招呼用语')
                    || text.includes('缺少聊天页地址')
                    || text.includes('缺少打招呼')
                    || text.includes('浏览器拦截');
            };

            const handleGreetingResult = async (data = {}) => {
                const active = activeGreetingJob || {};
                const requestId = data.greetRequestId || data.requestId || active.requestId || '';
                if (active.requestId && requestId && requestId !== active.requestId) {
                    await api.event('greet_result_stale', `忽略过期打招呼结果: ${requestId}`, 'script', 'info', {
                        activeRequestId: active.requestId,
                        requestId,
                    });
                    return;
                }

                const jobInfo = active.jobInfo || {};
                const href = active.href || jobInfo.url || '';
                const transactionRunId = active.transactionRunId || lastBackendRunId || tools.getGreetSession().backendRunId || tools.getGreetSession().runId;
                const attempt = Math.max(1, Number(data.attempt || active.attempt || 1));
                const maxAttempts = Math.max(1, Number(active.maxAttempts || OPTIONS.greetMaxAttempts || 3));
                const error = String(data.error || data.failureCode || 'greet_failed');

                if (data.success) {
                    tools.updateGreetTransaction(transactionRunId, href, 'confirmed', {
                        requestId,
                        attempt,
                        confirmedAt: Date.now(),
                    });
                    const count = Number(data.sessionGreetCount || tools.getSessionGreetCount());
                    const dailyCount = Number(data.dailyGreetCount || tools.getDailyGreetCount());
                    logger.add(`打招呼成功，本轮计数 ${count}，今日计数 ${dailyCount}`);
                    finishGreetingWait(requestId);
                    finishJobProgress('打招呼成功');
                    if (await markPreferredFeedJobHandled('打招呼成功')) return;
                    loop();
                    return;
                }

                const retryable = data.retryable !== false && !isNonRetryableGreetingError(error);
                const canRetry = retryable && jobInfo && jobInfo.chatUrl && attempt < maxAttempts;
                logger.add(`打招呼失败 ${attempt}/${maxAttempts}${error ? ': ' + error : ''}`);

                const transaction = tools.getGreetTransaction(transactionRunId, href);
                const deliveryUnknown = data.deliveryUnknown === true
                    || error.includes('greet_delivery_unknown')
                    || ['send_clicked', 'unknown'].includes(String(transaction.state || ''));
                if (deliveryUnknown) {
                    tools.updateGreetTransaction(transactionRunId, href, 'unknown', {
                        requestId,
                        attempt,
                        error,
                    });
                    finishGreetingWait(requestId);
                    finishJobProgress('发送结果未知，跳过');
                    const message = `打招呼发送结果无法确认，已跳过当前岗位并继续: ${jobInfo.title || href}`;
                    logger.add(message);
                    setSearchAction(message);
                    await api.event('greet_delivery_unknown', message, 'script', 'warning', {
                        title: jobInfo.title || '',
                        url: href,
                        requestId,
                        attempt,
                        error,
                    });
                    await api.heartbeat('search', 'running', message, scriptHeartbeatDetail());
                    if (await markPreferredFeedJobHandled('发送结果未知跳过')) return;
                    loop();
                    return;
                }

                if (data.pauseRequired === true) {
                    tools.updateGreetTransaction(transactionRunId, href, 'failed', {
                        requestId,
                        attempt,
                        error,
                    });
                    finishGreetingWait(requestId, { preserveTempTab: data.preservePage === true });
                    finishJobProgress('页面身份异常，已暂停');
                    const message = `打招呼页面无法可靠确认，已暂停且不会重试: ${jobInfo.title || href}`;
                    logger.add(message);
                    setSearchAction(message);
                    await api.event('greet_page_identity_failed', message, 'script', 'error', {
                        title: jobInfo.title || '',
                        url: href,
                        requestId,
                        error,
                    });
                    this.pause = true;
                    logger.setPaused(true);
                    await api.control('pause').catch(() => null);
                    lastBackendControl = 'paused';
                    return;
                }

                if (tools.isPlatformLimitError(error)) {
                    finishGreetingWait(requestId);
                    finishJobProgress('平台限制');
                    await handlePageFailure(tools.platformLimitReason(error), 'platform_limit', 'chat_greet');
                    return;
                }
                if (tools.isManualInterruptionError(error)) {
                    finishGreetingWait(requestId);
                    finishJobProgress('需要人工处理');
                    await handleManualInterruption(tools.manualInterruptionReason(error), 'chat_greet');
                    return;
                }

                if (canRetry) {
                    const nextAttempt = attempt + 1;
                    const delay = Number((OPTIONS.greetRetryDelays || [0, 3000, 8000])[nextAttempt - 1] || 3000);
                    finishGreetingWait(requestId);
                    logger.add(`准备第 ${nextAttempt}/${maxAttempts} 次打招呼重试: ${jobInfo.title || ''}`);
                    await api.event('greet_retry_scheduled', `准备第 ${nextAttempt}/${maxAttempts} 次打招呼重试: ${jobInfo.title || ''}`, 'script', 'warning', {
                        title: jobInfo.title || '',
                        error,
                        attempt,
                        nextAttempt,
                        maxAttempts,
                        requestId,
                    });
                    setTimeout(() => {
                        openGreetingChat(jobInfo, href, `retry_after_${error}`, nextAttempt).catch(async (retryError) => {
                            await handleGreetingResult({
                                success: false,
                                error: String(retryError),
                                failureCode: 'greet_retry_open_failed',
                                retryable: !isNonRetryableGreetingError(retryError),
                                attempt: nextAttempt,
                            });
                        });
                    }, delay);
                    return;
                }

                finishGreetingWait(requestId);
                tools.updateGreetTransaction(transactionRunId, href, 'failed', {
                    requestId,
                    attempt,
                    error,
                });
                await api.event('greet_failed_final', `打招呼最终失败: ${jobInfo.title || ''} / ${error}`, 'script', 'error', {
                    title: jobInfo.title || '',
                    error,
                    attempt,
                    maxAttempts,
                    requestId,
                });
                finishJobProgress('打招呼最终失败，已暂停');
                const message = `打招呼连续 ${maxAttempts} 次失败，系统已暂停: ${jobInfo.title || href}`;
                logger.add(message);
                setSearchAction(message);
                await api.heartbeat('search', 'paused', message, scriptHeartbeatDetail());
                this.pause = true;
                logger.setPaused(true);
                await api.control('pause').catch(() => null);
                lastBackendControl = 'paused';
            };

            const handlePageFailure = async (reason, kind = 'element_retry', sourcePage = 'search') => {
                const finalReason = reason || '未知页面失败';
                const isPlatformLimit = kind === 'platform_limit';
                if (isPlatformLimit) {
                    const message = `平台额度或次数提醒，自动化已停止: ${finalReason}`;
                    pageFailureRetryCount = 0;
                    clearPageFailureState();
                    jobHrefs = [];
                    elsLen = 0;
                    page = 0;
                    lastJobListEventKey = '';
                    if (currentJobProgress) {
                        finishJobProgress('平台额度提醒');
                    }
                    tools.endGreetSession();
                    this.pause = true;
                    logger.setPaused(true);
                    logger.add(message);
                    setSearchAction(message);
                    await api.event('platform_quota_stop', message, 'script', 'error', {
                        reason: finalReason,
                        sourcePage,
                        dailyGreetCount: tools.getDailyGreetCount(),
                    });
                    await api.heartbeat('search', 'error', message, {
                        ...scriptHeartbeatDetail(),
                        reason: finalReason,
                        sourcePage,
                    });
                    try {
                        await api.control('stop');
                    } catch (e) {
                        await api.event('platform_quota_stop_failed', `平台额度提醒停止通知失败: ${e}`, 'script', 'error', {
                            reason: finalReason,
                            sourcePage,
                        });
                    }
                    lastBackendControl = 'stopped';
                    return true;
                }
                const failureSignature = `${sourcePage}:${String(finalReason).toLowerCase().replace(/\d+/g, '#').slice(0, 160)}`;
                const previousFailure = loadPageFailureState();
                const isSameRecentFailure = previousFailure.signature === failureSignature
                    && Date.now() - Number(previousFailure.timestamp || 0) <= 5 * 60 * 1000;
                pageFailureRetryCount = isSameRecentFailure ? Number(previousFailure.retryCount || 0) + 1 : 1;
                savePageFailureState({ signature: failureSignature, retryCount: pageFailureRetryCount });
                const hadActiveJob = Boolean(currentJobProgress);
                const message = hadActiveJob
                    ? `当前岗位页面元素异常，已跳过且不刷新搜索页: ${finalReason}`
                    : `当前来源页面元素异常，已切换来源且不刷新恢复: ${finalReason}`;
                logger.add(message);
                setSearchAction(message);
                await api.event('element_failure_skipped', message, 'script', 'warning', {
                    reason: finalReason,
                    consecutiveCount: pageFailureRetryCount,
                    sourcePage,
                    jobSource: currentJobSource,
                    currentFeedTabName,
                    currentTagIndex: currentTagIdx,
                });
                await api.heartbeat('search', 'running', message, {
                    ...scriptHeartbeatDetail(),
                    reason: finalReason,
                    sourcePage,
                });
                if (pageFailureRetryCount >= 3) {
                    const pauseMessage = `同类关键页面元素连续失败 ${pageFailureRetryCount} 次，已暂停且不会刷新: ${finalReason}`;
                    this.pause = true;
                    logger.setPaused(true);
                    logger.add(pauseMessage);
                    setSearchAction(pauseMessage);
                    if (currentJobProgress) finishJobProgress('连续页面兼容失败，已暂停');
                    await api.event('element_compatibility_pause', pauseMessage, 'script', 'error', {
                        reason: finalReason,
                        signature: failureSignature,
                        consecutiveCount: pageFailureRetryCount,
                        sourcePage,
                    });
                    await api.heartbeat('search', 'error', pauseMessage, scriptHeartbeatDetail());
                    await api.control('pause').catch(() => null);
                    lastBackendControl = 'paused';
                    return true;
                }
                if (hadActiveJob) {
                    finishJobProgress('页面元素异常跳过');
                    if (await markPreferredFeedJobHandled('页面元素异常跳过')) return true;
                    setTimeout(loop, OPTIONS.actionDelayMs);
                    return true;
                }
                resetKeywordState();
                if (currentJobSource === 'preferred_feed') {
                    await switchToNextPreferredFeedTab('当前推荐源页面元素异常');
                    return true;
                }
                markCurrentTagChecked();
                const moved = await switchToNextKeyword('当前关键词页面元素异常');
                if (!moved) await enterSearchCooldown('本轮关键词页面兼容失败');
                else setTimeout(loop, 0);
                return true;
            };

            const handleManualInterruption = async (reason, sourcePage = 'search') => {
                const finalReason = reason || '未知人工校验';
                jobHrefs = [];
                elsLen = 0;
                page = 0;
                lastJobListEventKey = '';
                if (currentJobProgress) {
                    finishJobProgress('需要人工处理');
                }
                const message = `检测到登录或安全验证，已暂停并保留当前页面: ${finalReason}`;
                this.pause = true;
                logger.setPaused(true);
                logger.add(message);
                setSearchAction(message);
                await api.event('manual_intervention_required', message, 'script', 'error', {
                    reason: finalReason,
                    sourcePage,
                });
                await api.heartbeat('search', 'error', message, {
                    ...scriptHeartbeatDetail(),
                    reason: finalReason,
                    sourcePage,
                });
                try {
                    await api.control('pause');
                } catch (e) {
                    await api.event('manual_intervention_pause_failed', `人工校验暂停通知失败: ${e}`, 'script', 'error', {
                        reason: finalReason,
                    });
                }
                lastBackendControl = 'paused';
                return false;
            };

            // 开始广播
            const startBroadcast = () => {
                this.__broadcast(this.targets.search);
                // 接收聊天页的消息提醒
                this.broadcast.on(this.bcTypes.STATUS, (from, data) => {
                    if (from === this.targets.chat) {
                        logger.add(data);
                    }
                });
                // 发送自我介绍
                this.broadcast.on(this.bcTypes.INTRODUCE, (from, data) => {
                    this.broadcast.reply(
                        from,
                        this.bcTypes.INTRODUCE,
                        { introduce: this.introduce },
                        data.requestId,
                        data.responseType
                    );
                });
                // 分割线
                this.broadcast.on(this.bcTypes.DIVIDER, () => {
                    logger.divider();
                });
                // 监听打招呼
                greetListener();
                // 监听聊天页
                // 心跳监听
                heartBeatListener();
            };

            // 执行搜索
            const search = async (kw) => {
                try {
                    setSearchAction(`搜索关键词: ${kw}`);
                    await confirmQuotaReminderIfPresent('keyword_search');
                    const platformLimit = tools.detectPlatformLimit();
                    if (platformLimit) {
                        throw new Error(`平台次数限制: ${platformLimit}`);
                    }
                    const interruption = tools.detectManualInterruption();
                    if (interruption) {
                        throw new Error(`需要人工处理: ${interruption}`);
                    }
                    await api.event('search_started', `开始搜索关键词: ${kw}`, 'script', 'info', { keyword: kw });
                    const input = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.SEARCHINPUT);
                    const btn = await tools.endlessFind(SELECTORS.ZHIPIN.SEARCH.SEARCHBTN);
                    tools.inputText(input, kw);
                    btn.click();
                    await api.event('search_finished', `搜索已提交: ${kw}`, 'script', 'info', { keyword: kw });
                } catch (e) {
                    if (tools.isManualInterruptionError(e)) throw e;
                    if (tools.isPlatformLimitError(e)) throw e;
                    logger.add('搜索出错');
                    await api.event('search_failed', `搜索出错: ${e}`, 'script', 'error', { keyword: kw });
                    throw new Error('搜索出错');
                }
            };

            // 获取职位链接
            const searchResultScrollDelayMs = () => 3000 + Math.floor(Math.random() * 2000);

            const jobLinkSelector = () => SELECTORS.ZHIPIN.SEARCH.JOBHREFS_CANDIDATES.join(',');

            const elementDescriptorText = (el) => `${el?.id || ''} ${el?.className || ''} ${el?.getAttribute?.('role') || ''}`;

            const jobLinkCount = (el) => el?.querySelectorAll?.(jobLinkSelector()).length || 0;

            const jobCardCount = (el) => el?.querySelectorAll?.('[class*="job-card"], [class*="jobCard"], [class*="job-item"], [class*="jobItem"]').length || 0;

            const isJobSeekerOverlay = (el) => Boolean(el?.closest?.('[data-job-seeker-overlay="1"]'));

            const isFilterLikeContainer = (el) => {
                const descriptor = elementDescriptorText(el);
                return /filter|dropdown|select|condition|salary|degree|experience|industry/i.test(descriptor);
            };

            const isDetailLikeContainer = (el) => {
                const descriptor = elementDescriptorText(el);
                return /job[-_ ]?detail|detail[-_ ]?container|job[-_ ]?banner|job[-_ ]?sec|company|chat/i.test(descriptor);
            };

            const isLikelyLeftJobArea = (el) => {
                if (!el || el === document.body || el === document.documentElement) return false;
                const rect = el.getBoundingClientRect();
                if (rect.width < 180 || rect.height < 180) return false;
                if (rect.left > window.innerWidth * 0.72) return false;
                if (rect.bottom < 120 || rect.top > window.innerHeight - 120) return false;
                return true;
            };

            const elementHasJobSignal = (el) => {
                if (!el) return false;
                const descriptor = elementDescriptorText(el);
                const hasJobLinks = jobLinkCount(el) >= 2;
                const hasJobCard = jobCardCount(el) >= 2;
                const classSignal = /job[-_ ]?(list|result|recommend|rec|card)|recommend[-_ ]?list|rec[-_ ]?job|list|card/i.test(descriptor);
                return hasJobLinks || hasJobCard || classSignal;
            };

            const pageHasJobSignal = () => jobLinkCount(document) >= 1 || jobCardCount(document) >= 1;

            const documentScrollRoot = () => document.scrollingElement || document.documentElement || document.body;

            const isDocumentScrollTarget = (el) => {
                const root = documentScrollRoot();
                return Boolean(el && (el === root || el === document.documentElement || el === document.body));
            };

            const documentScrollFallbackAllowed = () => {
                const root = documentScrollRoot();
                if (!root) return false;
                const viewportHeight = Math.max(window.innerHeight || 0, root.clientHeight || 0);
                return tools.documentScrollFallbackEligible({
                    path: location.pathname,
                    jobLinkCount: jobLinkCount(document),
                    jobCardCount: jobCardCount(document),
                    scrollHeight: root.scrollHeight,
                    clientHeight: viewportHeight,
                    riskBlocked: Boolean(tools.detectPlatformLimit() || tools.detectManualInterruption()),
                });
            };

            const scrollPosition = (target) => (
                isDocumentScrollTarget(target)
                    ? Math.max(window.scrollY || 0, documentScrollRoot()?.scrollTop || 0)
                    : Number(target?.scrollTop || 0)
            );

            const scrollViewportHeight = (target) => (
                isDocumentScrollTarget(target)
                    ? Math.max(window.innerHeight || 0, documentScrollRoot()?.clientHeight || 0)
                    : Number(target?.clientHeight || 0)
            );

            const scrollContentHeight = (target) => (
                isDocumentScrollTarget(target)
                    ? Number(documentScrollRoot()?.scrollHeight || 0)
                    : Number(target?.scrollHeight || 0)
            );

            const scrollTargetMode = (target) => isDocumentScrollTarget(target) ? 'document' : 'element';

            const setScrollPosition = (target, top) => {
                const safeTop = Math.max(0, Number(top || 0));
                if (isDocumentScrollTarget(target)) {
                    try {
                        window.scrollTo({ top: safeTop, left: 0, behavior: 'auto' });
                    } catch (e) {
                        try { window.scrollTo(0, safeTop); } catch (ignore) {}
                    }
                    const root = documentScrollRoot();
                    if (root) root.scrollTop = safeTop;
                    return;
                }
                target.scrollTop = safeTop;
            };

            const resetSearchScrollPosition = () => {
                setScrollPosition(documentScrollRoot(), 0);
                for (const selector of SELECTORS.ZHIPIN.SEARCH.JOB_SCROLL_CANDIDATES) {
                    document.querySelectorAll(selector).forEach((el) => {
                        if (isScrollableJobContainer(el)) setScrollPosition(el, 0);
                    });
                }
                scrollMode = 'none';
                scrollTarget = '';
                scrollRound = 0;
                lastScrollOutcome = 'source_reset';
                scrollBefore = 0;
                scrollAfter = 0;
                scrollJobCountBefore = jobLinkCount(document);
                scrollJobCountAfter = scrollJobCountBefore;
            };

            const visibleJobSignalBounds = () => {
                const nodes = Array.from(document.querySelectorAll(`${jobLinkSelector()}, [class*="job-card"], [class*="jobCard"], [class*="job-item"], [class*="jobItem"]`))
                    .filter(node => tools.isVisible(node))
                    .slice(0, 20);
                if (!nodes.length) return null;
                const rects = nodes
                    .map(node => node.getBoundingClientRect())
                    .filter(rect => rect.width > 20 && rect.height > 20);
                if (!rects.length) return null;
                return rects.reduce((acc, rect) => ({
                    left: Math.min(acc.left, rect.left),
                    top: Math.min(acc.top, rect.top),
                    right: Math.max(acc.right, rect.right),
                    bottom: Math.max(acc.bottom, rect.bottom),
                }), {
                    left: rects[0].left,
                    top: rects[0].top,
                    right: rects[0].right,
                    bottom: rects[0].bottom,
                });
            };

            const overlapsJobSignalArea = (el) => {
                const bounds = visibleJobSignalBounds();
                if (!bounds || !el) return false;
                const rect = el.getBoundingClientRect();
                return rect.left <= bounds.right + 40
                    && rect.right >= bounds.left - 40
                    && rect.top <= bounds.bottom + 80
                    && rect.bottom >= bounds.top - 80;
            };

            const isLeftScrollableGeometryFallback = (el) => {
                if (!el || el === document.body || el === document.documentElement) return false;
                if (isJobSeekerOverlay(el) || isFilterLikeContainer(el) || isDetailLikeContainer(el)) return false;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                const canScroll = el.scrollHeight > el.clientHeight + 40;
                const overflowY = `${style.overflowY || ''} ${style.overflow || ''}`;
                const allowsScroll = /(auto|scroll|overlay)/i.test(overflowY);
                const leftColumn = rect.left < window.innerWidth * 0.42
                    && rect.width >= 240
                    && rect.width <= Math.max(520, window.innerWidth * 0.45)
                    && rect.height >= 300;
                return canScroll && allowsScroll && leftColumn && pageHasJobSignal() && overlapsJobSignalArea(el);
            };

            const nearestScrollableAncestor = (el) => {
                let cursor = el?.parentElement || null;
                while (cursor && cursor !== document.body && cursor !== document.documentElement) {
                    if (isScrollableJobContainer(cursor) || isLeftScrollableGeometryFallback(cursor)) return cursor;
                    cursor = cursor.parentElement;
                }
                return null;
            };

            const jobListRootCandidates = () => {
                const roots = new Set();
                const nodes = Array.from(document.querySelectorAll(`${jobLinkSelector()}, [class*="job-card"], [class*="jobCard"], [class*="job-item"], [class*="jobItem"]`)).slice(0, 24);
                for (const node of nodes) {
                    let cursor = node;
                    for (let depth = 0; cursor && depth < 8 && cursor !== document.body && cursor !== document.documentElement; depth++) {
                        if (!isJobSeekerOverlay(cursor) && !isFilterLikeContainer(cursor) && !isDetailLikeContainer(cursor)) {
                            if (jobLinkCount(cursor) >= 2 || jobCardCount(cursor) >= 2 || isLeftScrollableGeometryFallback(cursor)) {
                                roots.add(cursor);
                            }
                        }
                        const scrollable = nearestScrollableAncestor(cursor);
                        if (scrollable) roots.add(scrollable);
                        cursor = cursor.parentElement;
                    }
                }
                return Array.from(roots);
            };

            const isScrollableJobContainer = (el) => {
                if (!el || el === document.body || el === document.documentElement) return false;
                if (isJobSeekerOverlay(el)) return false;
                if (isFilterLikeContainer(el)) return false;
                if (isDetailLikeContainer(el) && jobLinkCount(el) < 3 && jobCardCount(el) < 3) return false;
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                const overflowY = `${style.overflowY || ''} ${style.overflow || ''}`;
                const allowsScroll = /(auto|scroll|overlay)/i.test(overflowY);
                const canScroll = el.scrollHeight > el.clientHeight + 40;
                const leftScrollableFallback = allowsScroll
                    && pageHasJobSignal()
                    && rect.left < window.innerWidth * 0.5
                    && rect.width <= Math.max(760, window.innerWidth * 0.62)
                    && overlapsJobSignalArea(el);
                return canScroll && isLikelyLeftJobArea(el) && (elementHasJobSignal(el) || leftScrollableFallback || isLeftScrollableGeometryFallback(el));
            };

            const jobContainerScore = (el) => {
                if (!isScrollableJobContainer(el)) return -1;
                const rect = el.getBoundingClientRect();
                const descriptor = elementDescriptorText(el);
                const linkCount = jobLinkCount(el);
                const cardCount = jobCardCount(el);
                let score = 0;
                if (isDetailLikeContainer(el)) score -= 500;
                if (/job[-_ ]?(list|result|recommend|rec|card)|recommend[-_ ]?list|rec[-_ ]?job|list/i.test(descriptor)) score += 220;
                if (linkCount >= 10) score += 260;
                else if (linkCount >= 3) score += 140;
                else if (linkCount > 0) score += 40;
                if (cardCount >= 10) score += 220;
                else if (cardCount >= 3) score += 120;
                else if (cardCount > 0) score += 35;
                if (!linkCount && !cardCount && pageHasJobSignal() && rect.left < window.innerWidth * 0.5) score += 90;
                if (/(auto|scroll|overlay)/i.test(`${window.getComputedStyle(el).overflowY || ''} ${window.getComputedStyle(el).overflow || ''}`)) score += 60;
                if (rect.width >= 240 && rect.width <= 900) score += 80;
                if (rect.height >= 300) score += 40;
                if (rect.left < window.innerWidth * 0.65) score += 30;
                score += Math.min(80, Math.floor((el.scrollHeight - el.clientHeight) / 100));
                return score;
            };

            const jobListFingerprint = (root = document) => {
                const hrefs = Array.from(root.querySelectorAll('a[href*="/job_detail/"]'))
                    .map(node => tools.hrefFromJobNode(node))
                    .map(href => tools.jobIdentityKey(href))
                    .filter(Boolean);
                return `${hrefs.length}:${hrefs.slice(-3).join('|')}`;
            };

            const describeScrollTarget = (el) => {
                if (!el || isDocumentScrollTarget(el)) return 'document.scrollingElement';
                const parts = [el.tagName ? el.tagName.toLowerCase() : 'element'];
                if (el.id) parts.push(`#${el.id}`);
                if (el.className && typeof el.className === 'string') {
                    parts.push(`.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`);
                }
                return parts.join('');
            };

            const scrollCandidateDebug = () => {
                const items = Array.from(document.querySelectorAll('div,section,main,ul,ol'))
                .filter(el => el && el !== document.body && el !== document.documentElement)
                .map(el => {
                    const rect = el.getBoundingClientRect();
                    const style = window.getComputedStyle(el);
                    return {
                        target: describeScrollTarget(el),
                        left: Math.round(rect.left),
                        top: Math.round(rect.top),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        scrollHeight: Math.round(el.scrollHeight || 0),
                        clientHeight: Math.round(el.clientHeight || 0),
                        overflowY: style.overflowY || '',
                        links: jobLinkCount(el),
                        cards: jobCardCount(el),
                        ownOverlay: isJobSeekerOverlay(el),
                        detailLike: isDetailLikeContainer(el),
                        filterLike: isFilterLikeContainer(el),
                        score: jobContainerScore(el),
                    };
                })
                .filter(item => item.scrollHeight > item.clientHeight + 40 || item.links > 0 || item.score >= 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 8);
                const root = documentScrollRoot();
                if (root) {
                    items.unshift({
                        target: 'document.scrollingElement',
                        left: 0,
                        top: Math.round(scrollPosition(root)),
                        width: Math.round(window.innerWidth || root.clientWidth || 0),
                        height: Math.round(scrollViewportHeight(root)),
                        scrollHeight: Math.round(scrollContentHeight(root)),
                        clientHeight: Math.round(scrollViewportHeight(root)),
                        overflowY: window.getComputedStyle(root).overflowY || '',
                        links: jobLinkCount(document),
                        cards: jobCardCount(document),
                        ownOverlay: false,
                        detailLike: false,
                        filterLike: false,
                        score: documentScrollFallbackAllowed() ? 1 : -1,
                    });
                }
                return items.slice(0, 9);
            };

            const findJobListScrollCandidates = () => {
                const candidates = [];
                const pushCandidate = (el) => {
                    if (el && !candidates.includes(el)) candidates.push(el);
                };

                for (const selector of SELECTORS.ZHIPIN.SEARCH.JOB_SCROLL_CANDIDATES) {
                    document.querySelectorAll(selector).forEach(pushCandidate);
                }

                jobListRootCandidates().forEach(pushCandidate);

                const jobAnchors = Array.from(document.querySelectorAll(jobLinkSelector())).slice(0, 8);
                for (const jobLink of jobAnchors) {
                    const scrollable = nearestScrollableAncestor(jobLink);
                    if (scrollable) pushCandidate(scrollable);
                    let cursor = jobLink ? jobLink.parentElement : null;
                    while (cursor && cursor !== document.body && cursor !== document.documentElement) {
                        pushCandidate(cursor);
                        cursor = cursor.parentElement;
                    }
                }

                document.querySelectorAll('div,section,main,ul,ol').forEach((el) => {
                    if (!isLikelyLeftJobArea(el)) return;
                    if (isJobSeekerOverlay(el)) return;
                    if (el.scrollHeight <= el.clientHeight + 40) return;
                    if (!elementHasJobSignal(el)) return;
                    pushCandidate(el);
                });

                if (pageHasJobSignal()) {
                    document.querySelectorAll('div,section,main,ul,ol,[class*="scroll"],[class*="list"],[class*="List"]').forEach((el) => {
                        if (!isLikelyLeftJobArea(el)) return;
                        if (isJobSeekerOverlay(el) || isFilterLikeContainer(el) || isDetailLikeContainer(el)) return;
                        if (el.scrollHeight <= el.clientHeight + 40) return;
                        const style = window.getComputedStyle(el);
                        if (!/(auto|scroll|overlay)/i.test(`${style.overflowY || ''} ${style.overflow || ''}`)) return;
                        pushCandidate(el);
                    });
                    document.querySelectorAll('div,section,main,ul,ol').forEach((el) => {
                        if (isLeftScrollableGeometryFallback(el)) pushCandidate(el);
                    });
                }

                const pointYs = [
                    Math.round(Math.min(window.innerHeight - 80, Math.max(180, window.innerHeight * 0.46))),
                    Math.round(Math.min(window.innerHeight - 80, Math.max(220, window.innerHeight * 0.62))),
                ];
                for (const y of pointYs) {
                    for (const x of [80, 180, 320]) {
                        const elements = typeof document.elementsFromPoint === 'function'
                            ? document.elementsFromPoint(x, y)
                            : [document.elementFromPoint(x, y)].filter(Boolean);
                        elements.forEach((el) => {
                            let cursor = el;
                            for (let depth = 0; cursor && depth < 5 && cursor !== document.body && cursor !== document.documentElement; depth++) {
                                if (
                                    isLikelyLeftJobArea(cursor)
                                    && !isJobSeekerOverlay(cursor)
                                    && !isFilterLikeContainer(cursor)
                                    && !isDetailLikeContainer(cursor)
                                    && cursor.scrollHeight > cursor.clientHeight + 40
                                ) {
                                    pushCandidate(cursor);
                                }
                                cursor = cursor.parentElement;
                            }
                        });
                    }
                }

                for (const candidate of Array.from(candidates)) {
                    let cursor = candidate.parentElement;
                    for (let depth = 0; cursor && depth < 4 && cursor !== document.body && cursor !== document.documentElement; depth++) {
                        pushCandidate(cursor);
                        cursor = cursor.parentElement;
                    }
                }

                const scrollable = candidates
                    .map(el => ({ el, score: jobContainerScore(el) }))
                    .filter(item => item.score >= 0)
                    .sort((a, b) => b.score - a.score);
                if (documentScrollFallbackAllowed()) {
                    const root = documentScrollRoot();
                    if (root && !scrollable.some(item => item.el === root)) {
                        scrollable.push({ el: root, score: 1 });
                    }
                }
                return scrollable.map(item => item.el);
            };

            const findJobListScrollContainer = () => {
                return findJobListScrollCandidates()[0] || null;
            };

            const dispatchJobListWheel = (container, distance) => {
                const documentTarget = isDocumentScrollTarget(container);
                const rect = documentTarget
                    ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
                    : container.getBoundingClientRect();
                const clientX = Math.round(rect.left + Math.min(Math.max(8, rect.width - 8), Math.max(8, rect.width / 2)));
                const clientY = Math.round(rect.top + Math.min(Math.max(8, rect.height - 8), Math.max(8, rect.height * 0.72)));
                const pointTarget = document.elementFromPoint(clientX, clientY);
                const firstJobSignal = documentTarget
                    ? document.querySelector(`${jobLinkSelector()}, [class*="job-card"], [class*="jobCard"], [class*="job-item"], [class*="jobItem"]`)
                    : container.querySelector?.(`${jobLinkSelector()}, [class*="job-card"], [class*="jobCard"], [class*="job-item"], [class*="jobItem"]`);
                const target = pointTarget && (documentTarget || container.contains(pointTarget))
                    ? pointTarget
                    : (firstJobSignal || container);
                const eventInit = {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    deltaY: distance,
                    deltaMode: 0,
                    clientX,
                    clientY,
                };
                try {
                    target.dispatchEvent(new WheelEvent('wheel', eventInit));
                    if (!documentTarget) container.dispatchEvent(new WheelEvent('wheel', eventInit));
                    else window.dispatchEvent(new WheelEvent('wheel', eventInit));
                } catch (e) {
                    // 旧环境不支持 WheelEvent 时，直接滚动仍可作为兜底。
                }
            };

            const performJobListScroll = async (container, distance) => {
                const before = scrollPosition(container);
                const beforeHeight = scrollContentHeight(container);
                const beforeJobCount = jobLinkCount(document);
                const beforeFingerprint = jobListFingerprint(container);
                const beforeDocumentFingerprint = jobListFingerprint(document);
                if (!isDocumentScrollTarget(container)) {
                    try {
                        container.focus?.({ preventScroll: true });
                    } catch (e) {
                        try { container.focus?.(); } catch (ignore) {}
                    }
                }
                dispatchJobListWheel(container, distance);
                const maxScroll = Math.max(0, scrollContentHeight(container) - scrollViewportHeight(container));
                const targetTop = Math.min(maxScroll, before + distance);
                if (isDocumentScrollTarget(container)) {
                    try {
                        window.scrollBy({ top: distance, left: 0, behavior: 'auto' });
                    } catch (e) {
                        try { window.scrollBy(0, distance); } catch (ignore) {}
                    }
                } else if (typeof container.scrollBy === 'function') {
                    container.scrollBy({ top: distance, behavior: 'auto' });
                }
                setScrollPosition(container, targetTop);
                try {
                    const eventTarget = isDocumentScrollTarget(container) ? document : container;
                    eventTarget.dispatchEvent(new Event('scroll', { bubbles: true }));
                } catch (e) {}

                let forcedAgain = false;
                const deadline = Date.now() + 10000;
                let after = scrollPosition(container);
                let afterFingerprint = jobListFingerprint(container);
                let afterDocumentFingerprint = jobListFingerprint(document);
                let afterHeight = scrollContentHeight(container);
                let afterJobCount = jobLinkCount(document);
                let firstMovedAt = 0;
                while (Date.now() < deadline) {
                    await tools.asyncSleep(500);
                    after = scrollPosition(container);
                    afterFingerprint = jobListFingerprint(container);
                    afterDocumentFingerprint = jobListFingerprint(document);
                    afterHeight = scrollContentHeight(container);
                    afterJobCount = jobLinkCount(document);
                    const moved = Math.abs(after - before) >= 5;
                    const changed = afterFingerprint !== beforeFingerprint
                        || afterDocumentFingerprint !== beforeDocumentFingerprint
                        || afterHeight !== beforeHeight
                        || afterJobCount !== beforeJobCount;
                    if (moved && !firstMovedAt) firstMovedAt = Date.now();
                    if (changed) break;
                    if (moved && Date.now() - firstMovedAt >= 2500) break;
                    if (!forcedAgain && Date.now() + 7500 < deadline) {
                        forcedAgain = true;
                        dispatchJobListWheel(container, distance);
                        setScrollPosition(container, targetTop);
                        try {
                            const eventTarget = isDocumentScrollTarget(container) ? document : container;
                            eventTarget.dispatchEvent(new Event('scroll', { bubbles: true }));
                        } catch (e) {}
                    }
                }
                const outcome = tools.scrollMetricsOutcome(
                    {
                        position: before,
                        fingerprint: beforeFingerprint,
                        documentFingerprint: beforeDocumentFingerprint,
                        contentHeight: beforeHeight,
                        jobCount: beforeJobCount,
                    },
                    {
                        position: after,
                        fingerprint: afterFingerprint,
                        documentFingerprint: afterDocumentFingerprint,
                        contentHeight: afterHeight,
                        viewportHeight: scrollViewportHeight(container),
                        jobCount: afterJobCount,
                    }
                );
                return {
                    before,
                    after,
                    beforeFingerprint,
                    afterFingerprint,
                    beforeDocumentFingerprint,
                    afterDocumentFingerprint,
                    beforeHeight,
                    afterHeight,
                    beforeJobCount,
                    afterJobCount,
                    ...outcome,
                };
            };

            const scrollSearchResultsOnce = async (round) => {
                await confirmQuotaReminderIfPresent('search_scroll');
                const platformLimit = tools.detectPlatformLimit();
                if (platformLimit) {
                    throw new Error(`平台次数限制: ${platformLimit}`);
                }
                const interruption = tools.detectManualInterruption();
                if (interruption) {
                    throw new Error(`需要人工处理: ${interruption}`);
                }
                const keyword = currentJobSource === 'preferred_feed'
                    ? (currentFeedTabName || '自定义推荐')
                    : (this.tags[currentTagIdx] || '');
                const discoveredTargets = findJobListScrollCandidates();
                const containers = discoveredTargets.filter(target => !isDocumentScrollTarget(target)).slice(0, 5);
                const documentTarget = discoveredTargets.find(target => isDocumentScrollTarget(target));
                if (documentTarget) containers.push(documentTarget);
                if (!containers.length) {
                    scrollMode = 'none';
                    scrollTarget = '';
                    scrollRound = round;
                    lastScrollOutcome = 'target_missing';
                    await api.event('search_scroll_target_missing', `未找到可验证的左侧岗位列表滚动容器: ${keyword}`, 'script', 'warning', {
                        keyword,
                        source: currentJobSource,
                        round,
                        candidates: scrollCandidateDebug(),
                    });
                    return false;
                }
                const distance = Math.max(420, Math.floor(window.innerHeight * 0.75));
                setSearchAction(`低频滚动读取: ${keyword}`);
                logger.add(`低频滚动读取搜索结果: ${keyword} (${round}/${OPTIONS.searchResultScrollRounds})`);
                const tried = [];
                for (const container of containers) {
                    const mode = scrollTargetMode(container);
                    const targetDetail = {
                        target: describeScrollTarget(container),
                        mode,
                        targetLinks: jobLinkCount(container),
                        targetCards: jobCardCount(container),
                        targetDetailLike: isDetailLikeContainer(container),
                        scrollTop: Math.round(scrollPosition(container)),
                        scrollMax: Math.max(0, Math.round(scrollContentHeight(container) - scrollViewportHeight(container))),
                    };
                    scrollMode = mode;
                    scrollTarget = targetDetail.target;
                    scrollRound = round;
                    scrollBefore = targetDetail.scrollTop;
                    scrollAfter = targetDetail.scrollTop;
                    scrollJobCountBefore = jobLinkCount(document);
                    scrollJobCountAfter = scrollJobCountBefore;
                    lastScrollOutcome = 'target_selected';
                    await api.event('search_scroll_target_selected', `岗位滚动目标: ${mode} / ${targetDetail.target}`, 'script', 'info', {
                        keyword,
                        source: currentJobSource,
                        round,
                        ...targetDetail,
                    });
                    await api.event('search_result_scroll', `低频滚动读取搜索结果: ${keyword}`, 'script', 'info', {
                        keyword,
                        source: currentJobSource,
                        round,
                        maxRounds: OPTIONS.searchResultScrollRounds,
                        searchRoundId,
                        ...targetDetail,
                    });
                    const result = await performJobListScroll(container, distance);
                    const moved = result.moved;
                    const changed = result.changed;
                    tried.push({
                        ...targetDetail,
                        before: result.before,
                        after: result.after,
                        moved,
                        changed,
                        exhausted: result.exhausted,
                    });
                    scrollAfter = Math.round(result.after);
                    scrollJobCountBefore = result.beforeJobCount;
                    scrollJobCountAfter = result.afterJobCount;
                    lastScrollOutcome = changed
                        ? 'jobs_or_height_changed'
                        : (moved ? 'position_moved' : (result.exhausted ? 'exhausted' : 'not_moved'));
                    await api.event('search_result_scroll_verified', `岗位列表滚动验证: ${keyword} / ${moved ? '已移动' : '未移动'} / ${changed ? '列表有变化' : '列表未变化'}`, 'script', moved || changed || result.exhausted ? 'info' : 'warning', {
                        keyword,
                        source: currentJobSource,
                        round,
                        ...targetDetail,
                        before: result.before,
                        after: result.after,
                        maxScroll: Math.max(0, Math.round(scrollContentHeight(container) - scrollViewportHeight(container))),
                        beforeHeight: result.beforeHeight,
                        afterHeight: result.afterHeight,
                        beforeJobCount: result.beforeJobCount,
                        afterJobCount: result.afterJobCount,
                        beforeFingerprint: result.beforeFingerprint,
                        afterFingerprint: result.afterFingerprint,
                        beforeDocumentFingerprint: result.beforeDocumentFingerprint,
                        afterDocumentFingerprint: result.afterDocumentFingerprint,
                        moved,
                        changed,
                        exhausted: result.exhausted,
                    });
                    if (moved || changed) {
                        await tools.asyncSleep(searchResultScrollDelayMs());
                        return true;
                    }
                }
                const exhausted = Boolean(tried.length) && tried.every(item => item.exhausted);
                lastScrollOutcome = exhausted ? 'exhausted' : 'all_targets_failed';
                await api.event(
                    exhausted ? 'search_scroll_exhausted' : 'search_result_scroll_all_targets_failed',
                    exhausted ? `岗位结果已滚动到底: ${keyword}` : `候选岗位列表均未滚动: ${keyword}`,
                    'script',
                    exhausted ? 'info' : 'warning',
                    {
                        keyword,
                        source: currentJobSource,
                        round,
                        tried,
                    }
                );
                return false;
            };

            const isVisibleFeedElement = (el) => {
                if (!el || !document.body.contains(el)) return false;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 8 && rect.height > 8 && rect.bottom > 0 && rect.top < Math.min(window.innerHeight, 460);
            };

            const feedTabText = (el) => tools.normalizeFeedTabText(el?.innerText || el?.textContent || '');

            const feedTabClickable = (el) => (
                el?.closest?.('a,button,[role="tab"],li,[class*="tab"],[class*="Tab"]')
                || el
            );

            const hasFeedTabSemantics = (el) => {
                if (!el) return false;
                const role = String(el.getAttribute?.('role') || '').toLowerCase();
                const descriptor = `${el.className || ''} ${el.parentElement?.className || ''}`;
                return role === 'tab'
                    || /(^|[\s_-])tab([\s_-]|$)/i.test(descriptor)
                    || el.parentElement?.getAttribute?.('role') === 'tablist';
            };

            const isInsideJobResult = (el) => Boolean(
                el?.closest?.('a[href*="/job_detail/"], [href*="/job_detail/"], [class*="job-card"], [class*="jobCard"]')
            );

            const isSelectedFeedTab = (el) => {
                if (!el) return false;
                const nodes = [];
                let node = el;
                for (let depth = 0; node && depth < 4; depth++) {
                    nodes.push(node);
                    node = node.parentElement;
                }
                return nodes.some(node => {
                    const ariaSelected = String(node.getAttribute?.('aria-selected') || '').toLowerCase();
                    const ariaCurrent = String(node.getAttribute?.('aria-current') || '').toLowerCase();
                    const descriptor = `${node.className || ''} ${node.getAttribute?.('class') || ''}`;
                    return ariaSelected === 'true'
                        || ['page', 'true'].includes(ariaCurrent)
                        || node.getAttribute?.('data-selected') === 'true'
                        || node.getAttribute?.('data-active') === 'true'
                        || /(^|[\s_-])(active|selected|checked|current)([\s_-]|$)/i.test(descriptor);
                });
            };

            const clickPreferredFeedElement = async (el) => {
                if (!el || !document.body.contains(el)) return false;
                try {
                    el.scrollIntoView({ block: 'center', inline: 'center' });
                } catch (e) {
                    // scrollIntoView 在少数旧浏览器环境可能不可用，不影响后续点击。
                }
                await tools.asyncSleep(120);
                try {
                    el.focus?.({ preventScroll: true });
                } catch (e) {
                    try { el.focus?.(); } catch (ignore) {}
                }
                const rect = el.getBoundingClientRect();
                const eventInit = {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: Math.round(rect.left + rect.width / 2),
                    clientY: Math.round(rect.top + rect.height / 2),
                    button: 0,
                };
                for (const type of ['mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']) {
                    try {
                        el.dispatchEvent(new MouseEvent(type, eventInit));
                    } catch (e) {
                        // 某些节点不接受合成鼠标事件时，后面仍会走原生 click。
                    }
                }
                try {
                    el.click();
                } catch (e) {
                    return false;
                }
                return true;
            };

            const feedTabCandidate = (el, options = {}) => {
                let clickable = feedTabClickable(el);
                let text = feedTabText(clickable);
                const ownText = feedTabText(el);
                if (
                    tools.isCompositeFeedName(text)
                    && (tools.isSystemFeedName(ownText) || tools.isStrongCustomFeedName(ownText))
                ) {
                    clickable = el;
                    text = ownText;
                }
                if (!text || text.length > 32) return null;
                if (tools.isCompositeFeedName(text)) return null;
                if (!isVisibleFeedElement(clickable)) return null;
                if (isInsideJobResult(clickable)) return null;
                const rect = clickable.getBoundingClientRect();
                if (rect.top > 430 || rect.height > 64) return null;
                const isSystem = tools.isSystemFeedName(text);
                if (!isSystem && !tools.isLikelyCustomFeedName(text)) return null;
                if (!isSystem && !options.allowLoose && !hasFeedTabSemantics(clickable)) return null;
                return {
                    name: text,
                    element: clickable,
                    isSystem,
                    selected: isSelectedFeedTab(clickable),
                    left: Math.round(rect.left),
                    top: Math.round(rect.top),
                };
            };

            const uniqueFeedTabs = (items) => {
                const map = new Map();
                for (const item of items) {
                    if (!item) continue;
                    const key = item.name;
                    const previous = map.get(key);
                    if (!previous || item.top < previous.top || item.left < previous.left) {
                        map.set(key, item);
                    }
                }
                const tabs = Array.from(map.values()).sort((a, b) => (a.top - b.top) || (a.left - b.left));
                return tabs.filter((tab) => {
                    if (tab.isSystem) return true;
                    const name = tools.normalizeFeedTabText(tab.name);
                    const nameHasCitySuffix = /[（(][^）)]{1,10}[）)]$/.test(name);
                    if (nameHasCitySuffix) return true;
                    return !tabs.some((other) => {
                        if (other === tab || other.isSystem) return false;
                        const otherName = tools.normalizeFeedTabText(other.name);
                        return otherName !== name
                            && otherName.startsWith(name)
                            && /[（(][^）)]{1,10}[）)]$/.test(otherName);
                    });
                });
            };

            const likelyFeedContainers = (sourceEls) => {
                const containers = new Set();
                for (const el of sourceEls) {
                    const semantic = hasFeedTabSemantics(feedTabClickable(el));
                    if (!semantic) continue;
                    let container = el;
                    for (let depth = 0; container && depth < 4; depth++) {
                        const rect = container.getBoundingClientRect();
                        const descriptor = `${container.className || ''} ${container.getAttribute?.('role') || ''}`;
                        const hasTabHint = /tab|recommend|feed|job-expect|expect/i.test(descriptor);
                        const plausibleRow = rect.top < 430 && rect.height <= 180 && rect.width >= 80;
                        if (plausibleRow && (hasTabHint || semantic)) {
                            containers.add(container);
                        }
                        container = container.parentElement;
                    }
                }
                return Array.from(containers);
            };

            const discoverPreferredFeedTabs = async () => {
                if (!tools.isPreferredFeedPath() || OPTIONS.preferredFeedMode === 'off') {
                    return { reliable: true, tabs: [], reason: 'preferred_feed_disabled' };
                }
                const sourceEls = Array.from(document.querySelectorAll('a,button,[role="tab"],li,span,div'))
                    .filter(isVisibleFeedElement);
                const systemEls = sourceEls.filter(el => tools.isSystemFeedName(feedTabText(el)));

                const candidates = [];
                for (const systemEl of systemEls.slice(0, 3)) {
                    let container = systemEl;
                    for (let depth = 0; container && depth < 6; depth++) {
                        const rect = container.getBoundingClientRect();
                        if (rect.top < 430 && rect.height <= 220 && rect.width >= 80) {
                            container.querySelectorAll('a,button,[role="tab"],li,span,[class*="tab"],[class*="Tab"]').forEach(el => {
                                candidates.push(feedTabCandidate(el, { allowLoose: true }));
                            });
                        }
                        container = container.parentElement;
                    }
                    candidates.push(feedTabCandidate(systemEl));
                }
                for (const container of likelyFeedContainers(sourceEls)) {
                    container.querySelectorAll('a,button,[role="tab"],li,span,[class*="tab"],[class*="Tab"]').forEach(el => {
                        candidates.push(feedTabCandidate(el));
                    });
                }
                for (const el of sourceEls) {
                    const ownText = feedTabText(el);
                    const clickableText = feedTabText(feedTabClickable(el));
                    if (tools.isStrongCustomFeedName(ownText) || tools.isStrongCustomFeedName(clickableText)) {
                        candidates.push(feedTabCandidate(el, { allowLoose: true }));
                    }
                }

                const allTabs = uniqueFeedTabs(candidates).filter(Boolean);
                const hasSystem = allTabs.some(tab => tab.isSystem);
                const customTabs = allTabs.filter(tab => !tab.isSystem);
                if (!hasSystem && !customTabs.length) {
                    return {
                        reliable: true,
                        tabs: [],
                        reason: 'custom_tabs_not_found',
                        candidates: allTabs.map(tab => tab.name),
                    };
                }
                return {
                    reliable: true,
                    tabs: customTabs,
                    reason: customTabs.length
                        ? (hasSystem ? 'custom_tabs_found' : 'custom_tabs_found_without_system_tab')
                        : 'custom_tabs_not_found',
                    candidates: allTabs.map(tab => tab.name),
                };
            };

            const selectPreferredFeedTab = async (index, options = {}) => {
                const expectedTab = feedTabs[index];
                if (!expectedTab) return false;
                const refreshed = await discoverPreferredFeedTabs();
                const tab = refreshed.reliable
                    ? refreshed.tabs.find(item => item.name === expectedTab.name)
                    : null;
                if (!tab?.element || !document.body.contains(tab.element)) {
                    await api.event('preferred_feed_tab_missing', `推荐源已失效，跳过: ${expectedTab.name}`, 'script', 'warning', {
                        name: expectedTab.name,
                        index,
                        reason: refreshed.reason || 'detached_tab',
                    });
                    return false;
                }
                currentFeedTabIndex = index;
                currentFeedTabName = expectedTab.name;
                const restoredProcessed = Number(options.feedTabProcessedCount);
                feedTabProcessedCount = Number.isFinite(restoredProcessed)
                    ? Math.max(0, Math.floor(restoredProcessed))
                    : 0;
                feedTabMaxJobs = OPTIONS.preferredFeedMaxJobsPerTab;
                savePreferredFeedProgress(options.restore ? 'restoring' : 'switching', {
                    switchReason: options.reason || '',
                });
                setSearchAction(`切换自定义推荐源: ${expectedTab.name}`);
                const startMessage = options.restore
                    ? `恢复处理推荐源: ${expectedTab.name}（已处理 ${feedTabProcessedCount}/${feedTabMaxJobs || '不限'}）`
                    : `开始处理推荐源: ${expectedTab.name}`;
                logger.add(startMessage);
                await api.event('preferred_feed_tab_started', startMessage, 'script', 'info', {
                    name: expectedTab.name,
                    index,
                    total: feedTabs.length,
                    maxJobs: feedTabMaxJobs,
                    processed: feedTabProcessedCount,
                    restored: Boolean(options.restore),
                });
                let beforeFingerprint = jobListFingerprint(document);
                let beforeHref = location.href;
                let selected = isSelectedFeedTab(tab.element);
                let listChanged = false;
                let urlChanged = false;
                let clicked = false;
                let liveTab = tab;
                const maxSwitchAttempts = 3;
                for (let attempt = 1; attempt <= maxSwitchAttempts; attempt++) {
                    const latest = await discoverPreferredFeedTabs();
                    liveTab = latest.tabs?.find(item => item.name === expectedTab.name) || liveTab;
                    if (!liveTab?.element || !document.body.contains(liveTab.element)) {
                        await api.event('preferred_feed_tab_missing_after_retry', `推荐源重试定位失败: ${expectedTab.name}`, 'script', 'warning', {
                            name: expectedTab.name,
                            index,
                            attempt,
                            reason: latest.reason || 'detached_tab',
                        });
                        return false;
                    }
                    selected = Boolean(liveTab.selected || isSelectedFeedTab(liveTab.element));
                    if (!selected) {
                        clicked = await clickPreferredFeedElement(liveTab.element);
                    } else {
                        clicked = true;
                    }
                    const verifyStartedAt = Date.now();
                    while (Date.now() - verifyStartedAt < 5000) {
                        await tools.asyncSleep(350);
                        const verifyResult = await discoverPreferredFeedTabs();
                        liveTab = verifyResult.tabs?.find(item => item.name === expectedTab.name) || liveTab;
                        selected = Boolean(liveTab?.selected || isSelectedFeedTab(liveTab?.element));
                        listChanged = jobListFingerprint(document) !== beforeFingerprint;
                        urlChanged = location.href !== beforeHref;
                        if (selected || listChanged || urlChanged) break;
                    }
                    if (selected || listChanged || urlChanged) break;
                    await api.event('preferred_feed_tab_switch_retry', `推荐源切换未确认，重试 ${attempt}/${maxSwitchAttempts}: ${expectedTab.name}`, 'script', 'warning', {
                        name: expectedTab.name,
                        index,
                        attempt,
                        clicked,
                        beforeFingerprint,
                        currentFingerprint: jobListFingerprint(document),
                    });
                    beforeFingerprint = jobListFingerprint(document);
                    beforeHref = location.href;
                }
                if (!selected && !listChanged && !urlChanged) {
                    await api.event('preferred_feed_tab_switch_assumed', `推荐源已点击但页面未暴露选中态，按目标源继续: ${expectedTab.name}`, 'script', 'warning', {
                        name: expectedTab.name,
                        index,
                        clicked,
                        beforeFingerprint,
                        currentFingerprint: jobListFingerprint(document),
                    });
                }
                resetKeywordState();
                lastJobListEventKey = '';
                currentJobSource = 'preferred_feed';
                savePreferredFeedProgress('active', {
                    selected,
                    listChanged,
                    urlChanged,
                    assumed: !selected && !listChanged && !urlChanged,
                });
                await api.event('preferred_feed_tab_switch_confirmed', `推荐源切换已确认: ${expectedTab.name}`, 'script', 'info', {
                    name: expectedTab.name,
                    index,
                    selected,
                    listChanged,
                    urlChanged,
                    assumed: !selected && !listChanged && !urlChanged,
                });
                resetSearchScrollPosition();
                return true;
            };

            const finishPreferredFeedsAndOpenKeywordSearch = async (reason = '') => {
                preferredFeedsDone = true;
                savePreferredFeedState({
                    done: true,
                    reason,
                    tabs: feedTabs.map(tab => tab.name),
                });
                currentJobSource = 'keyword_search';
                currentFeedTabIndex = -1;
                currentFeedTabName = '';
                feedTabProcessedCount = 0;
                if (cooldownUntil > Date.now()) {
                    savePreferredFeedCooldownState({
                        status: 'done',
                        reason,
                        tabs: feedTabs.map(tab => tab.name),
                    });
                    const cooldownMessage = '冷却期用户推荐源处理完成，继续等待关键词搜索冷却';
                    logger.add(cooldownMessage);
                    await api.event('preferred_feed_cooldown_cycle_finished', cooldownMessage, 'script', 'info', {
                        reason,
                        tabs: feedTabs.map(tab => tab.name),
                        cooldownUntil: new Date(cooldownUntil).toISOString(),
                    });
                    await enterSearchCooldown('冷却期用户推荐源已处理完成', cooldownUntil);
                    return;
                }
                const message = '所有用户推荐源处理完成，进入关键词搜索';
                logger.add(message);
                await api.event('preferred_feed_finished', message, 'script', 'info', {
                    reason,
                    tabs: feedTabs.map(tab => tab.name),
                });
                tools.openTabNSetTimestamp(SEARCHPATH.zhipin, this.targets.search, true);
            };

            const switchToNextPreferredFeedTab = async (reason = '') => {
                if (currentJobSource !== 'preferred_feed') return false;
                let nextIndex = currentFeedTabIndex + 1;
                while (nextIndex < feedTabs.length) {
                    if (currentFeedTabName) {
                        await api.event('preferred_feed_tab_finished', `推荐源 ${currentFeedTabName} 已处理 ${feedTabProcessedCount}/${feedTabMaxJobs || '不限'}，切换下一个推荐源`, 'script', 'info', {
                            name: currentFeedTabName,
                            processed: feedTabProcessedCount,
                            maxJobs: feedTabMaxJobs,
                            reason,
                        });
                    }
                    if (await selectPreferredFeedTab(nextIndex)) return true;
                    nextIndex += 1;
                }
                await finishPreferredFeedsAndOpenKeywordSearch(reason);
                return false;
            };

            const markPreferredFeedJobHandled = async (reason = '') => {
                if (currentJobSource !== 'preferred_feed') return false;
                feedTabProcessedCount += 1;
                savePreferredFeedProgress('active', {
                    lastHandledReason: reason,
                    lastHandledAt: Date.now(),
                });
                if (feedTabMaxJobs > 0 && feedTabProcessedCount >= feedTabMaxJobs) {
                    await api.event('preferred_feed_tab_limit_reached', `推荐源 ${currentFeedTabName} 已处理 ${feedTabProcessedCount}/${feedTabMaxJobs}，切换下一个推荐源`, 'script', 'info', {
                        name: currentFeedTabName,
                        processed: feedTabProcessedCount,
                        maxJobs: feedTabMaxJobs,
                        reason,
                    });
                    await switchToNextPreferredFeedTab('推荐源处理上限已达');
                    return true;
                }
                return false;
            };

            const preparePreferredFeeds = async () => {
                if (!tools.isPreferredFeedPath() || OPTIONS.preferredFeedMode === 'off') return false;
                if (preferredFeedsDone || hasPreferredFeedCompletedForRun()) {
                    preferredFeedsDone = true;
                    currentJobSource = 'keyword_search';
                    currentFeedTabIndex = -1;
                    currentFeedTabName = '';
                    feedTabProcessedCount = 0;
                    const message = '用户推荐源本轮已处理完成，继续关键词搜索';
                    logger.add(message);
                    setSearchAction(message);
                    await api.event('preferred_feed_already_finished', message, 'script', 'info', {
                        runKey: preferredFeedRunKey(),
                    });
                    return false;
                }
                currentJobSource = 'preferred_feed';
                feedSwitchAttempted = true;
                feedSwitchReason = 'discovering_custom_tabs';
                const result = await discoverPreferredFeedTabs();
                if (!result.reliable) {
                    const message = `无法可靠识别用户自定义推荐 Tab，已跳过推荐源并进入关键词搜索: ${result.reason}`;
                    logger.add(message);
                    setSearchAction(message);
                    await api.event('preferred_feed_unreliable', message, 'script', 'warning', {
                        reason: result.reason,
                        candidates: result.candidates || [],
                    });
                    await finishPreferredFeedsAndOpenKeywordSearch(`unreliable:${result.reason}`);
                    return true;
                }
                feedTabs = result.tabs;
                if (!feedTabs.length) {
                    await api.event('preferred_feed_no_custom_tabs', '未发现用户自定义推荐 Tab，进入关键词搜索', 'script', 'info', {
                        reason: result.reason,
                        candidates: result.candidates || [],
                    });
                    logger.add('未发现用户自定义推荐 Tab，进入关键词搜索');
                    await finishPreferredFeedsAndOpenKeywordSearch('no_custom_tabs');
                    return true;
                }
                logger.add(`发现用户自定义推荐 Tab: ${feedTabs.map(tab => tab.name).join('、')}`);
                await api.event('preferred_feed_tabs_found', `发现用户自定义推荐 Tab: ${feedTabs.map(tab => tab.name).join('、')}`, 'script', 'info', {
                    tabs: feedTabs.map(tab => tab.name),
                    reason: result.reason,
                    candidates: result.candidates || [],
                });
                const restored = restorePreferredFeedProgress();
                const startIndex = restored ? restored.index : 0;
                if (restored) {
                    const message = `恢复上次推荐源进度: ${restored.name} / 已处理 ${restored.feedTabProcessedCount}/${OPTIONS.preferredFeedMaxJobsPerTab || '不限'}`;
                    logger.add(message);
                    await api.event('preferred_feed_progress_restored', message, 'script', 'info', {
                        name: restored.name,
                        index: restored.index,
                        processed: restored.feedTabProcessedCount,
                        status: restored.status,
                    });
                }
                if (await selectPreferredFeedTab(startIndex, {
                    restore: Boolean(restored),
                    feedTabProcessedCount: restored?.feedTabProcessedCount || 0,
                    reason: restored ? 'restore_after_refresh' : 'start_first_custom_feed',
                })) return true;
                currentFeedTabIndex = startIndex;
                currentFeedTabName = feedTabs[startIndex]?.name || '';
                return switchToNextPreferredFeedTab(restored ? '恢复推荐源切换失败' : '首个推荐源切换未确认');
            };

            const getJobHrefs = async () => {
                try {
                    setSearchAction('读取职位列表');
                    await confirmQuotaReminderIfPresent('job_list');
                    const platformLimit = tools.detectPlatformLimit();
                    if (platformLimit) {
                        throw new Error(`平台次数限制: ${platformLimit}`);
                    }
                    const interruption = tools.detectManualInterruption();
                    if (interruption) {
                        throw new Error(`需要人工处理: ${interruption}`);
                    }
                    const jobUl = await tools.waitForOne(SELECTORS.ZHIPIN.SEARCH.JOBLIST_CANDIDATES, 15000);
                    const collect = () => {
                        let aList = [];
                        for (const selector of SELECTORS.ZHIPIN.SEARCH.JOBHREFS_CANDIDATES) {
                            aList = Array.from(jobUl.querySelectorAll(selector));
                            if (aList.length) break;
                        }
                        if (!aList.length) {
                            aList = Array.from(document.querySelectorAll('a[href*="/job_detail/"]'));
                        }
                        return Array.from(
                            new Set(Array.from(aList).map(a => tools.hrefFromJobNode(a)).filter(Boolean))
                        );
                    };
                    let hrefs = collect();
                    const unseen = href => {
                        const key = tools.jobIdentityKey(href);
                        return key && !seenJobHrefs.has(key) && !backendProcessedHrefs.has(key);
                    };
                    let newHrefs = hrefs.filter(unseen);
                    const startedAt = Date.now();
                    while (!newHrefs.length && hrefs.length <= elsLen && Date.now() - startedAt < 5000) {
                        await tools.asyncSleep(500);
                        hrefs = collect();
                        newHrefs = hrefs.filter(unseen);
                    }
                    const scrollRounds = Math.max(0, Math.min(20, Number(OPTIONS.searchResultScrollRounds) || 0));
                    const activeKeyword = currentJobSource === 'keyword_search'
                        ? (this.tags[currentTagIdx] || '')
                        : '';
                    const activeSourceLabel = currentJobSource === 'preferred_feed'
                        ? (currentFeedTabName || '自定义推荐')
                        : activeKeyword;
                    let attemptedScrollRounds = 0;
                    let lastScrollWorked = false;
                    for (let scrollRound = 1; !newHrefs.length && scrollRound <= scrollRounds; scrollRound++) {
                        attemptedScrollRounds = scrollRound;
                        lastScrollWorked = await scrollSearchResultsOnce(scrollRound);
                        hrefs = collect();
                        newHrefs = hrefs.filter(unseen);
                        if (!lastScrollWorked) break;
                    }
                    if (!newHrefs.length && scrollRounds > 0 && attemptedScrollRounds >= scrollRounds && lastScrollWorked) {
                        lastScrollOutcome = 'max_rounds_reached';
                        await api.event('search_scroll_round_limit_reached', `岗位滚动已达到 ${scrollRounds} 轮上限`, 'script', 'info', {
                            keyword: activeKeyword,
                            sourceLabel: activeSourceLabel,
                            source: currentJobSource,
                            feedTabName: currentFeedTabName,
                            rounds: attemptedScrollRounds,
                            jobCount: hrefs.length,
                        });
                    }
                    const eventKey = `${hrefs.length}:${newHrefs.length}:${hrefs[hrefs.length - 1] || ''}`;
                    if (eventKey !== lastJobListEventKey) {
                        lastJobListEventKey = eventKey;
                        await api.event('job_list_found', `发现职位链接 ${hrefs.length} 个，新职位 ${newHrefs.length} 个`, 'script', 'info', {
                            count: hrefs.length,
                            newCount: newHrefs.length,
                            source: currentJobSource,
                            feedTabName: currentFeedTabName,
                            keyword: activeKeyword,
                            sourceLabel: activeSourceLabel,
                        });
                    }
                    if (hrefs.length && !newHrefs.length) {
                        const recentlyProcessedCount = hrefs.filter(href => backendProcessedHrefs.has(tools.jobIdentityKey(href))).length;
                        const seenCount = hrefs.filter(href => seenJobHrefs.has(tools.jobIdentityKey(href))).length;
                        await api.event('all_results_recently_processed', '搜索结果已全部处理或近期跳过', 'script', 'info', {
                            keyword: activeKeyword,
                            sourceLabel: activeSourceLabel,
                            source: currentJobSource,
                            feedTabName: currentFeedTabName,
                            count: hrefs.length,
                            recentlyProcessedCount,
                            seenCount,
                            searchRoundId,
                        });
                    }
                    return [newHrefs, hrefs];
                } catch (e) {
                    if (tools.isManualInterruptionError(e)) throw e;
                    if (tools.isPlatformLimitError(e)) throw e;
                    logger.add('获取职位链接出错');
                    await api.event('job_list_failed', `获取职位链接出错: ${e}`, 'script', 'error');
                    throw new Error('获取职位链接出错');
                }
            };

            // 读取当前关键词的职位。没有新职位时只做低频滚动扩展，然后切换关键词。
            const nextPage = async () => {
                let hrefs;
                [jobHrefs, hrefs] = await getJobHrefs();
                elsLen = hrefs.length;
                if (jobHrefs.length > 0) {
                    page++;
                    logger.add(`开始浏览第 ${page} 批`);
                    return true;
                }
                const keyword = this.tags[currentTagIdx] || '';
                const sourceLabel = currentJobSource === 'preferred_feed'
                    ? `推荐源 ${currentFeedTabName || '-'}`
                    : `当前关键词 ${keyword || '-'}`;
                logger.add(`${sourceLabel} 没有新职位`);
                await api.event('job_list_empty', `${sourceLabel} 没有新职位`, 'script', 'info', {
                    page,
                    keyword,
                    source: currentJobSource,
                    feedTabName: currentFeedTabName,
                    knownCount: elsLen,
                });
                return false;
            };

            document.nextPage = nextPage;

            const resetKeywordState = () => {
                jobHrefs = [];
                elsLen = 0;
                page = 0;
                lastJobListEventKey = '';
            };

            const beginSearchRound = async (reason = '', startTagIdx = 0, messageOverride = '') => {
                searchRoundId += 1;
                tagsCheckedThisRound.clear();
                cooldownUntil = 0;
                cooldownStartedEventKey = '';
                cooldownResumeRedirecting = false;
                currentTagIdx = this.tags.length
                    ? Math.min(Math.max(0, Number(startTagIdx) || 0), this.tags.length - 1)
                    : 0;
                resetKeywordState();
                saveSearchRoundState();
                await api.event('search_round_started', messageOverride || `开始第 ${searchRoundId} 轮关键词搜索`, 'script', 'info', {
                    searchRoundId,
                    reason,
                    startTagIdx: currentTagIdx,
                    tags: this.tags,
                    cooldownMinMinutes: OPTIONS.searchRoundCooldownMinMinutes,
                    cooldownMinutes: OPTIONS.searchRoundCooldownMinutes,
                });
            };

            const markCurrentTagChecked = () => {
                if (this.tags[currentTagIdx]) {
                    tagsCheckedThisRound.add(currentTagIdx);
                    saveSearchRoundState();
                }
            };

            const tagSearchDelayMs = () => {
                const minSeconds = Math.max(3, Number(OPTIONS.tagSearchDelaySeconds) || 20);
                const maxSeconds = Math.max(
                    minSeconds,
                    Number(OPTIONS.tagSearchDelayMaxSeconds) || 45,
                );
                const randomSeconds = minSeconds + Math.floor(Math.random() * (maxSeconds - minSeconds + 1));
                return randomSeconds * 1000;
            };

            const waitBeforeTagSearch = async (keyword, reason = '') => {
                const delayMs = tagSearchDelayMs();
                const seconds = Math.round(delayMs / 1000);
                const message = `等待 ${seconds} 秒后搜索关键词: ${keyword}`;
                setSearchAction(message);
                logger.add(message);
                await api.heartbeat('search', 'running', message, {
                    ...scriptHeartbeatDetail(),
                    nextKeyword: keyword,
                    reason,
                    delaySeconds: seconds,
                });
                await tools.asyncSleep(delayMs);
            };

            const searchCurrentKeyword = async (reason = '', waitBefore = false) => {
                const keyword = this.tags[currentTagIdx];
                resetKeywordState();
                if (waitBefore) {
                    await waitBeforeTagSearch(keyword, reason);
                }
                const reserved = reserveSearchSubmission();
                if (!reserved.ok) {
                    await enterSearchCooldown(reserved.state.blockedReason, reserved.state.nextAllowedAt);
                    return false;
                }
                setSearchAction(`搜索关键词: ${keyword}`);
                await search(keyword);
                markCurrentTagChecked();
                await api.event('search_budget_updated', `关键词搜索预算: 本小时 ${reserved.state.hourlyCount}/${reserved.state.hourlyLimit}，今日 ${reserved.state.dailyCount}/${reserved.state.dailyLimit}`, 'script', 'info', {
                    hourlyCount: reserved.state.hourlyCount,
                    hourlyLimit: reserved.state.hourlyLimit,
                    dailyCount: reserved.state.dailyCount,
                    dailyLimit: reserved.state.dailyLimit,
                });
                await tools.actionSleep(1500);
                resetSearchScrollPosition();
                return true;
            };

            const switchToNextKeyword = async (reason = '') => {
                if (!this.tags.length) return false;
                const total = this.tags.length;
                const startTagIdx = currentTagIdx;
                for (let attempt = 1; attempt <= total; attempt++) {
                    const nextTagIdx = (startTagIdx + attempt) % total;
                    if (tagsCheckedThisRound.has(nextTagIdx)) {
                        continue;
                    }
                    currentTagIdx = nextTagIdx;
                    const keyword = this.tags[currentTagIdx];
                    const suffix = reason ? `（${reason}）` : '';
                    logger.add(`切换搜索关键词: ${keyword}${suffix}`);
                    await api.event('keyword_switched', `切换搜索关键词: ${keyword}`, 'script', 'info', {
                        keyword,
                        index: currentTagIdx,
                        wrapped: currentTagIdx === 0,
                        reason,
                        searchRoundId,
                        checkedCount: tagsCheckedThisRound.size,
                    });
                    if (!(await searchCurrentKeyword(reason, true))) return false;
                    if (await nextPage()) {
                        return true;
                    }
                }
                logger.add('所有关键词本轮未发现新职位，进入搜索冷却');
                await api.event('all_keywords_no_new_jobs', '所有关键词本轮未发现新职位，进入搜索冷却', 'script', 'info', {
                    tags: this.tags,
                    seenCount: seenJobHrefs.size,
                    reason,
                    searchRoundId,
                    checkedCount: tagsCheckedThisRound.size,
                });
                return false;
            };

            const cooldownRangeMinutes = () => {
                const maxMinutes = Math.max(1, Number(OPTIONS.searchRoundCooldownMinutes) || 5);
                const minMinutes = Math.max(1, Math.min(maxMinutes, Number(OPTIONS.searchRoundCooldownMinMinutes) || 1));
                return { minMinutes, maxMinutes };
            };

            const chooseRandomCooldownUntil = () => {
                const { minMinutes, maxMinutes } = cooldownRangeMinutes();
                const minutes = minMinutes + Math.floor(Math.random() * (maxMinutes - minMinutes + 1));
                return Date.now() + minutes * 60 * 1000;
            };

            const enterSearchCooldown = async (reason = '', untilOverride = 0) => {
                if (cooldownTimer) {
                    clearTimeout(cooldownTimer);
                    cooldownTimer = null;
                }
                const randomUntil = chooseRandomCooldownUntil();
                const requestedUntil = Number(untilOverride) > Date.now()
                    ? Number(untilOverride)
                    : (cooldownUntil > Date.now() ? cooldownUntil : 0);
                // Even when a search budget says "wait longer", re-check in the configured short random window.
                cooldownUntil = requestedUntil
                    ? Math.min(requestedUntil, randomUntil)
                    : randomUntil;
                saveSearchRoundState();
                const untilText = new Date(cooldownUntil).toLocaleTimeString('zh-CN', { hour12: false });
                const remainingMinutes = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 60000));
                const message = `${reason || '所有关键词本轮暂无新职位'}，冷却约 ${remainingMinutes} 分钟后再搜索（预计 ${untilText}）`;
                const cooldownEventKey = String(Math.floor(cooldownUntil / 1000));
                const alreadyReportedCooldown = cooldownStartedEventKey === cooldownEventKey;
                setSearchAction(message);
                if (!alreadyReportedCooldown) {
                    cooldownStartedEventKey = cooldownEventKey;
                    logger.add(message);
                    await api.event('search_round_cooldown_started', message, 'script', 'info', {
                        reason,
                        searchRoundId,
                        cooldownMinutes: remainingMinutes,
                        cooldownUntil: new Date(cooldownUntil).toISOString(),
                        checkedCount: tagsCheckedThisRound.size,
                    });
                }
                await api.heartbeat('search', 'cooldown', message, scriptHeartbeatDetail());

                if (
                    OPTIONS.preferredFeedMode !== 'off'
                    && !tools.isPreferredFeedPath()
                    && !hasPreferredFeedCooldownCycleStarted()
                ) {
                    savePreferredFeedCooldownState({ status: 'started', reason });
                    preferredFeedsDone = false;
                    feedTabs = [];
                    currentFeedTabIndex = -1;
                    currentFeedTabName = '';
                    feedTabProcessedCount = 0;
                    currentJobSource = 'preferred_feed';
                    localStorage.removeItem(preferredFeedStateKey);
                    const feedMessage = `${message}，冷却期间先补充扫描用户自定义推荐源`;
                    logger.add(feedMessage);
                    setSearchAction(feedMessage);
                    await api.event('preferred_feed_during_search_cooldown', feedMessage, 'script', 'info', {
                        reason,
                        searchRoundId,
                        cooldownUntil: new Date(cooldownUntil).toISOString(),
                    });
                    await api.heartbeat('search', 'cooldown', feedMessage, scriptHeartbeatDetail());
                    tools.openTabNSetTimestamp(SEARCHPATH.preferred, this.targets.search, true);
                    return;
                }

                const cooldownTick = async () => {
                    try {
                        if (!started) {
                            cooldownTimer = null;
                            return;
                        }
                        const remainingMs = cooldownUntil - Date.now();
                        if (remainingMs > 0) {
                            await api.heartbeat('search', 'cooldown', message, {
                                ...scriptHeartbeatDetail(),
                                remainingSeconds: Math.ceil(remainingMs / 1000),
                            });
                            cooldownTimer = setTimeout(cooldownTick, Math.min(30000, remainingMs));
                            return;
                        }
                        if (!tryAcquireCooldownResumeLock()) {
                            cooldownTimer = null;
                            setSearchAction('搜索冷却已到点，等待持有锁的搜索页恢复');
                            await api.heartbeat('search', 'cooldown', '搜索冷却已到点，等待持有锁的搜索页恢复', {
                                ...scriptHeartbeatDetail(),
                                cooldownResumeSkipped: true,
                            });
                            return;
                        }
                        cooldownTimer = null;
                        if (!(await ensureSearchLease('冷却结束'))) {
                            markCooldownResumeDone('lease_failed');
                            return;
                        }
                        if (!(await syncControlFromBackend('搜索冷却结束'))) {
                            markCooldownResumeDone('control_blocked');
                            return;
                        }
                        if (this.pause) {
                            markCooldownResumeDone('paused');
                            return;
                        }
                        if (OPTIONS.preferredFeedMode !== 'off') {
                            await beginSearchRound(
                                'cooldown_finished_preferred_first',
                                0,
                                `搜索冷却结束，准备第 ${searchRoundId + 1} 轮：先处理用户自定义推荐源`,
                            );
                            preferredFeedsDone = false;
                            feedTabs = [];
                            currentFeedTabIndex = -1;
                            currentFeedTabName = '';
                            feedTabProcessedCount = 0;
                            currentJobSource = 'preferred_feed';
                            cooldownResumeRedirecting = true;
                            localStorage.removeItem(preferredFeedStateKey);
                            localStorage.removeItem(preferredFeedCooldownStateKey);
                            await api.event('preferred_feed_after_cooldown_started', '搜索冷却结束，优先处理用户自定义推荐源', 'script', 'info', {
                                searchRoundId,
                                runKey: preferredFeedRunKey(),
                            });
                            await api.heartbeat('search', 'running', '搜索冷却结束，优先处理用户自定义推荐源', scriptHeartbeatDetail());
                            markCooldownResumeDone('redirect_preferred');
                            tools.openTabNSetTimestamp(SEARCHPATH.preferred, this.targets.search, true);
                            return;
                        }
                        await beginSearchRound('cooldown_finished');
                        if (!(await searchCurrentKeyword('冷却结束', false))) return;
                        if (await nextPage()) {
                            setTimeout(loop, 0);
                            return;
                        }
                        const hasNextKeyword = await switchToNextKeyword('冷却后首个关键词无新职位');
                        if (hasNextKeyword) {
                            setTimeout(loop, 0);
                            return;
                        }
                        markCooldownResumeDone('done');
                        await enterSearchCooldown('冷却后仍无新职位');
                    } catch (e) {
                        markCooldownResumeDone('failed');
                        if (tools.isPlatformLimitError(e)) {
                            await handlePageFailure(tools.platformLimitReason(e), 'platform_limit', 'search');
                            return;
                        }
                        if (tools.isManualInterruptionError(e)) {
                            await handleManualInterruption(tools.manualInterruptionReason(e), 'search');
                            return;
                        }
                        logger.add(`搜索冷却结束后恢复失败: ${e}`);
                        await api.event('search_cooldown_resume_failed', `搜索冷却结束后恢复失败: ${e}`, 'script', 'error', {
                            reason,
                            searchRoundId,
                        });
                        setTimeout(loop, OPTIONS.actionDelayMs);
                    }
                };

                cooldownTimer = setTimeout(cooldownTick, Math.min(30000, Math.max(1000, cooldownUntil - Date.now())));
            };

            const extractJobInfoFromDocument = (doc, href, source = 'document') => {
                const chatBtn = tools.findOne(SELECTORS.ZHIPIN.DETAIL.STARTCHAT, doc);
                const title = tools.textOf(SELECTORS.ZHIPIN.DETAIL.JOBNAME_CANDIDATES, doc);
                const salary = tools.textOf(SELECTORS.ZHIPIN.DETAIL.SALARY_CANDIDATES, doc);
                const detail = tools.textOf(SELECTORS.ZHIPIN.DETAIL.DETAIL_CANDIDATES, doc);
                const company = tools.sanitizeCompanyName(
                    tools.textOf(SELECTORS.ZHIPIN.DETAIL.COMPANY_CANDIDATES, doc),
                    title,
                    salary
                );
                const city = tools.textOf(SELECTORS.ZHIPIN.DETAIL.CITY_CANDIDATES, doc);
                const chatUrl = chatBtn && (chatBtn.getAttribute(SELECTORS.ZHIPIN.DETAIL.CHATURL) || chatBtn.getAttribute('href') || chatBtn.dataset.redirectUrl);
                const addUrl = chatBtn && (chatBtn.dataset.url || chatBtn.getAttribute('data-url') || chatBtn.getAttribute('href'));
                const talkedReason = tools.contactedReasonFromElement(chatBtn);
                return {
                    title,
                    salary,
                    detail,
                    company,
                    city,
                    chatUrl: tools.normalUrl(chatUrl),
                    addUrl: tools.normalUrl(addUrl),
                    talked: Boolean(talkedReason),
                    talked_reason: talkedReason,
                    url: href,
                    source,
                };
            };

            const fetchJobInfoFallback = async (href, originalError) => {
                await api.event('job_detail_fetch_fallback_started', `尝试直接解析详情页: ${href}`, 'script', 'info', { url: href, originalError: String(originalError) });
                try {
                    const resp = await fetch(href, { credentials: 'include' });
                    if (!resp.ok) throw new Error(`详情页请求失败: ${resp.status}`);
                    const html = await resp.text();
                    const doc = new DOMParser().parseFromString(html, 'text/html');
                    const interruptionText = doc.body ? doc.body.innerText : '';
                    const platformLimit = tools.detectPlatformLimitText(interruptionText);
                    if (platformLimit) throw new Error(`平台次数限制: ${platformLimit}`);
                    const interruption = tools.detectInterruptionText(interruptionText);
                    if (interruption) throw new Error(`需要人工处理: ${interruption}`);
                    const info = extractJobInfoFromDocument(doc, href, 'fetch_fallback');
                    if (!info.title || !info.detail) throw new Error('详情页 fetch 兜底解析失败：缺少标题或描述');
                    await api.event('job_detail_fetch_fallback_finished', `详情页兜底解析成功: ${info.title}`, 'script', 'info', {
                        url: href,
                        hasAddUrl: Boolean(info.addUrl),
                        hasChatUrl: Boolean(info.chatUrl),
                    });
                    return info;
                } catch (fallbackError) {
                    if (tools.isPlatformLimitError(fallbackError)) {
                        await api.event('job_detail_platform_limit', `详情页触发平台次数限制: ${fallbackError}`, 'script', 'error', { url: href, originalError: String(originalError) });
                        throw fallbackError;
                    }
                    if (tools.isManualInterruptionError(fallbackError)) {
                        await api.event('job_detail_manual_intervention', `详情页需要人工校验: ${fallbackError}`, 'script', 'error', { url: href, originalError: String(originalError) });
                        throw fallbackError;
                    }
                    await api.event('job_detail_fetch_fallback_failed', `详情页兜底解析失败: ${fallbackError}`, 'script', 'error', { url: href, originalError: String(originalError) });
                    throw new Error(`详情页广播失败且兜底解析失败: ${originalError}; ${fallbackError}`);
                }
            };

            // 获取职位信息
            const getJobInfo = async (href) => {
                await confirmQuotaReminderIfPresent('job_detail');
                const platformLimit = tools.detectPlatformLimit();
                if (platformLimit) throw new Error(`平台次数限制: ${platformLimit}`);
                const interruption = tools.detectManualInterruption();
                if (interruption) throw new Error(`需要人工处理: ${interruption}`);
                setSearchAction(`打开职位详情: ${href}`);
                await api.event('job_detail_opened', `打开职位详情: ${href}`, 'script', 'info', { url: href });
                const detailResponse = this.broadcast.receive(this.targets.detail, this.bcTypes.GET_JOB_INFO, OPTIONS.jobInfoResponseTimeout);
                const opened = tools.openTabNSetTimestamp(href, this.targets.detail);
                rememberTempTab(opened);
                setSearchAction(`等待详情页回传职位信息: ${href}`);
                await api.heartbeat('search', 'running', `等待详情页回传职位信息: ${href}`, {
                    ...scriptHeartbeatDetail(),
                    url: href,
                    detailWindowOpened: Boolean(opened),
                    jobInfoResponseTimeout: OPTIONS.jobInfoResponseTimeout,
                });
                let info;
                if (!opened) {
                    detailResponse.catch(() => null);
                    const popupError = new Error('浏览器拦截了职位详情页弹窗');
                    await api.event('job_detail_popup_blocked', `${popupError.message}: ${href}`, 'script', 'error', { url: href });
                    info = await fetchJobInfoFallback(href, popupError);
                } else {
                    try {
                        info = await detailResponse;
                    } catch (e) {
                        if (tools.isManualInterruptionError(e)) throw e;
                        if (tools.isPlatformLimitError(e)) throw e;
                        await api.event('job_detail_timeout', `详情页未回传职位信息: ${href}`, 'script', 'error', { url: href, error: String(e) });
                        info = await fetchJobInfoFallback(href, e);
                    }
                }
                if (info && info.manual_intervention) throw new Error(`需要人工处理: ${info.reason || info.error || '详情页人工校验'}`);
                if (info && info.page_failure) throw new Error(`${info.failure_kind === 'platform_limit' ? '平台次数限制' : '未找到目标元素'}: ${info.reason || info.error || '详情页页面失败'}`);
                if (!info || !info.title || !info.detail) throw new Error('职位详情缺少标题或描述');
                closeActiveTempTab();
                await api.event('job_detail_received', `已读取职位详情: ${info.title}`, 'script', 'info', info);
                return info;
            };


            const getJobInfoWithRetry = async (href) => {
                try {
                    return await getJobInfo(href);
                } catch (firstError) {
                    closeActiveTempTab();
                    if (tools.isPlatformLimitError(firstError) || tools.isElementMissingError(firstError)) {
                        await api.event(
                            tools.isPlatformLimitError(firstError) ? 'job_detail_platform_limit' : 'job_detail_element_missing',
                            `职位详情读取触发页面恢复: ${href}`,
                            'script',
                            'error',
                            { url: href, error: String(firstError) }
                        );
                        throw firstError;
                    }
                    if (tools.isManualInterruptionError(firstError)) {
                        await api.event('job_detail_manual_intervention', `职位详情触发人工校验，切换关键词恢复: ${href}`, 'script', 'error', {
                            url: href,
                            error: String(firstError),
                        });
                        throw firstError;
                    }
                    await api.event('job_detail_failed', `职位详情读取失败，准备重试一次: ${href}`, 'script', 'error', {
                        url: href,
                        error: String(firstError),
                    });
                    await tools.actionSleep(1000);
                    try {
                        return await getJobInfo(href);
                    } catch (secondError) {
                        closeActiveTempTab();
                        if (tools.isPlatformLimitError(secondError) || tools.isElementMissingError(secondError)) {
                            await api.event(
                                tools.isPlatformLimitError(secondError) ? 'job_detail_platform_limit' : 'job_detail_element_missing',
                                `职位详情重试触发页面恢复: ${href}`,
                                'script',
                                'error',
                                { url: href, firstError: String(firstError), secondError: String(secondError) }
                            );
                            throw secondError;
                        }
                        if (tools.isManualInterruptionError(secondError)) {
                            await api.event('job_detail_manual_intervention', `职位详情重试触发人工校验，切换关键词恢复: ${href}`, 'script', 'error', {
                                url: href,
                                firstError: String(firstError),
                                secondError: String(secondError),
                            });
                            throw secondError;
                        }
                        await api.event('job_detail_failed', `职位详情读取重试失败，跳过职位: ${href}`, 'script', 'error', {
                            url: href,
                            firstError: String(firstError),
                            secondError: String(secondError),
                        });
                        throw secondError;
                    }
                }
            };

            // 添加到聊天列表
            const addToChatList = async (url) => {
                if (!url) throw new Error('缺少打招呼请求链接');
                try {
                    await confirmQuotaReminderIfPresent('chat_entry_before_request');
                    await api.event('chat_entry_request_started', `请求打招呼入口: ${url}`, 'script', 'info', { url });
                    const fetchEntry = async (confirmedReminder = false) => {
                        const resp = await fetch(url, { credentials: 'include' });
                        if (!(resp.ok && resp.status === 200)) {
                            throw new Error(`BOSS 网络响应异常: ${resp.status}`);
                        }
                        const data = await resp.json();
                        await api.event(
                            confirmedReminder ? 'chat_entry_request_retried_after_reminder' : 'chat_entry_request_response',
                            confirmedReminder ? '温馨提示确认后重新请求打招呼入口' : '打招呼入口请求已返回',
                            'script',
                            'info',
                            {
                                code: data?.code,
                                hasRedirect: Boolean(tools.findChatUrlDeep(data)),
                                hasQuotaReminder: Boolean(tools.quotaReminderReasonFromValue(data)),
                            }
                        );
                        return data;
                    };
                    let data = await fetchEntry(false);
                    let quotaReason = tools.quotaReminderReasonFromValue(data);
                    if (quotaReason) {
                        let redirectedChatUrl = tools.findChatUrlDeep(data);
                        await api.event('quota_reminder_response_detected', `打招呼入口返回额度提醒: ${quotaReason}`, 'script', 'warning', {
                            reason: quotaReason,
                            hasRedirect: Boolean(redirectedChatUrl),
                        });
                        if (redirectedChatUrl) {
                            await api.event('quota_reminder_response_proceed', `接口返回额度提醒但已给出聊天入口，继续打开聊天页: ${quotaReason}`, 'script', 'info', {
                                reason: quotaReason,
                                chatUrl: redirectedChatUrl,
                            });
                        } else {
                            const confirmed = await waitForQuotaReminderConfirmation('chat_entry_response', 8000);
                            if (!confirmed) {
                                await api.event('quota_reminder_not_rendered', `接口返回额度提醒且没有聊天入口，页面也未发现可确认弹窗，已停止本次打招呼入口流程: ${quotaReason}`, 'script', 'error', {
                                    reason: quotaReason,
                                });
                                throw new Error(`chat_entry_quota_reminder_no_chat_url: ${quotaReason}`);
                            }
                            data = await fetchEntry(true);
                            quotaReason = tools.quotaReminderReasonFromValue(data);
                            redirectedChatUrl = tools.findChatUrlDeep(data);
                            if (quotaReason && !redirectedChatUrl) {
                                await api.event('quota_reminder_response_repeated', `温馨提示确认后入口仍返回提醒且没有聊天入口，已停止本次打招呼入口流程: ${quotaReason}`, 'script', 'error', {
                                    reason: quotaReason,
                                });
                                throw new Error(`chat_entry_quota_reminder_repeated: ${quotaReason}`);
                            }
                        }
                    }
                    const finalRedirectChatUrl = tools.findChatUrlDeep(data);
                    if (data.code === 0 || finalRedirectChatUrl) {
                        await api.event('chat_entry_request_finished', finalRedirectChatUrl ? '打招呼入口已返回聊天入口' : '打招呼入口请求成功', 'script', 'info', {
                            hasRedirect: Boolean(finalRedirectChatUrl),
                            code: data?.code,
                        });
                        return data;
                    }
                    const msg = data?.zpData?.bizData?.chatRemindDialog?.title || data?.message || JSON.stringify(data).slice(0, 120);
                    throw new Error(msg || 'BOSS 拒绝打招呼入口请求');
                } catch (e) {
                    logger.add(`打招呼入口失败: ${e}`);
                    throw e;
                }
            };

            const openGreetingChat = async (jobInfo, href, reason, attempt = 1) => {
                if (!jobInfo.chatUrl) throw new Error('缺少聊天页地址');
                const requestId = tools.newGreetRequestId();
                const transactionRunId = lastBackendRunId || tools.getGreetSession().backendRunId || tools.getGreetSession().runId;
                tools.updateGreetTransaction(transactionRunId, href, 'entry_opened', {
                    requestId,
                    attempt,
                    chatUrl: jobInfo.chatUrl,
                    title: jobInfo.title || '',
                });
                startGreetingWait(jobInfo, href, requestId, attempt);
                tools.saveGreetContext({
                    requestId,
                    transactionRunId,
                    url: href,
                    chatUrl: jobInfo.chatUrl || '',
                    title: jobInfo.title,
                    company: jobInfo.company || '',
                    salary: jobInfo.salary || '',
                    greeting: this.introduce,
                    reason,
                    attempt,
                    maxAttempts: OPTIONS.greetMaxAttempts,
                    createdAt: Date.now(),
                });
                await api.event('greet_chat_opened', `打开聊天页准备打招呼 ${attempt}/${OPTIONS.greetMaxAttempts}: ${jobInfo.title}`, 'script', 'info', {
                    title: jobInfo.title,
                    chatUrl: jobInfo.chatUrl,
                    reason,
                    requestId,
                    attempt,
                    maxAttempts: OPTIONS.greetMaxAttempts,
                });
                const opened = tools.openTabNSetTimestamp(jobInfo.chatUrl, this.targets.chatGreet, false, {
                    force: Number(attempt) > 1,
                    cooldownMs: Number(attempt) > 1 ? 0 : OPTIONS.openCooldownMs,
                });
                rememberTempTab(opened);
                if (!opened) {
                    finishGreetingWait(requestId);
                    throw new Error('浏览器拦截了聊天页弹窗，请允许 zhipin.com 弹出窗口后重试');
                }
            };

            const buildGreetingPayload = (jobInfo, analysis, href, reason = '') => ({
                reason,
                score: analysis.total_score,
                threshold: OPTIONS.thread,
                recommendation: analysis.recommendation || '',
                risks: analysis.risks || [],
                greeting: this.introduce,
                job: {
                    url: href,
                    title: jobInfo.title || '',
                    company: jobInfo.company || '',
                    salary: jobInfo.salary || '',
                    city: jobInfo.city || '',
                },
            });

            const recordGreetingSuggestion = async (jobInfo, analysis, href, reason) => {
                await api.createAction(
                    'greet_suggestion',
                    buildGreetingPayload(jobInfo, analysis, href, reason),
                    jobInfo,
                    'completed'
                );
                logger.add(`${reason}: ${jobInfo.title}`);
                await api.event('greet_suggestion', `${reason}: ${jobInfo.title}`, 'script', 'info', { title: jobInfo.title, score: analysis.total_score });
            };

            const sendGreetingFromSearch = async (jobInfo, href) => {
                const transactionRunId = lastBackendRunId || tools.getGreetSession().backendRunId || tools.getGreetSession().runId;
                const existingTransaction = tools.getGreetTransaction(transactionRunId, href);
                if (tools.isTerminalGreetTransaction(existingTransaction)) {
                    const message = `岗位已有不可重复的打招呼事务状态 ${existingTransaction.state}，已跳过: ${jobInfo.title}`;
                    logger.add(message);
                    await api.event('greet_transaction_duplicate_blocked', message, 'script', 'warning', {
                        title: jobInfo.title,
                        url: href,
                        state: existingTransaction.state,
                        transactionId: existingTransaction.id || '',
                    });
                    finishJobProgress('打招呼事务去重');
                    if (await markPreferredFeedJobHandled('打招呼事务去重')) return;
                    setTimeout(loop, 0);
                    return;
                }
                tools.updateGreetTransaction(transactionRunId, href, 'prepared', {
                    title: jobInfo.title || '',
                    company: jobInfo.company || '',
                });
                logger.add(`正在给职位 [${jobInfo.title}] 发送打招呼消息`);
                await api.event('greet_started', `准备打招呼: ${jobInfo.title}`, 'script', 'info', { title: jobInfo.title, score: jobInfo.score });
                if (!jobInfo.addUrl && !jobInfo.chatUrl) {
                    await api.createAction('greet_unavailable', {
                        reason: '缺少打招呼链接',
                        source: jobInfo.source || 'detail',
                        hasAddUrl: Boolean(jobInfo.addUrl),
                        hasChatUrl: Boolean(jobInfo.chatUrl),
                    }, jobInfo, 'completed');
                    await api.event('greet_failed', `缺少打招呼链接: ${jobInfo.title}`, 'script', 'error', { title: jobInfo.title, source: jobInfo.source || 'detail' });
                    finishJobProgress('缺少打招呼入口');
                    if (await markPreferredFeedJobHandled('缺少打招呼入口')) return;
                    setTimeout(loop, 0);
                    return;
                }
                if (jobInfo.talked) {
                    const reason = jobInfo.talked_reason || '页面显示已沟通';
                    logger.add(`职位 [${jobInfo.title}] ${reason}，跳过打招呼`);
                    await api.createAction('already_contacted', { reason }, jobInfo, 'completed');
                    await api.event('already_contacted', `${reason}: ${jobInfo.title}`, 'script', 'info', { title: jobInfo.title, url: href, reason });
                    finishJobProgress('已沟通跳过');
                    if (await markPreferredFeedJobHandled('已沟通跳过')) return;
                    setTimeout(loop, 0);
                    return;
                }
                try {
                    await tools.actionSleep();
                    if (tools.isChatUrl(jobInfo.addUrl)) {
                        jobInfo.chatUrl = jobInfo.addUrl;
                        await api.event('greet_entry_skipped', '打招呼入口本身是聊天页，直接打开聊天页', 'script', 'info', { title: jobInfo.title, chatUrl: jobInfo.chatUrl });
                    } else if (jobInfo.addUrl) {
                        const entryResult = await addToChatList(jobInfo.addUrl);
                        const redirectedChatUrl = tools.findChatUrlDeep(entryResult);
                        if (redirectedChatUrl) jobInfo.chatUrl = redirectedChatUrl;
                    } else {
                        await api.event('greet_entry_skipped', '详情页没有独立打招呼入口，直接打开聊天页', 'script', 'info', { title: jobInfo.title, chatUrl: jobInfo.chatUrl });
                    }
                    await openGreetingChat(jobInfo, href, '入口请求成功或已有聊天页地址');
                } catch (e) {
                    if (tools.isPlatformLimitError(e)) {
                        finishGreetingWait();
                        await handlePageFailure(tools.platformLimitReason(e), 'platform_limit', 'chat_greet');
                        return;
                    }
                    if (tools.isChatEntryRejectedError(e)) {
                        finishGreetingWait();
                        tools.updateGreetTransaction(transactionRunId, href, 'failed', {
                            title: jobInfo.title || '',
                            company: jobInfo.company || '',
                            error: String(e),
                            rejectedAt: Date.now(),
                        });
                        const message = `打招呼入口被平台拒绝，系统已暂停: ${jobInfo.title || href} / ${e}`;
                        logger.add(message);
                        setSearchAction(message);
                        await api.event('greet_entry_rejected', message, 'script', 'error', {
                            title: jobInfo.title || '',
                            url: href,
                            chatUrl: jobInfo.chatUrl || '',
                            error: String(e),
                        });
                        await api.heartbeat('search', 'paused', message, scriptHeartbeatDetail());
                        this.pause = true;
                        logger.setPaused(true);
                        await api.control('pause').catch(() => null);
                        lastBackendControl = 'paused';
                        return;
                    }
                    if (tools.isElementMissingError(e)) {
                        finishGreetingWait();
                        await handlePageFailure(String(e), 'element_retry', 'chat_greet');
                        return;
                    }
                    if (tools.isManualInterruptionError(e)) {
                        finishGreetingWait();
                        await handleManualInterruption(tools.manualInterruptionReason(e), 'chat_greet');
                        return;
                    }
                    if (jobInfo.chatUrl) {
                        logger.add(`入口请求失败，尝试直接打开聊天页: ${jobInfo.chatUrl}`);
                        await api.event('greet_entry_fallback', `入口请求失败，尝试直接打开聊天页: ${e}`, 'script', 'info', { title: jobInfo.title, chatUrl: jobInfo.chatUrl });
                        try {
                            await openGreetingChat(jobInfo, href, '入口请求失败后的聊天页兜底');
                            return;
                        } catch (fallbackError) {
                            finishGreetingWait();
                            await api.event('greet_failed', `聊天页兜底失败: ${fallbackError}`, 'script', 'error', { title: jobInfo.title });
                        }
                    } else {
                        finishGreetingWait();
                        await api.event('greet_failed', `打招呼入口失败且无聊天页兜底: ${e}`, 'script', 'error', { title: jobInfo.title });
                    }
                    finishJobProgress('打招呼失败');
                    if (await markPreferredFeedJobHandled('打招呼失败')) return;
                    setTimeout(loop, 0);
                }
            };

            // 打招呼监听
            const greetListener = () => {
                this.broadcast.on(this.bcTypes.SAY_HI, async (from, data) => {
                    if (from !== this.targets.chatGreet) return;
                    // 需要自我介绍
                    if (data.requestId) {
                        this.broadcast.reply(
                            from,
                            this.bcTypes.SAY_HI,
                            { introduce: this.introduce },
                            data.requestId,
                            data.responseType
                        );
                        return;
                    }
                    // 处理聊天页回传的发送结果。
                    await handleGreetingResult(data || {});
                    return;
                });
            };

            const sendBroadcastSafe = (to, type, data = null) => {
                if (!this.broadcast) return;
                this.broadcast.send(to, type, data).catch((e) => {
                    api.event('broadcast_send_failed', `广播发送失败: ${type} / ${e}`, 'script', 'error', {
                        to,
                        type,
                    }).catch(() => null);
                });
            };


            // 心跳监听
            const heartBeatListener = () => {
                this.broadcast.on(this.bcTypes.HEART_BEAT, async (from, data) => {
                    this.broadcast.reply(
                        from,
                        this.bcTypes.HEART_BEAT,
                        { success: true },
                        data.requestId,
                        data.responseType
                    );
                });
            }

            // 寰幆
            const loop = async () => {
                if (loopRunning) return;
                loopRunning = true;
                try {
                    if (!(await ensureSearchLease('循环运行'))) return;
                    if (waitingForGreeting) return;
                    await confirmQuotaReminderIfPresent('loop');
                    const platformLimit = tools.detectPlatformLimit();
                    if (platformLimit) {
                        await handlePageFailure(platformLimit, 'platform_limit', 'search');
                        return;
                    }
                    const interruption = tools.detectManualInterruption();
                    if (interruption) {
                        await handleManualInterruption(interruption, 'search');
                        return;
                    }
                    if (this.pause) {
                        logger.add('暂停中...');
                        return;
                    }
                    if (cooldownUntil && Date.now() < cooldownUntil) {
                        setSearchAction(`搜索冷却中，预计 ${new Date(cooldownUntil).toLocaleTimeString('zh-CN', { hour12: false })} 后继续`);
                        return;
                    }
                    logger.divider();

                    if (jobHrefs.length === 0) {
                        if (currentJobSource === 'preferred_feed') {
                            if (feedTabMaxJobs > 0 && feedTabProcessedCount >= feedTabMaxJobs) {
                                await switchToNextPreferredFeedTab('推荐源处理上限已达');
                                return;
                            }
                            const hasNextFeedJobs = await nextPage();
                            if (hasNextFeedJobs) {
                                setTimeout(loop, 0);
                                return;
                            }
                            await switchToNextPreferredFeedTab('推荐源暂无新职位');
                            return;
                        }
                        const hasNext = await nextPage();
                        if (hasNext) {
                            setTimeout(loop, 0);
                            return;
                        }
                        const hasNextKeyword = await switchToNextKeyword('当前关键词没有更多职位');
                        if (hasNextKeyword) {
                            setTimeout(loop, 0);
                            return;
                        }
                        await enterSearchCooldown('本轮所有关键词无新职位');
                        return;
                    }

                    const href = jobHrefs.shift();
                    seenJobHrefs.add(tools.jobIdentityKey(href));
                    beginJobProgress(href);
                    logger.add('正在获取职位详情');
                    setSearchAction(`获取职位详情: ${href}`);
                    const jobInfo = await getJobInfoWithRetry(href);
                    jobInfo.url = tools.jobIdentityUrl(href) || href;

                    if (!(await syncControlFromBackend(`暂停检查: 已读取职位详情 ${jobInfo.title}`))) {
                        finishJobProgress('暂停停止');
                        return;
                    }
                    if (jobInfo.talked) {
                        const reason = jobInfo.talked_reason || '页面显示已沟通';
                        logger.add(`职位 [${jobInfo.title}] ${reason}，下一个`);
                        await api.createAction('already_contacted', { reason }, jobInfo, 'completed');
                        await api.event('decision_skip', `跳过已沟通职位: ${jobInfo.title}`, 'script', 'info', { title: jobInfo.title, url: href, reason });
                        finishJobProgress('已沟通跳过');
                        if (await markPreferredFeedJobHandled('已沟通跳过')) return;
                        setTimeout(loop, 0);
                        return;
                    }

                    logger.add(`开始计算职位 [${jobInfo.title}] 的匹配度`);
                    setSearchAction(`分析职位: ${jobInfo.title}`);
                    await api.event('job_analysis_started', `开始分析职位: ${jobInfo.title}`, 'script', 'info', { title: jobInfo.title, salary: jobInfo.salary });
                    const analysis = await api.analyzeJob({
                        title: jobInfo.title,
                        salary: jobInfo.salary,
                        detail: jobInfo.detail,
                        company: jobInfo.company || '',
                        city: jobInfo.city || '',
                        url: href,
                        talked: Boolean(jobInfo.talked),
                        talked_reason: jobInfo.talked_reason || '',
                    });
                    const score = analysis.total_score;
                    logger.add(`匹配度: ${score}`);
                    if (analysis.match_reason) logger.add(`判断原因: ${analysis.match_reason}`);
                    if (analysis.recommendation) logger.add(`推荐动作: ${analysis.recommendation}`);
                    await api.event('job_analysis_finished', `职位分析完成: ${jobInfo.title} / ${score}`, 'script', 'info', { title: jobInfo.title, score, recommendation: analysis.recommendation, risks: analysis.risks || [] });
                    if (analysis.risks && analysis.risks.length) {
                        logger.add(`风险点: ${analysis.risks.join('；')}`);
                    }
                    if (!(await syncControlFromBackend(`暂停检查: 职位分析完成 ${jobInfo.title}`))) {
                        finishJobProgress('暂停停止');
                        return;
                    }
                    if (analysis.recommendation === 'greet' && score >= OPTIONS.thread) {
                        jobInfo.score = score;
                        setSearchAction(`准备打招呼: ${jobInfo.title}`);
                        if (!(await syncControlFromBackend(`暂停检查: 准备打招呼 ${jobInfo.title}`))) {
                            finishJobProgress('暂停停止');
                            return;
                        }
                        await sendGreetingFromSearch(jobInfo, href);
                    } else {
                        if (analysis.recommendation === 'wait_for_confirm') {
                            await recordGreetingSuggestion(jobInfo, analysis, href, analysis.match_reason || '模型建议人工确认，不自动打招呼');
                        } else {
                            await api.event('decision_skip', `跳过职位: ${jobInfo.title} / ${score}`, 'script', 'info', { title: jobInfo.title, score, recommendation: analysis.recommendation, reason: analysis.match_reason || analysis.blocked_reason || '' });
                        }
                        finishJobProgress('跳过');
                        if (await markPreferredFeedJobHandled('跳过')) return;
                        setTimeout(loop, 0);
                    }
                } catch (e) {
                    if (tools.isBackendUnavailableError(e)) {
                        await handleBackendUnavailable(String(e), 'search');
                        return;
                    }
                    if (tools.isPlatformLimitError(e)) {
                        await handlePageFailure(tools.platformLimitReason(e), 'platform_limit', 'search');
                        return;
                    }
                    if (tools.isElementMissingError(e)) {
                        await handlePageFailure(String(e), 'element_retry', 'search');
                        return;
                    }
                    if (tools.isManualInterruptionError(e)) {
                        await handleManualInterruption(tools.manualInterruptionReason(e), 'search');
                        return;
                    }
                    console.log(e);
                    logger.add(`循环时出错: ${e}`);
                    setSearchAction(`循环出错，稍后继续: ${e}`);
                    await api.event('loop_failed', `循环时出错: ${e}`, 'script', 'error');
                    const errorText = String(e);
                    finishJobProgress(errorText.includes('详情') || errorText.includes('get-job-info') ? '详情失败跳过' : '异常跳过');
                    setTimeout(loop, 1000);
                } finally {
                    loopRunning = false;
                }
            };

            // 主函数
            const main = async () => {
                try {
                    if (booting || started) return;
                    if (!(await ensureSearchLease('启动自动化'))) return;
                    booting = true;
                    started = true;
                    resetProgress();
                    if (!tools.getGreetSession().runId || tools.getGreetSession().ended) {
                        beginGreetSession('开始新一轮');
                    }
                    setSearchAction('程序启动，读取配置');
                    logger.add('--程序启动--');
                    const bootStatus = await api.heartbeat('search', 'running', '程序启动', scriptHeartbeatDetail());
                    applyBackendConfig(bootStatus.config);
                    lastBackendRunId = bootStatus.run_id || lastBackendRunId;
                    await ensureSessionForBackendRun(lastBackendRunId, 'program_start');
                    if (shouldPreferFeedBeforeKeywordSearch()) {
                        currentJobSource = 'preferred_feed';
                        feedSwitchAttempted = true;
                        feedSwitchReason = 'redirect_to_preferred_feed_before_keyword';
                        const message = '本轮将优先处理用户自定义推荐 Tab，正在打开推荐页';
                        logger.add(message);
                        setSearchAction(message);
                        await api.event('preferred_feed_redirect', message, 'script', 'info', {
                            target: SEARCHPATH.preferred,
                            runKey: preferredFeedRunKey(),
                        });
                        await api.heartbeat('search', 'running', message, scriptHeartbeatDetail());
                        tools.openTabNSetTimestamp(SEARCHPATH.preferred, this.targets.search, true);
                        return;
                    }
                    // 开始广播
                    startBroadcast();
                    // 获取标签
                    setSearchAction('读取简历画像标签');
                    this.tags = await api.getTags();
                    if (!this.tags.length) {
                        logger.add('请先在 CLI 中生成简历画像');
                        await api.heartbeat('search', 'error', '缺少简历画像');
                        return;
                    }
                    logger.add('获取标签成功: ' + this.tags.join('、'));
                    const recentJobs = await api.getRecentJobs();
                    backendProcessedHrefs.clear();
                    for (const item of recentJobs) {
                        const href = tools.jobIdentityKey(item.url || '');
                        if (href) backendProcessedHrefs.add(href);
                    }
                    if (backendProcessedHrefs.size) {
                        await api.event('recent_jobs_loaded', `已加载近期处理职位 ${backendProcessedHrefs.size} 个`, 'script', 'info', {
                            count: backendProcessedHrefs.size,
                            hours: OPTIONS.recentProcessedHours,
                        });
                    }
                    // 获取自我介绍
                    setSearchAction('读取已确认打招呼用语');
                    this.introduce = await api.getIntroduce();
                    if (!this.introduce) {
                        logger.add('请先在 CLI 中生成并启用打招呼用语');
                        await api.heartbeat('search', 'error', '缺少已启用打招呼用语');
                        return;
                    }
                    logger.add(`获取已确认打招呼用语成功，长度 ${this.introduce.length} 字`);
                    if (await preparePreferredFeeds()) {
                        if (currentJobSource === 'preferred_feed' && !this.pause && feedTabs.length) {
                            const hasFeedJobs = await nextPage();
                            if (hasFeedJobs) {
                                loop();
                            } else {
                                await switchToNextPreferredFeedTab('推荐源启动后没有读取到职位列表');
                            }
                        }
                        return;
                    }
                    // 开始搜索
                    const resumeTagIdx = currentTagIdx;
                    const restoredRound = restoreSearchRoundState();
                    if (restoredRound && cooldownUntil > Date.now()) {
                        await enterSearchCooldown('恢复上次搜索冷却', cooldownUntil);
                        return;
                    }
                    if (!restoredRound) {
                        await beginSearchRound('program_start', resumeTagIdx);
                    } else if (this.tags.length) {
                        currentTagIdx = Math.min(currentTagIdx, this.tags.length - 1);
                    }
                    setSearchAction(`准备搜索关键词: ${this.tags[currentTagIdx]}`);
                    if (restoredRound && tagsCheckedThisRound.has(currentTagIdx)) {
                        const existingJobs = await nextPage();
                        if (existingJobs) {
                            loop();
                            return;
                        }
                        const moved = await switchToNextKeyword('刷新后继续未完成轮次');
                        if (moved) loop();
                        else await enterSearchCooldown('恢复轮次后所有关键词无新职位');
                        return;
                    }
                    if (!(await searchCurrentKeyword('首个关键词', false))) return;
                    const hasJobs = await nextPage();
                    if (!hasJobs) {
                        const hasNextKeyword = await switchToNextKeyword('搜索后没有读取到职位列表');
                        if (hasNextKeyword) {
                            loop();
                        } else {
                            await enterSearchCooldown('启动后所有关键词无新职位');
                        }
                        return;
                    }
                    // 开始循环
                    loop();
                } catch (e) {
                    if (tools.isBackendUnavailableError(e)) {
                        await handleBackendUnavailable(String(e), 'search_startup');
                        return;
                    }
                    if (tools.isPlatformLimitError(e)) {
                        await handlePageFailure(tools.platformLimitReason(e), 'platform_limit', 'search');
                        return;
                    }
                    if (tools.isElementMissingError(e)) {
                        await handlePageFailure(String(e), 'element_retry', 'search');
                        return;
                    }
                    if (tools.isManualInterruptionError(e)) {
                        await handleManualInterruption(tools.manualInterruptionReason(e), 'search');
                        return;
                    }
                    started = false;
                    this.pause = true;
                    logger.add(`启动失败: ${e}`);
                    await api.heartbeat('search', 'error', `启动失败: ${e}`);
                } finally {
                    booting = false;
                }
            };

            // 初始化
            const init = async () => {
                const res = await api.heartbeat('search', 'idle', '等待 CLI start', scriptHeartbeatDetail());
                applyBackendConfig(res.config);
                lastBackendRunId = res.run_id || lastBackendRunId;
                lastBackendControl = res.control || lastBackendControl;
                if (res.offline) {
                    noteBackendOffline('后端未连接：请先运行 python main.py，并确认油猴脚本允许连接 127.0.0.1');
                    return;
                }
                noteBackendOnline();
                await api.event('script_ready', `脚本就绪: ${OPTIONS.scriptVersion}`, 'script', 'info', {
                    version: OPTIONS.scriptVersion,
                    serverHost: OPTIONS.serverHost,
                    threshold: OPTIONS.thread,
                    sessionGreetCount: tools.getSessionGreetCount(),
                });
                logger.add('等待 CLI 输入 start 开始自动化');
                if (res.should_start || res.control === 'running') {
                    if (!(await ensureSearchLease('初始化自动继续'))) return;
                    await ensureSessionForBackendRun(lastBackendRunId, 'init_running');
                    if (!tools.getGreetSession().runId || tools.getGreetSession().ended) {
                        beginGreetSession('开始新一轮');
                    }
                    logger.setPaused(false);
                    this.pause = false;
                    main();
                    return;
                }
                // 从其他页面跳回搜索页时，仍然尊重 CLI 控制状态。
                if (searchPageOpenedAt - tools.getTimestamp(this.targets.search) < OPTIONS.timestampTimeout && res.control !== 'paused') {
                    if (!(await ensureSearchLease('搜索页恢复'))) return;
                    await ensureSessionForBackendRun(lastBackendRunId, 'search_page_restore');
                    this.pause = false;
                    main();
                }
            };

            init();
        }

        // 详情页
        __detail() {
            const api = new Api();
            // 注册广播
            const startBroadcast = () => {
                this.__broadcast(this.targets.detail);
            };
            startBroadcast();

            // 获取职位信息
            const getJobInfo = async () => {
                const platformLimit = tools.detectPlatformLimit();
                if (platformLimit) throw new Error(`平台次数限制: ${platformLimit}`);
                const interruption = tools.detectManualInterruption();
                if (interruption) throw new Error(`需要人工处理: ${interruption}`);
                await tools.waitForOne(SELECTORS.ZHIPIN.DETAIL.JOBNAME_CANDIDATES, 20000);
                await tools.waitForOne(SELECTORS.ZHIPIN.DETAIL.DETAIL_CANDIDATES, 20000);
                const chatBtn = tools.findOne(SELECTORS.ZHIPIN.DETAIL.STARTCHAT);
                const title = tools.textOf(SELECTORS.ZHIPIN.DETAIL.JOBNAME_CANDIDATES);
                const salary = tools.textOf(SELECTORS.ZHIPIN.DETAIL.SALARY_CANDIDATES);
                const detail = tools.textOf(SELECTORS.ZHIPIN.DETAIL.DETAIL_CANDIDATES);
                const company = tools.sanitizeCompanyName(
                    tools.textOf(SELECTORS.ZHIPIN.DETAIL.COMPANY_CANDIDATES),
                    title,
                    salary
                );
                const city = tools.textOf(SELECTORS.ZHIPIN.DETAIL.CITY_CANDIDATES);
                if (!title) throw new Error('未找到职位名称');
                if (!salary) throw new Error('未找到职位薪资');
                if (!detail) throw new Error('未找到职位描述');
                const chatUrl = chatBtn && (chatBtn.getAttribute(SELECTORS.ZHIPIN.DETAIL.CHATURL) || chatBtn.getAttribute('href') || chatBtn.dataset.redirectUrl);
                const addUrl = chatBtn && (chatBtn.dataset.url || chatBtn.getAttribute('data-url') || chatBtn.getAttribute('href'));
                const talkedReason = tools.contactedReasonFromElement(chatBtn);
                if (!chatBtn || (!tools.normalUrl(chatUrl) && !tools.normalUrl(addUrl) && !chatBtn.dataset.isfriend)) {
                    throw new Error('未找到打招呼入口，可能页面结构已变化或需要人工处理');
                }
                return {
                    title,
                    salary,
                    detail,
                    company,
                    city,
                    chatUrl: tools.normalUrl(chatUrl),
                    addUrl: tools.normalUrl(addUrl),
                    talked: Boolean(talkedReason),
                    talked_reason: talkedReason,
                    source: 'detail',
                };
            };
            // 来自搜索页
            const fromSearchPage = async () => {
                const jobInfo = await getJobInfo();
                // 把职位信息发送给搜索页
                await api.event('job_detail_received', `详情页读取职位: ${jobInfo.title}`, 'script', 'info', jobInfo);
                await this.broadcast.send(this.targets.search, this.bcTypes.GET_JOB_INFO, jobInfo);
                setTimeout(() => window.close(), 500);
            };

            // 来自聊天页
            const fromChatPage = async () => {
                const jobInfo = await getJobInfo();
                // 把职位信息发送给聊天页
                await api.event('job_detail_received', `聊天页读取职位: ${jobInfo.title}`, 'script', 'info', jobInfo);
                await this.broadcast.send(
                    this.targets.chat,
                    this.bcTypes.GET_JOB_INFO,
                    jobInfo
                );
                window.close();
            };

            // 主函数
            const main = async () => {
                try {
                    // 判断来源
                    const now = new Date().getTime();
                    const detailOpenedAt = tools.getTimestamp(this.targets.detail);
                    const chatOpenedAt = tools.getTimestamp(this.targets.chat);
                    const detailAge = detailOpenedAt ? now - detailOpenedAt : null;
                    const chatAge = chatOpenedAt ? now - chatOpenedAt : null;
                    const isNamedDetailWindow = window.name === this.targets.detail;
                    const isRecentDetailWindow = detailAge !== null && detailAge < OPTIONS.timestampTimeout;
                    const isRecentChatWindow = chatAge !== null && chatAge < OPTIONS.timestampTimeout;
                    const isFromSearch = isNamedDetailWindow || isRecentDetailWindow;
                    const isFromChat = !isFromSearch && isRecentChatWindow;
                    await api.heartbeat('detail', 'running', `详情页已启动: ${location.pathname}`, {
                        path: location.pathname,
                        windowName: window.name,
                        isFromSearch,
                        isFromChat,
                        detailAge,
                        chatAge,
                    });

                    if (isFromSearch) {
                        await fromSearchPage();
                    } else if (isFromChat) {
                        await fromChatPage();
                    } else {
                        await api.heartbeat('detail', 'idle', '详情页独立打开，未执行自动动作');
                    }
                } catch (e) {
                    const now = new Date().getTime();
                    const detailOpenedAt = tools.getTimestamp(this.targets.detail);
                    const detailAge = detailOpenedAt ? now - detailOpenedAt : null;
                    const isFromSearch = window.name === this.targets.detail || (detailAge !== null && detailAge < OPTIONS.timestampTimeout);
                    const manualReason = tools.manualInterruptionReason(e);
                    if (manualReason && isFromSearch) {
                        await this.broadcast.send(this.targets.search, this.bcTypes.GET_JOB_INFO, {
                            manual_intervention: true,
                            reason: manualReason,
                            error: String(e),
                            source: 'detail_error',
                        }).catch(async (sendError) => {
                            await api.event('broadcast_send_failed', `详情页人工处理回传失败: ${sendError}`, 'script', 'error', {
                                path: location.pathname,
                                windowName: window.name,
                            });
                        });
                        setTimeout(() => window.close(), 500);
                    }
                    const platformReason = tools.platformLimitReason(e);
                    const elementMissing = tools.isElementMissingError(e);
                    if ((platformReason || elementMissing) && isFromSearch) {
                        await this.broadcast.send(this.targets.search, this.bcTypes.GET_JOB_INFO, {
                            page_failure: true,
                            failure_kind: platformReason ? 'platform_limit' : 'element_retry',
                            reason: platformReason || String(e),
                            error: String(e),
                            source: 'detail_error',
                        }).catch(async (sendError) => {
                            await api.event('broadcast_send_failed', `详情页页面失败回传失败: ${sendError}`, 'script', 'error', {
                                path: location.pathname,
                                windowName: window.name,
                            });
                        });
                        setTimeout(() => window.close(), 500);
                    }
                    await api.heartbeat('detail', 'error', String(e), { path: location.pathname, windowName: window.name });
                    await api.event('job_detail_failed', `详情页读取失败: ${e}`, 'script', 'error', { path: location.pathname, windowName: window.name });
                }
            };
            main();
        }

        // 聊天页
        async __chat() {
            const pageApi = new Api();
            // 注册广播
            const startBroadcast = (target = this.targets.chat) => {
                this.__broadcast(target);
            };

            // 发送消息
            const getSelfMessageSnapshot = () => {
                const nodes = typeof queryChatRoots === 'function'
                    ? queryChatRoots(['.item-myself'])
                    : Array.from(document.querySelectorAll('.item-myself'));
                const texts = nodes.map((node) => {
                    const msgBox = node.querySelector(SELECTORS.ZHIPIN.CHAT.MSGCONTENT);
                    return String((msgBox || node).innerText || (msgBox || node).textContent || '').trim();
                }).filter(Boolean);
                return {
                    count: nodes.length,
                    lastText: texts[texts.length - 1] || '',
                };
            };

            const waitForMessageSendConfirmed = async (text, inputEl, beforeSnapshot, timeout = 7000) => {
                const expectedPrefix = String(text || '').trim().slice(0, 12);
                const startedAt = Date.now();
                while (Date.now() - startedAt < timeout) {
                    const afterSnapshot = getSelfMessageSnapshot();
                    const inputText = String(
                        ('value' in inputEl ? inputEl.value : (inputEl.innerText || inputEl.textContent)) || ''
                    ).trim();
                    const messageAdded = afterSnapshot.count > beforeSnapshot.count;
                    const messageMatches = expectedPrefix && afterSnapshot.lastText.includes(expectedPrefix);
                    const inputCleared = !inputText || !inputText.includes(expectedPrefix);
                    if (messageMatches || (messageAdded && inputCleared)) {
                        return {
                            confirmed: true,
                            beforeCount: beforeSnapshot.count,
                            afterCount: afterSnapshot.count,
                            lastText: afterSnapshot.lastText.slice(0, 80),
                            inputCleared,
                        };
                    }
                    await tools.asyncSleep(300);
                }
                const afterSnapshot = getSelfMessageSnapshot();
                return {
                    confirmed: false,
                    beforeCount: beforeSnapshot.count,
                    afterCount: afterSnapshot.count,
                    lastText: afterSnapshot.lastText.slice(0, 80),
                };
            };

            const confirmChatQuotaReminderIfPresent = async (sourcePage = 'chat') => {
                const result = await tools.confirmQuotaReminderDialog();
                if (!result) return false;
                await pageApi.event(
                    result.confirmed ? 'quota_reminder_confirmed' : 'quota_reminder_confirm_failed',
                    result.confirmed
                        ? `BOSS 温馨提示已确认，继续发送: ${result.text}`
                        : `BOSS 温馨提示确认失败: ${result.text}`,
                    'script',
                    result.confirmed ? 'info' : 'error',
                    { sourcePage, text: result.text, button: result.button, dialog: result.dialog }
                );
                if (!result.confirmed) throw new Error('quota_reminder_confirm_failed');
                return true;
            };

            let conversationActivationAttempted = false;
            let conversationActivationClicked = false;
            let conversationActivationConfirmed = false;

            const chatSearchRoots = () => {
                const roots = [];
                const queue = [document];
                const seen = new Set();
                while (queue.length && roots.length < 30) {
                    const root = queue.shift();
                    if (!root || seen.has(root) || typeof root.querySelectorAll !== 'function') continue;
                    seen.add(root);
                    roots.push(root);
                    try {
                        root.querySelectorAll('iframe').forEach((frame) => {
                            try {
                                if (frame.contentDocument) queue.push(frame.contentDocument);
                            } catch (e) {
                                // Cross-origin frames are intentionally ignored.
                            }
                        });
                        root.querySelectorAll('*').forEach((el) => {
                            if (el.shadowRoot) queue.push(el.shadowRoot);
                        });
                    } catch (e) {
                        // A detached root may disappear while the chat app is rendering.
                    }
                }
                return roots;
            };

            const queryChatRoots = (selectors, roots = chatSearchRoots()) => {
                const found = [];
                for (const root of roots) {
                    for (const selector of selectors) {
                        try {
                            root.querySelectorAll(selector).forEach((el) => {
                                if (!found.includes(el)) found.push(el);
                            });
                        } catch (e) {
                            // Ignore unsupported selectors and detached roots.
                        }
                    }
                }
                return found;
            };

            const activateGreetConversation = async (greetContext = {}) => {
                if (conversationActivationAttempted) return conversationActivationClicked;
                conversationActivationAttempted = true;
                const roots = chatSearchRoots();
                const jobId = tools.jobIdFromValue(greetContext.chatUrl || greetContext.url || location.href);
                const attributeValue = String(jobId || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                const encodedJobId = encodeURIComponent(jobId || '');
                const strongSelectors = jobId ? [
                    `[data-job-id="${attributeValue}"]`,
                    `[data-jobid="${attributeValue}"]`,
                    `[data-jobId="${attributeValue}"]`,
                    `a[href*="jobId=${encodedJobId}"]`,
                    `[data-url*="${attributeValue}"]`,
                ] : [];
                const conversationContainerSelector = [
                    '[class*="chat-list"]',
                    '[class*="friend-list"]',
                    '[class*="conversation-list"]',
                    '[class*="contact-list"]',
                    '[class*="user-list"]',
                    '[role="listbox"]',
                ].join(',');
                const isConversationCandidate = el => Boolean(
                    el?.closest?.(conversationContainerSelector)
                    || el?.matches?.('[class*="chat-item"], [class*="friend-item"], [class*="conversation-item"], [class*="contact-item"]')
                );
                const strong = queryChatRoots(strongSelectors, roots)
                    .filter(el => isConversationCandidate(el) && tools.isVisible(el) && !tools.isDisabled(el));
                let candidate = strong[0] || null;
                let matchedBy = candidate ? 'job_id' : '';
                const listSelectors = [
                    '[class*="chat-list"] [class*="item"]',
                    '[class*="friend-list"] [class*="item"]',
                    '[class*="conversation-list"] [class*="item"]',
                    '[class*="contact-list"] [class*="item"]',
                    '[class*="user-list"] [class*="item"]',
                    '[class*="chat-list"] li',
                    '[class*="friend-list"] li',
                    '[role="listbox"] [role="option"]',
                ];
                const listItems = queryChatRoots(listSelectors, roots)
                    .filter(el => tools.isVisible(el) && !tools.isDisabled(el));
                if (!candidate) {
                    const normalize = value => String(value || '').replace(/\s+/g, '').toLowerCase();
                    const title = normalize(greetContext.title);
                    const company = normalize(greetContext.company);
                    const ranked = listItems
                        .map((el) => {
                            const text = normalize(el.innerText || el.textContent || '');
                            const titleMatch = title.length >= 4 && text.includes(title);
                            const companyMatch = company.length >= 4 && text.includes(company);
                            return { el, score: (titleMatch ? 2 : 0) + (companyMatch ? 1 : 0) };
                        })
                        .filter(item => item.score > 0)
                        .sort((a, b) => b.score - a.score);
                    if (ranked.length && (ranked.length === 1 || ranked[0].score > ranked[1].score)) {
                        candidate = ranked[0].el;
                        matchedBy = ranked[0].score >= 2 ? 'title' : 'company';
                    }
                }
                if (!candidate) {
                    await pageApi.event('chat_conversation_activation_unavailable', '聊天页未发现可安全确认的目标会话，继续等待输入框', 'script', 'info', {
                        jobId,
                        title: greetContext.title || '',
                        company: greetContext.company || '',
                        rootCount: roots.length,
                        listCandidateCount: listItems.length,
                        path: location.pathname,
                    });
                    return false;
                }
                const clicked = tools.clickLikeUser(candidate);
                conversationActivationClicked = Boolean(clicked);
                await pageApi.event('chat_conversation_activation_clicked', `已尝试激活目标聊天会话: ${matchedBy}`, 'script', 'info', {
                    jobId,
                    title: greetContext.title || '',
                    company: greetContext.company || '',
                    matchedBy,
                    candidate: tools.elementBrief(clicked || candidate),
                });
                await tools.actionSleep(800);
                return conversationActivationClicked;
            };

            const findChatInput = async (greetContext = {}) => {
                const startedAt = Date.now();
                while (Date.now() - startedAt < 15000) {
                    await confirmChatQuotaReminderIfPresent('find_chat_input');
                    const roots = chatSearchRoots();
                    const candidates = queryChatRoots(SELECTORS.ZHIPIN.CHAT.CHATINPUT, roots);
                    const visible = candidates.find(el => tools.isVisible(el) && !tools.isDisabled(el));
                    if (visible) {
                        if (conversationActivationClicked && !conversationActivationConfirmed) {
                            conversationActivationConfirmed = true;
                            await pageApi.event('chat_conversation_activated', '目标聊天会话已激活并发现输入框', 'script', 'info', {
                                input: tools.elementBrief(visible),
                                rootCount: roots.length,
                            });
                        }
                        return visible;
                    }
                    if (Date.now() - startedAt >= 2500 && !conversationActivationAttempted) {
                        await activateGreetConversation(greetContext);
                    }
                    const platformLimit = tools.detectPlatformLimit();
                    if (platformLimit) throw new Error(`平台次数限制: ${platformLimit}`);
                    const interruption = tools.detectManualInterruption();
                    if (interruption) throw new Error(`需要人工处理: ${interruption}`);
                    await tools.asyncSleep(300);
                }
                const roots = chatSearchRoots();
                const error = new Error(`未找到目标元素: ${SELECTORS.ZHIPIN.CHAT.CHATINPUT.join(', ')}`);
                error.detail = {
                    jobId: tools.jobIdFromValue(greetContext.chatUrl || greetContext.url || location.href),
                    path: location.pathname,
                    rootCount: roots.length,
                    frameCount: document.querySelectorAll('iframe').length,
                    contentEditableCount: queryChatRoots(['[contenteditable="true"]', '[contenteditable="plaintext-only"]'], roots).length,
                    textareaCount: queryChatRoots(['textarea'], roots).length,
                    conversationActivationAttempted,
                    conversationActivationClicked,
                };
                throw error;
            };

            const findSendButton = async () => {
                const startedAt = Date.now();
                while (Date.now() - startedAt < 10000) {
                    await confirmChatQuotaReminderIfPresent('find_send_button');
                    const candidates = queryChatRoots(SELECTORS.ZHIPIN.CHAT.MSGSEND);
                    const visible = candidates.find(el => tools.isVisible(el) && !tools.isDisabled(el));
                    if (visible) return visible;
                    await tools.asyncSleep(300);
                }
                return null;
            };

            const trySendByEnter = async (inputEl, text, beforeSnapshot) => {
                inputEl.focus();
                const view = inputEl.ownerDocument?.defaultView || window;
                ['keydown', 'keypress', 'keyup'].forEach(type => {
                    inputEl.dispatchEvent(new view.KeyboardEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        key: 'Enter',
                        code: 'Enter',
                        keyCode: 13,
                        which: 13,
                    }));
                });
                return waitForMessageSendConfirmed(text, inputEl, beforeSnapshot, 5000);
            };

            const sendMsg = (text, greetContext = {}) => {
                return new Promise(async (resolve, reject) => {
                    try {
                        await confirmChatQuotaReminderIfPresent('before_send_message');
                        const platformLimit = tools.detectPlatformLimit();
                        if (platformLimit) throw new Error(`平台次数限制: ${platformLimit}`);
                        const interruption = tools.detectManualInterruption();
                        if (interruption) throw new Error(`需要人工处理: ${interruption}`);
                        if (!String(text || '').trim()) throw new Error('发送内容为空');
                        await pageApi.event('message_send_started', '准备发送已确认的打招呼消息', 'script', 'info', { length: String(text).length });
                        const ipt = await findChatInput(greetContext);
                        const actualText = tools.inputEditableText(ipt, text);
                        if (!actualText || !actualText.includes(String(text).slice(0, 10))) {
                            const error = new Error('输入框写入后内容校验失败');
                            error.detail = {
                                input: tools.elementBrief(ipt),
                                expectedLength: String(text).length,
                                actualLength: String(actualText || '').length,
                            };
                            throw error;
                        }
                        await tools.actionSleep(600);
                        await confirmChatQuotaReminderIfPresent('before_send_button');
                        const limitBeforeButton = tools.detectPlatformLimit();
                        if (limitBeforeButton) throw new Error(`平台次数限制: ${limitBeforeButton}`);
                        const btn = await findSendButton();
                        await confirmChatQuotaReminderIfPresent('before_send_click');
                        const limitBeforeClick = tools.detectPlatformLimit();
                        if (limitBeforeClick) throw new Error(`平台次数限制: ${limitBeforeClick}`);
                        const beforeSnapshot = getSelfMessageSnapshot();
                        tools.updateGreetTransaction(greetContext.transactionRunId, greetContext.url, 'send_clicked', {
                            requestId: greetContext.requestId || '',
                            attempt: Number(greetContext.attempt || 1),
                            clickedAt: Date.now(),
                        });
                        let confirmation;
                        if (btn && tools.isVisible(btn) && !tools.isDisabled(btn)) {
                            btn.click();
                            confirmation = await waitForMessageSendConfirmed(text, ipt, beforeSnapshot);
                        } else {
                            await pageApi.event('message_send_button_missing', '发送按钮不可用，尝试使用 Enter 发送', 'script', 'warning', {
                                input: tools.elementBrief(ipt),
                            });
                            confirmation = await trySendByEnter(ipt, text, beforeSnapshot);
                        }
                        if (!confirmation.confirmed) {
                            tools.updateGreetTransaction(greetContext.transactionRunId, greetContext.url, 'unknown', {
                                requestId: greetContext.requestId || '',
                                attempt: Number(greetContext.attempt || 1),
                                error: 'message_send_unconfirmed',
                            });
                            const error = new Error('greet_delivery_unknown: message_send_unconfirmed');
                            error.deliveryUnknown = true;
                            error.detail = {
                                button: tools.elementBrief(btn),
                                input: tools.elementBrief(ipt),
                                ...confirmation,
                            };
                            throw error;
                        }
                        tools.updateGreetTransaction(greetContext.transactionRunId, greetContext.url, 'confirmed', {
                            requestId: greetContext.requestId || '',
                            attempt: Number(greetContext.attempt || 1),
                            confirmedAt: Date.now(),
                        });
                        await pageApi.event('message_send_finished', '消息已点击发送', 'script', 'info', {
                            button: tools.elementBrief(btn),
                            input: tools.elementBrief(ipt),
                            length: String(text).length,
                            confirmation,
                        });
                        resolve();
                    } catch (e) {
                        await pageApi.event('message_send_failed', `消息发送失败: ${e}`, 'script', 'error', e.detail || {});
                        reject(e);
                    }
                })
            };

            const sendMsgWithRetries = async (text, greetContext = {}) => {
                const maxAttempts = Math.max(1, Number(greetContext.maxAttempts || OPTIONS.greetMaxAttempts || 3));
                let lastError = null;
                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                    try {
                        await pageApi.event('message_send_attempt', `聊天页发送尝试 ${attempt}/${maxAttempts}`, 'script', 'info', {
                            requestId: greetContext.requestId || '',
                            attempt,
                            maxAttempts,
                        });
                        await sendMsg(text, { ...greetContext, attempt });
                        return;
                    } catch (e) {
                        lastError = e;
                        if (e.deliveryUnknown || tools.isPlatformLimitError(e) || tools.isManualInterruptionError(e)) {
                            throw e;
                        }
                        if (attempt < maxAttempts) {
                            const delay = Number((OPTIONS.greetRetryDelays || [0, 3000, 8000])[attempt] || 3000);
                            await pageApi.event('message_send_attempt_retry', `聊天页发送失败，准备在当前页面重试 ${attempt + 1}/${maxAttempts}: ${e}`, 'script', 'warning', {
                                requestId: greetContext.requestId || '',
                                attempt,
                                nextAttempt: attempt + 1,
                                maxAttempts,
                                error: String(e),
                            });
                            await tools.asyncSleep(delay);
                        }
                    }
                }
                const finalError = lastError || new Error('message_send_failed');
                finalError.preSendFailed = true;
                throw finalError;
            };

            // 打招呼
            const closeTemporaryChatPage = async (requestId) => {
                tools.releaseGreetClaim(requestId);
                setTimeout(() => {
                    window.close();
                    setTimeout(() => {
                        pageApi.event('temporary_chat_close_failed', '临时打招呼页未能自动关闭，可手动关闭', 'script', 'warning', {
                            requestId,
                            url: location.href,
                        }).catch(() => null);
                        banner('临时打招呼页已完成，可关闭');
                    }, 1500);
                }, 800);
            };

            const sayHi = async (claim = {}) => {
                const claimedContext = claim.context || tools.getGreetContext();
                const greetRequestId = claimedContext.requestId || '';
                const greetAttempt = Number(claimedContext.attempt || 1);
                const ensureCurrentGreetRequest = () => {
                    if (!greetRequestId) return;
                    const current = tools.getGreetContext();
                    if (current.requestId !== greetRequestId) {
                        throw new Error('greet_request_stale');
                    }
                };
                startBroadcast(this.targets.chatGreet);

                // 心跳
                let count = 0;
                let heartbeatActive = true;
                const loop = () => {
                    if (!heartbeatActive || !this.broadcast) return;
                    this.broadcast.sendAndReceive(
                        this.targets.search,
                        this.bcTypes.HEART_BEAT,
                        { count: ++count }
                    ).then((res) => {
                        if (res.success) {
                            setTimeout(loop, 1000);
                        } else {
                            throw new Error('心跳失联');
                        }
                    }).catch(async (e) => {
                        heartbeatActive = false;
                        await pageApi.heartbeat('chat_greet', 'error', `打招呼页心跳失联: ${e}`);
                        await pageApi.event('greet_heartbeat_failed', `打招呼页心跳失联: ${e}`, 'script', 'error');
                    });
                };
                loop();

                try {
                    await pageApi.heartbeat('chat_greet', 'running', '准备打招呼');
                    await pageApi.event('greet_started', '打招呼窗口准备发送', 'script');
                    const introduce = (await this.broadcast.sendAndReceive(this.targets.search, this.bcTypes.SAY_HI, {
                        greetRequestId,
                        attempt: greetAttempt,
                    })).introduce;
                    if (!introduce) throw new Error('未启用打招呼用语');
                    await tools.actionSleep();
                    ensureCurrentGreetRequest();
                    await sendMsgWithRetries(introduce, claimedContext);
                    const greetContext = claimedContext || {};
                    await pageApi.createAction('greet', {
                        message: introduce,
                        context: greetContext,
                    }, greetContext, 'completed');
                    const sessionGreetCount = tools.increaseSessionGreetCount();
                    const dailyGreetCount = tools.increaseDailyGreetCount();
                    await pageApi.heartbeat('chat_greet', 'running', '打招呼成功');
                    await pageApi.event(
                        'greet_finished',
                        `打招呼消息已发送，本轮计数 ${sessionGreetCount}，今日计数 ${dailyGreetCount}`,
                        'script',
                        'info',
                        { sessionGreetCount, dailyGreetCount, runId: tools.getGreetSession().runId, requestId: greetRequestId, attempt: greetAttempt }
                    );
                    heartbeatActive = false;
                    this.broadcast.send(this.targets.search, this.bcTypes.SAY_HI, {
                        success: true,
                        sessionGreetCount,
                        dailyGreetCount,
                        greetRequestId,
                        attempt: greetAttempt,
                    }).catch(async (sendError) => {
                        await pageApi.event('broadcast_send_failed', `打招呼结果回传失败: ${sendError}`, 'script', 'error');
                    }).finally(() => {
                        this.broadcast.destroy();
                        closeTemporaryChatPage(greetRequestId);
                    });
                } catch (e) {
                    heartbeatActive = false;
                    const transaction = tools.getGreetTransaction(claimedContext.transactionRunId, claimedContext.url);
                    const deliveryUnknown = Boolean(e.deliveryUnknown)
                        || ['send_clicked', 'unknown'].includes(String(transaction.state || ''));
                    if (deliveryUnknown) {
                        tools.updateGreetTransaction(claimedContext.transactionRunId, claimedContext.url, 'unknown', {
                            requestId: greetRequestId,
                            attempt: greetAttempt,
                            error: String(e),
                        });
                    }
                    await pageApi.heartbeat('chat_greet', 'error', String(e));
                    await pageApi.event('greet_failed', `打招呼失败: ${e}`, 'script', 'error');
                    this.broadcast.send(this.targets.search, this.bcTypes.SAY_HI, {
                        success: false,
                        error: String(e),
                        failureCode: e.preSendFailed ? 'message_pre_send_failed' : 'message_send_failed',
                        greetRequestId,
                        attempt: greetAttempt,
                        deliveryUnknown,
                        retryable: false,
                    }).catch(async (sendError) => {
                        await pageApi.event('broadcast_send_failed', `打招呼失败结果回传失败: ${sendError}`, 'script', 'error');
                    }).finally(() => {
                        this.broadcast.destroy();
                        closeTemporaryChatPage(greetRequestId);
                    });
                }
            };


            // 主函数
            const main = async () => {
                // 判断来源
                const now = new Date().getTime();
                const greetOpenedAt = tools.getTimestamp(this.targets.chatGreet);
                const greetAge = greetOpenedAt ? now - greetOpenedAt : null;
                let greetContext = tools.getGreetContext();
                const greetClaim = tools.claimGreetContext();
                if (greetClaim.context && greetClaim.context.requestId) {
                    greetContext = greetClaim.context;
                }
                const contextChatUrl = tools.normalUrl(greetContext.chatUrl || '');
                const currentChatUrl = tools.normalUrl(location.href) || location.href;
                const chatIdentity = (value) => {
                    try {
                        const parsed = new URL(value, location.origin);
                        return `${parsed.origin}${parsed.pathname}`;
                    } catch (e) {
                        return String(value || '').split(/[?#]/)[0];
                    }
                };
                const isLikelySameChat = contextChatUrl
                    ? chatIdentity(currentChatUrl) === chatIdentity(contextChatUrl)
                    : Boolean(greetContext.url || greetContext.title || greetContext.greeting);
                const isRecentGreetWindow = greetAge !== null && greetAge < OPTIONS.timestampTimeout;
                const hasGreetContext = Boolean(greetContext && (
                    greetContext.requestId
                    || greetContext.chatUrl
                    || greetContext.url
                    || greetContext.title
                    || greetContext.greeting
                ));
                const fallbackClaim = (!greetClaim.claimed && isRecentGreetWindow && hasGreetContext)
                    ? tools.claimTimestampGreetFallback(greetOpenedAt)
                    : { claimed: false, reason: '' };
                const canUseTimestampFallback = isRecentGreetWindow
                    && hasGreetContext
                    && !greetClaim.claimed
                    && fallbackClaim.claimed
                    && !['claimed_by_other_page'].includes(String(greetClaim.reason || ''));
                const isGreet = Boolean(greetClaim.claimed) || canUseTimestampFallback;

                if (isGreet) {
                    const effectiveClaim = greetClaim.claimed
                        ? greetClaim
                        : {
                            claimed: true,
                            reason: 'timestamp_fallback',
                            context: {
                                ...greetContext,
                                createdAt: Date.now(),
                                attempt: Number(greetContext.attempt || 1),
                                maxAttempts: Number(greetContext.maxAttempts || OPTIONS.greetMaxAttempts || 3),
                            },
                        };
                    if (canUseTimestampFallback) {
                        await pageApi.event('greet_chat_timestamp_fallback', '打招呼页未认领到 requestId，已按 chatGreet 时间戳继续', 'script', 'warning', {
                            claimReason: greetClaim.reason || '',
                            greetAge,
                            contextChatUrl,
                            currentChatUrl,
                            hasContext: hasGreetContext,
                            fallbackClaimReason: fallbackClaim.reason || '',
                        });
                    }
                    if (!isLikelySameChat) {
                        tools.updateGreetTransaction(greetContext.transactionRunId, greetContext.url, 'failed', {
                            requestId: greetContext.requestId || '',
                            error: 'greet_chat_url_mismatch',
                        });
                        await pageApi.event('greet_chat_url_mismatch', '打招呼聊天页路径与目标不一致，已暂停且不会发送', 'script', 'error', {
                            requestId: greetContext.requestId || '',
                            contextChatUrl,
                            currentChatUrl,
                        });
                        await pageApi.control('pause').catch(() => null);
                        this.broadcast.send(this.targets.search, this.bcTypes.SAY_HI, {
                            success: false,
                            error: 'greet_chat_url_mismatch',
                            greetRequestId: greetContext.requestId || '',
                            attempt: Number(greetContext.attempt || 1),
                            retryable: false,
                            pauseRequired: true,
                            preservePage: true,
                        }).catch(async (sendError) => {
                            await pageApi.event('broadcast_send_failed', `聊天页身份异常回传失败: ${sendError}`, 'script', 'error');
                        });
                        banner('聊天页与目标不一致，自动化已暂停，请人工检查');
                        return;
                    }
                    sayHi(effectiveClaim);
                }
                else {
                    // 日志
                    await pageApi.heartbeat('chat', 'idle', '普通聊天页已忽略：本工具只执行打招呼');
                    await pageApi.event('chat_ignored_not_greet_page', '普通聊天页已忽略：本工具只执行打招呼，不处理附件或简历卡片', 'script', 'info', {
                        path: location.pathname,
                        url: location.href,
                        greetAge,
                        claimReason: greetClaim.reason || '',
                        hasGreetContext,
                    });
                }
            };
            main();
        }

        // 运行
        run(tagIdx = 0) {
            const path = location.pathname;
            // 在搜索页
            if (tools.isSearchPath(path)) {
                this.__search(tagIdx);
            }
            // 在详情页
            else if (tools.pathMatches(this.whiteList.detail)) {
                this.__detail();
            }
            // 在聊天页
            else if (tools.pathMatches(this.whiteList.chat)) {
                this.__chat();
            }
            // 城市首页，例如 /xian/，自动进入职位搜索页。
            else if (tools.isCityHomePath(path) || path === '/') {
                const api = new Api();
                const interruption = tools.detectManualInterruption();
                if (interruption) {
                    api.heartbeat('unmatched', 'error', `需要人工处理: ${interruption}`, { path });
                    api.event('manual_intervention_required', `页面需要人工处理: ${interruption}`, 'script', 'error', { path });
                    new Logger();
                    return;
                }
                api.event('script_city_home_redirect', `城市首页自动进入职位搜索页: ${path}`, 'script', 'info', {
                    path,
                    target: SEARCHPATH.preferred,
                });
                const logger = new Logger(() => {
                    tools.openTabNSetTimestamp(SEARCHPATH.preferred, this.targets.search, true);
                });
                logger.add(`当前是城市首页 ${path}，即将进入推荐岗位页`);
                setTimeout(() => {
                    tools.openTabNSetTimestamp(SEARCHPATH.preferred, this.targets.search, true);
                }, 800);
            }
            // 其他未知页面只提示，不盲目操作。
            else {
                new Api().event('script_page_unmatched', `未匹配页面路径: ${path}`, 'script', 'info', { path });
                new Logger(() => {
                    tools.openTabNSetTimestamp(SEARCHPATH.preferred, this.targets.search, true);
                });
            }
        }
    }

    class Zhaopin {
        constructor() {
            this.api = new Api('zhaopin');
            this.targets = {
                list: '__zhaopin_list',
                detail: '__zhaopin_detail',
            };
            this.types = {
                JOB_INFO: 'zhaopin-job-info',
                APPLY: 'zhaopin-apply',
                APPLY_RESULT: 'zhaopin-apply-result',
                CLOSE: 'zhaopin-close-detail',
            };
            this.contextKey = '__job_seeker_zhaopin_detail_context';
            this.leaseKey = '__job_seeker_zhaopin_list_lease';
            this.urlStateKey = '__job_seeker_zhaopin_url_state';
            this.paginationStateKey = '__job_seeker_zhaopin_pagination_state';
            this.counterKey = '__job_seeker_zhaopin_apply_counter';
            this.pause = true;
            this.running = false;
            this.loopRunning = false;
            this.urls = [];
            this.urlIndex = 0;
            this.queue = [];
            this.seen = new Set();
            this.pending = new Map();
            this.activeTab = null;
            this.backendRunId = '';
            this.cooldownUntil = 0;
            this.cooldownTimer = null;
            this.pageTurnCount = 0;
            this.pageNumber = '';
            this.pageBefore = '';
            this.pageAfter = '';
            this.paginationTarget = '';
            this.lastPageOutcome = 'idle';
            this.listEmptyRetries = 0;
            this.pageJobCountBefore = 0;
            this.pageJobCountAfter = 0;
            this.detailFailureCode = '';
            this.detailFailureCount = 0;
            this.currentJob = null;
            this.leaseTimer = null;
            this.heartbeatTimer = null;
            this.logger = null;
            this.broadcast = null;
        }

        safeJson(key, fallback = {}) {
            try {
                const value = JSON.parse(localStorage.getItem(key) || 'null');
                return value && typeof value === 'object' ? value : fallback;
            } catch (e) {
                return fallback;
            }
        }

        writeJson(key, value) {
            localStorage.setItem(key, JSON.stringify(value));
            return value;
        }

        actionNodes(root = document) {
            return Array.from(root.querySelectorAll('button,a,[role="button"],[class*="button"],[class*="btn"]'))
                .filter(el => tools.isVisible(el) && !el.closest('[data-job-seeker-overlay="1"]'));
        }

        actionButtons(root = document) {
            return this.actionNodes(root).filter(el => !tools.isDisabled(el));
        }

        findActionButton(state, root = null) {
            const scope = root || this.detailActionRoot(document);
            return this.actionNodes(scope).find(el => {
                if (tools.zhaopinActionState(tools.normalizedText(el)) !== state) return false;
                return state === 'already_applied' || !tools.isDisabled(el);
            }) || null;
        }

        detailRoot(root = document) {
            const candidates = [
                '[class*="job-detail"]', '[class*="jobDetail"]', '[class*="position-detail"]',
                '[class*="positionDetail"]', '[class*="detail-content"]', '[class*="job-content"]',
                'main', 'article',
            ];
            for (const selector of candidates) {
                for (const node of Array.from(root.querySelectorAll(selector))) {
                    if (!tools.isVisible(node)) continue;
                    const text = tools.normalizedText(node);
                    if ((text.includes('职位描述') || text.includes('职位详情')) && text.length >= 80) return node;
                }
            }
            const heading = Array.from(root.querySelectorAll('h1,h2,h3,h4,div,span'))
                .find(node => tools.isVisible(node) && /^(职位描述|职位详情)$/.test(tools.normalizedText(node)));
            return heading?.parentElement || root.body || root.documentElement || root;
        }

        detailActionRoot(rootDocument = document) {
            let scope = this.detailRoot(rootDocument);
            for (let depth = 0; scope && depth < 7; depth++, scope = scope.parentElement) {
                const hasAction = this.actionNodes(scope).some(el => {
                    const state = tools.zhaopinActionState(tools.normalizedText(el));
                    return state === 'already_applied' || (state === 'apply' && !tools.isDisabled(el));
                });
                const wholeDocument = scope === rootDocument.body || scope === rootDocument.documentElement;
                if (hasAction && !(wholeDocument && tools.isZhaopinListUrl(location.href))) return scope;
                if (wholeDocument) break;
            }
            return this.detailRoot(rootDocument);
        }

        firstText(root, selectors) {
            for (const selector of selectors) {
                for (const node of Array.from(root.querySelectorAll(selector))) {
                    if (!tools.isVisible(node)) continue;
                    const text = tools.normalizedText(node);
                    if (text) return text;
                }
            }
            return '';
        }

        detailText(root) {
            const direct = this.firstText(root, [
                '[class*="job-description"]', '[class*="jobDescription"]', '[class*="position-description"]',
                '[class*="positionDescription"]', '[class*="describ"]', '[data-testid*="description"]',
            ]);
            if (direct.length >= 40) return direct;
            const heading = Array.from(root.querySelectorAll('h1,h2,h3,h4,div,span'))
                .find(node => tools.isVisible(node) && /^(职位描述|职位详情)$/.test(tools.normalizedText(node)));
            if (heading) {
                const section = heading.closest('section,[class*="section"],[class*="detail"],article') || heading.parentElement;
                const text = tools.normalizedText(section);
                if (text.length >= 40) return text.replace(/^(职位描述|职位详情)\s*/, '');
            }
            const text = tools.normalizedText(root);
            return text.length >= 80 ? text.slice(0, 12000) : '';
        }

        riskReason() {
            const locationReason = tools.interruptionLocationReason();
            if (location.hostname === 'passport.zhaopin.com') return locationReason || '智联登录页面';
            const compact = tools.compactPageText();
            return tools.detectManualInterruption() || tools.detectInterruptionText(compact) || '';
        }

        platformLimitReason() {
            return tools.detectPlatformLimit() || tools.detectPlatformLimitText(tools.compactPageText()) || '';
        }

        readJobInfo(rootDocument = document, context = {}) {
            const root = this.detailRoot(rootDocument);
            const actionRoot = this.detailActionRoot(rootDocument);
            const title = this.firstText(rootDocument, [
                'h1', '[class*="job-name"]', '[class*="jobName"]', '[class*="position-name"]',
                '[class*="positionName"]', '[data-testid*="title"]',
            ]);
            const salary = this.firstText(root, [
                '[class*="salary"]', '[class*="wage"]', '[class*="job-salary"]', '[class*="position-salary"]',
            ]);
            const company = tools.sanitizeCompanyName(this.firstText(rootDocument, [
                '[class*="company-name"]', '[class*="companyName"]', '[class*="company-title"]',
                '[class*="companyTitle"]', '[data-testid*="company"]',
            ]), title, salary);
            const city = this.firstText(root, [
                '[class*="location"]', '[class*="address"]', '[class*="city"]', '[class*="area"]',
            ]);
            const detail = this.detailText(root);
            const alreadyButton = this.findActionButton('already_applied', actionRoot);
            const applyButton = this.findActionButton('apply', actionRoot);
            if (!title) {
                const error = new Error('智联详情页未找到职位名称');
                error.code = 'zhaopin_detail_title_missing';
                throw error;
            }
            if (!detail) {
                const error = new Error('智联详情页未找到职位描述');
                error.code = 'zhaopin_detail_description_missing';
                throw error;
            }
            if (!alreadyButton && !applyButton) {
                const error = new Error('智联详情页未找到立即投递或已投递按钮');
                error.code = 'zhaopin_detail_action_missing';
                throw error;
            }
            const navigationUrl = context.navigationUrl || location.href;
            return {
                requestId: context.requestId || '',
                title,
                salary,
                company,
                city,
                detail,
                url: tools.zhaopinJobIdentityUrl(navigationUrl),
                navigationUrl,
                external_job_id: context.externalJobId || tools.zhaopinJobIdFromValue(navigationUrl),
                alreadyApplied: Boolean(alreadyButton),
                source: context.inline ? 'zhaopin_inline_detail' : 'zhaopin_detail',
            };
        }

        simpleDialogs() {
            const selectors = '[role="dialog"],[aria-modal="true"],[class*="modal"],[class*="dialog"],[class*="popup"]';
            return Array.from(document.querySelectorAll(selectors))
                .filter(node => tools.isVisible(node) && !node.closest('[data-job-seeker-overlay="1"]'));
        }

        async confirmSimpleApplyDialog(resumeName) {
            const deadline = Date.now() + 6000;
            while (Date.now() < deadline) {
                if (this.findActionButton('already_applied')) return { confirmed: true, mode: 'button_changed' };
                const dialog = this.simpleDialogs().find(node => {
                    const text = tools.normalizedText(node);
                    return /投递|简历/.test(text);
                });
                if (!dialog) {
                    await tools.asyncSleep(250);
                    continue;
                }
                const dialogText = tools.normalizedText(dialog);
                const supplementalFields = Array.from(dialog.querySelectorAll(
                    'textarea,select,input[type="file"],input[type="text"],input:not([type])'
                )).filter(node => tools.isVisible(node));
                if (/问卷|补充问题|附加问题|上传附件|作品集|求职信|回答以下/.test(dialogText) || supplementalFields.length) {
                    const error = new Error('智联投递需要填写问卷、附件或补充信息');
                    error.manualIntervention = true;
                    throw error;
                }
                const radios = Array.from(dialog.querySelectorAll('input[type="radio"]'));
                const resumeOptions = Array.from(dialog.querySelectorAll(
                    'input[type="radio"],[role="radio"],[data-resume-id],[class*="resume-item"],[class*="resumeItem"]'
                )).filter(node => tools.isVisible(node));
                if (resumeName) {
                    const textNode = Array.from(dialog.querySelectorAll('label,li,div,span'))
                        .filter(node => tools.isVisible(node))
                        .find(node => tools.normalizedText(node) === resumeName);
                    if (!textNode) {
                        const error = new Error(`未找到配置的智联简历: ${resumeName}`);
                        error.manualIntervention = true;
                        throw error;
                    }
                    const clickable = tools.clickableAncestor(textNode, dialog) || textNode;
                    tools.clickLikeUser(clickable);
                    await tools.asyncSleep(300);
                } else if (
                    (radios.length > 1 && !radios.some(node => node.checked))
                    || (radios.length === 0 && resumeOptions.length > 1
                        && !resumeOptions.some(node => node.getAttribute('aria-checked') === 'true' || node.classList.contains('selected')))
                ) {
                    const error = new Error('智联投递弹窗存在多份简历且没有明确默认项');
                    error.manualIntervention = true;
                    throw error;
                }
                const confirm = this.actionButtons(dialog).find(node => /^(确认投递|确定投递|投递|确认|确定)$/.test(tools.normalizedText(node)));
                if (!confirm) {
                    const error = new Error('智联投递弹窗无法安全确认');
                    error.manualIntervention = true;
                    throw error;
                }
                tools.clickLikeUser(confirm);
                return { confirmed: false, mode: 'simple_dialog_confirmed' };
            }
            return { confirmed: false, mode: 'no_dialog' };
        }

        async executeApply(context) {
            const job = context.job || {};
            const idempotencyKey = context.idempotencyKey || `zhaopin:${job.external_job_id || job.url}:apply`;
            const control = await this.api.heartbeat('detail', 'running', `智联投递前控制检查: ${job.title || ''}`, {
                version: OPTIONS.scriptVersion,
                jobId: job.external_job_id || '',
            });
            if (control.offline || control.should_pause || control.should_stop || !control.should_start) {
                return {
                    success: false,
                    pauseRequired: true,
                    reason: control.offline ? '后端不可用，智联投递已取消' : '智联平台当前未允许运行',
                    requestId: context.requestId,
                };
            }
            const risk = this.riskReason();
            const limit = this.platformLimitReason();
            if (risk || limit) {
                return {
                    success: false,
                    pauseRequired: true,
                    failureKind: limit ? 'platform_limit' : 'manual_intervention',
                    reason: risk || limit,
                    requestId: context.requestId,
                };
            }
            const alreadyButton = this.findActionButton('already_applied');
            if (alreadyButton) {
                await this.api.createAction('already_applied', {
                    idempotencyKey,
                    transactionState: 'confirmed',
                    source: 'detail_before_click',
                }, job, 'confirmed');
                return { success: true, alreadyApplied: true, state: 'confirmed', requestId: context.requestId };
            }
            const button = this.findActionButton('apply');
            if (!button) {
                return { success: false, preClickFailure: true, reason: '未找到可用的立即投递按钮', requestId: context.requestId };
            }
            const clicked = tools.clickLikeUser(button);
            if (!clicked) {
                return { success: false, preClickFailure: true, reason: '立即投递按钮点击失败', requestId: context.requestId };
            }
            await this.api.createAction('apply', {
                idempotencyKey,
                transactionState: 'clicked',
                attempt: Number(context.attempt || 1),
            }, job, 'clicked');
            await tools.asyncSleep(700);
            try {
                await this.confirmSimpleApplyDialog(String(context.resumeName || ''));
            } catch (error) {
                if (error.manualIntervention) {
                    return { success: false, clicked: true, pauseRequired: true, reason: String(error), requestId: context.requestId };
                }
                throw error;
            }
            const deadline = Date.now() + 15000;
            while (Date.now() < deadline) {
                if (this.findActionButton('already_applied')) {
                    await this.api.createAction('apply', {
                        idempotencyKey,
                        transactionState: 'confirmed',
                        verification: 'button_changed_to_applied',
                    }, job, 'confirmed');
                    await this.api.event('apply_confirmed', `智联投递已确认: ${job.title || ''}`, 'script', 'info', {
                        jobId: job.external_job_id || '',
                        url: job.url || '',
                    });
                    return { success: true, state: 'confirmed', requestId: context.requestId };
                }
                const riskAfterClick = this.riskReason() || this.platformLimitReason();
                if (riskAfterClick) {
                    return {
                        success: false,
                        clicked: true,
                        pauseRequired: true,
                        failureKind: this.platformLimitReason() ? 'platform_limit' : 'manual_intervention',
                        reason: riskAfterClick,
                        requestId: context.requestId,
                    };
                }
                await tools.asyncSleep(300);
            }
            await this.api.createAction('apply_delivery_unknown', {
                idempotencyKey,
                transactionState: 'unknown',
                verification: 'button_did_not_change',
            }, job, 'unknown');
            await this.api.event('apply_delivery_unknown', `智联投递结果无法确认: ${job.title || ''}`, 'script', 'error', {
                jobId: job.external_job_id || '',
                url: job.url || '',
            });
            await this.api.control('pause', '投递按钮点击后未变为已投递').catch(() => null);
            return {
                success: false,
                clicked: true,
                pauseRequired: true,
                preservePage: true,
                unknown: true,
                reason: '投递按钮点击后未变为已投递',
                requestId: context.requestId,
            };
        }

        setupBroadcast(target) {
            this.broadcast = new WebBroadcast('__zhaopin_broadcast', target);
            return this.broadcast;
        }

        detailContext() {
            const context = this.safeJson(this.contextKey, {});
            if (!context.createdAt || Date.now() - Number(context.createdAt) > OPTIONS.timestampTimeout) return {};
            return context;
        }

        async runDetail() {
            this.setupBroadcast(this.targets.detail);
            const context = this.detailContext();
            if (!context.requestId) {
                await this.api.heartbeat('detail', 'idle', '智联详情页独立打开，未执行自动动作', {
                    version: OPTIONS.scriptVersion,
                    path: location.pathname,
                });
                return;
            }
            const currentId = tools.zhaopinJobIdFromValue(location.href);
            if (context.externalJobId && currentId && context.externalJobId !== currentId) {
                await this.api.control('pause', '智联详情页与目标岗位不一致').catch(() => null);
                await this.api.event('zhaopin_detail_identity_mismatch', '智联详情页与目标岗位不一致，已暂停', 'script', 'error', {
                    expectedJobId: context.externalJobId,
                    currentJobId: currentId,
                });
                banner('智联详情页与目标岗位不一致，已暂停');
                return;
            }
            this.broadcast.on(this.types.APPLY, async (from, data) => {
                if (from !== this.targets.list || data?.requestId !== context.requestId) return;
                const result = await this.executeApply(data || {}).catch(error => ({
                    success: false,
                    reason: String(error),
                    requestId: context.requestId,
                    clicked: true,
                    unknown: true,
                    preservePage: true,
                }));
                await this.broadcast.send(this.targets.list, this.types.APPLY_RESULT, result).catch(() => null);
                if (result.success && !result.preservePage) setTimeout(() => window.close(), 500);
            });
            this.broadcast.on(this.types.CLOSE, (from, data) => {
                if (from === this.targets.list && (!data?.requestId || data.requestId === context.requestId)) window.close();
            });
            try {
                let jobInfo = null;
                let lastError = null;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        const risk = this.riskReason();
                        const limit = this.platformLimitReason();
                        if (risk || limit) throw new Error(`需要人工处理: ${risk || limit}`);
                        jobInfo = this.readJobInfo(document, context);
                        break;
                    } catch (error) {
                        lastError = error;
                        if (attempt < 3) await tools.asyncSleep(1200 * attempt);
                    }
                }
                if (!jobInfo) throw lastError || new Error('智联详情读取失败');
                await this.api.heartbeat('detail', 'running', `智联详情已读取: ${jobInfo.title}`, {
                    version: OPTIONS.scriptVersion,
                    jobId: jobInfo.external_job_id,
                });
                await this.broadcast.send(this.targets.list, this.types.JOB_INFO, jobInfo);
            } catch (error) {
                const reason = this.riskReason() || this.platformLimitReason() || String(error?.message || error);
                await this.broadcast.send(this.targets.list, this.types.JOB_INFO, {
                    requestId: context.requestId,
                    pageFailure: true,
                    reason,
                    failureCode: String(error.code || ''),
                    manualIntervention: Boolean(this.riskReason() || this.platformLimitReason()),
                }).catch(() => null);
                await this.api.heartbeat('detail', 'error', reason, { version: OPTIONS.scriptVersion });
            }
            this.heartbeatTimer = setInterval(async () => {
                const response = await this.api.heartbeat('detail', 'running', '等待智联列表页评分或投递指令', {
                    version: OPTIONS.scriptVersion,
                    jobId: context.externalJobId || '',
                });
                if (response.should_stop || response.should_pause) clearInterval(this.heartbeatTimer);
            }, 5000);
        }

        leaseSnapshot() {
            const lease = this.safeJson(this.leaseKey, {});
            if (!lease.updatedAt || Date.now() - Number(lease.updatedAt) > 15000) return {};
            return lease;
        }

        acquireLease() {
            const lease = this.leaseSnapshot();
            if (lease.owner && lease.owner !== PAGE_INSTANCE_ID) return false;
            this.writeJson(this.leaseKey, { owner: PAGE_INSTANCE_ID, updatedAt: Date.now() });
            const confirmed = this.leaseSnapshot();
            if (confirmed.owner !== PAGE_INSTANCE_ID) return false;
            if (!this.leaseTimer) {
                this.leaseTimer = setInterval(() => {
                    this.writeJson(this.leaseKey, { owner: PAGE_INSTANCE_ID, updatedAt: Date.now() });
                }, 5000);
            }
            return true;
        }

        releaseLease() {
            if (this.leaseTimer) clearInterval(this.leaseTimer);
            this.leaseTimer = null;
            const lease = this.leaseSnapshot();
            if (lease.owner === PAGE_INSTANCE_ID) localStorage.removeItem(this.leaseKey);
        }

        counterState() {
            const now = new Date();
            const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const saved = this.safeJson(this.counterKey, {});
            return {
                date: today,
                runId: this.backendRunId,
                runCount: saved.runId === this.backendRunId ? Number(saved.runCount || 0) : 0,
                dailyCount: saved.date === today ? Number(saved.dailyCount || 0) : 0,
                nextAllowedAt: Number(saved.nextAllowedAt || 0),
            };
        }

        saveCounter(state) {
            return this.writeJson(this.counterKey, state);
        }

        applicationLimitReason() {
            const state = this.counterState();
            if (OPTIONS.zhaopinMaxApplicationsPerRun > 0 && state.runCount >= OPTIONS.zhaopinMaxApplicationsPerRun) {
                return `智联本轮投递达到本地上限 ${OPTIONS.zhaopinMaxApplicationsPerRun}`;
            }
            if (OPTIONS.zhaopinMaxApplicationsPerDay > 0 && state.dailyCount >= OPTIONS.zhaopinMaxApplicationsPerDay) {
                return `智联今日投递达到本地上限 ${OPTIONS.zhaopinMaxApplicationsPerDay}`;
            }
            return '';
        }

        async waitForApplicationInterval() {
            const state = this.counterState();
            const remaining = state.nextAllowedAt - Date.now();
            if (remaining > 0) {
                this.logger?.add(`智联投递随机间隔，等待 ${(remaining / 1000).toFixed(1)} 秒`);
                await tools.asyncSleep(remaining);
            }
        }

        markApplicationAttempt(confirmed = false) {
            const state = this.counterState();
            state.nextAllowedAt = Date.now() + tools.randomApplyDelayMs(
                OPTIONS.zhaopinApplyDelayMinSeconds,
                OPTIONS.zhaopinApplyDelayMaxSeconds,
            );
            if (confirmed) {
                state.runCount += 1;
                state.dailyCount += 1;
            }
            this.saveCounter(state);
            return state;
        }

        heartbeatDetail() {
            const counter = this.counterState();
            return {
                version: OPTIONS.scriptVersion,
                platform: 'zhaopin',
                configuredUrls: this.urls.map(url => tools.logSafeUrl(url)),
                currentUrlIndex: this.urlIndex,
                currentUrl: tools.logSafeUrl(location.href),
                queuedJobs: this.queue.length,
                seenJobs: this.seen.size,
                currentJobId: this.currentJob?.externalJobId || '',
                currentJobTitle: this.currentJob?.title || '',
                listMode: 'pagination',
                paginationMode: 'next_button',
                pageNumber: this.pageNumber,
                pageTurnCount: this.pageTurnCount,
                pageTarget: this.paginationTarget,
                lastPageOutcome: this.lastPageOutcome,
                pageBefore: this.pageBefore,
                pageAfter: this.pageAfter,
                pageJobCountBefore: this.pageJobCountBefore,
                pageJobCountAfter: this.pageJobCountAfter,
                // 保留旧滚动字段，便于既有状态页展示；智联值明确标记为分页。
                scrollMode: 'pagination',
                scrollTarget: this.paginationTarget,
                scrollRound: this.pageTurnCount,
                lastScrollOutcome: this.lastPageOutcome,
                scrollBefore: this.pageBefore,
                scrollAfter: this.pageAfter,
                scrollJobCountBefore: this.pageJobCountBefore,
                scrollJobCountAfter: this.pageJobCountAfter,
                cooldownUntil: this.cooldownUntil ? new Date(this.cooldownUntil).toISOString() : '',
                runApplyCount: counter.runCount,
                dailyApplyCount: counter.dailyCount,
                nextApplyAllowedAt: counter.nextAllowedAt ? new Date(counter.nextAllowedAt).toISOString() : '',
            };
        }

        async syncControl(action = '智联岗位列表运行中') {
            const response = await this.api.heartbeat('list', this.pause ? 'paused' : 'running', action, this.heartbeatDetail());
            applyBackendConfig(response.config);
            this.urls = Array.isArray(OPTIONS.zhaopinJobUrls) && OPTIONS.zhaopinJobUrls.length
                ? OPTIONS.zhaopinJobUrls.filter(url => tools.isZhaopinListUrl(url))
                : ['https://www.zhaopin.com/recommend'];
            this.backendRunId = response.run_id || this.backendRunId;
            if (response.offline) {
                this.pause = true;
                this.running = false;
                this.releaseLease();
                return false;
            }
            if (response.should_pause || response.should_stop || !OPTIONS.zhaopinEnabled) {
                this.pause = true;
                this.running = false;
                this.releaseLease();
                return false;
            }
            if (response.should_start) {
                this.pause = false;
                return true;
            }
            return false;
        }

        async pausePlatform(reason, type = 'zhaopin_platform_pause', preservePage = false) {
            this.pause = true;
            this.running = false;
            this.releaseLease();
            this.logger?.setPaused(true);
            this.logger?.add(`智联已暂停: ${reason}`);
            await this.api.event(type, `智联已暂停: ${reason}`, 'script', 'error', {
                preservePage,
                jobId: this.currentJob?.externalJobId || '',
            });
            await this.api.control('pause', reason).catch(() => null);
            await this.api.heartbeat('list', 'paused', reason, this.heartbeatDetail()).catch(() => null);
        }

        currentConfiguredIndex() {
            const current = tools.zhaopinListSourceIdentity(location.href);
            let index = this.urls.findIndex(url => tools.zhaopinListSourceIdentity(url) === current);
            if (index < 0) {
                const currentPath = `${location.origin}${location.pathname}`.replace(/\/+$/, '');
                index = this.urls.findIndex(url => {
                    try {
                        const parsed = new URL(url);
                        return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '') === currentPath;
                    } catch (e) {
                        return false;
                    }
                });
            }
            return index;
        }

        restorePaginationState() {
            const saved = this.safeJson(this.paginationStateKey, {});
            if (saved.runId === this.backendRunId && Number(saved.urlIndex) === this.urlIndex) {
                this.pageTurnCount = Math.max(0, Number(saved.pageTurnCount || 0));
                this.lastPageOutcome = saved.pending ? 'page_navigation_restored' : String(saved.lastPageOutcome || 'idle');
                this.pageBefore = String(saved.pageBefore || '');
                this.pageNumber = this.currentPageMarker();
                this.pageAfter = this.pageNumber || String(saved.pageAfter || '');
                if (saved.pending) this.savePaginationState({ pending: false });
                return;
            }
            this.resetPaginationState(this.urlIndex, 'source_initialized');
        }

        savePaginationState(patch = {}) {
            const current = this.safeJson(this.paginationStateKey, {});
            return this.writeJson(this.paginationStateKey, {
                ...current,
                runId: this.backendRunId,
                urlIndex: this.urlIndex,
                pageTurnCount: this.pageTurnCount,
                lastPageOutcome: this.lastPageOutcome,
                pageBefore: this.pageBefore,
                pageAfter: this.pageAfter,
                updatedAt: Date.now(),
                ...patch,
            });
        }

        resetPaginationState(index = this.urlIndex, reason = 'source_reset') {
            this.pageTurnCount = 0;
            this.pageNumber = '';
            this.pageBefore = '';
            this.pageAfter = '';
            this.paginationTarget = '';
            this.lastPageOutcome = reason;
            this.pageJobCountBefore = 0;
            this.pageJobCountAfter = 0;
            this.writeJson(this.paginationStateKey, {
                runId: this.backendRunId,
                urlIndex: index,
                pageTurnCount: 0,
                lastPageOutcome: reason,
                pageBefore: '',
                pageAfter: '',
                pending: false,
                updatedAt: Date.now(),
            });
        }

        navigateToUrl(index, reason) {
            const target = this.urls[index];
            if (!target) return false;
            this.writeJson(this.urlStateKey, { index, reason, updatedAt: Date.now() });
            if (location.href.split('#')[0] === target.split('#')[0]) return false;
            this.resetPaginationState(index, reason || 'source_switch');
            this.api.event('zhaopin_list_url_switch', `切换智联岗位页 ${index + 1}/${this.urls.length}: ${reason}`, 'script', 'info', {
                target: tools.logSafeUrl(target),
                index,
            });
            location.href = target;
            return true;
        }

        jobLinkSelectors() {
            return [
                'a[href*="/jobdetail/"]', 'a[href*="/job-detail/"]', 'a[href*="/job/"]',
                'a[href*="positionNumber="]', 'a[href*="positionId="]', 'a[href*="jobId="]',
            ];
        }

        collectCandidates() {
            const candidates = [];
            const identities = new Set();
            for (const node of Array.from(document.querySelectorAll(this.jobLinkSelectors().join(',')))) {
                const href = tools.normalUrl(node.getAttribute('href'));
                if (!href || tools.isZhaopinListUrl(href)) continue;
                const externalJobId = tools.zhaopinJobIdFromValue(href);
                if (!externalJobId && !/\/(?:jobdetail|job-detail|job)\//i.test(new URL(href).pathname)) continue;
                const identity = tools.zhaopinJobIdentityUrl(href);
                if (!identity || identities.has(identity)) continue;
                identities.add(identity);
                candidates.push({ navigationUrl: href, identity, externalJobId, element: node, inline: false });
            }
            if (!candidates.length) {
                const inlineNodes = Array.from(document.querySelectorAll(
                    '[data-positionnumber],[data-position-number],[data-jobid],[class*="job-card"],[class*="jobCard"],[class*="position-item"]'
                )).filter(node => tools.isVisible(node)).slice(0, 200);
                inlineNodes.forEach((node, index) => {
                    const externalJobId = node.getAttribute('data-positionnumber')
                        || node.getAttribute('data-position-number')
                        || node.getAttribute('data-jobid')
                        || '';
                    const text = tools.normalizedText(node).slice(0, 180);
                    if (!text || (!externalJobId && text.length < 20)) return;
                    const identity = externalJobId ? `zhaopin:inline:${externalJobId}` : `zhaopin:inline:${index}:${text}`;
                    if (identities.has(identity)) return;
                    identities.add(identity);
                    candidates.push({ navigationUrl: '', identity, externalJobId, element: node, inline: true });
                });
            }
            return candidates;
        }

        enqueueNewCandidates() {
            const existing = new Set(this.queue.map(item => item.identity));
            const found = this.collectCandidates();
            let added = 0;
            for (const candidate of found) {
                if (this.seen.has(candidate.identity) || existing.has(candidate.identity)) continue;
                this.queue.push(candidate);
                existing.add(candidate.identity);
                added += 1;
            }
            return added;
        }

        paginationRootSelector() {
            return [
                '[class*="pagination"]', '[class*="Pagination"]',
                '[class*="pager"]', '[class*="Pager"]',
                '[class*="soupager"]',
                'nav[aria-label*="分页"]', '[role="navigation"][aria-label*="分页"]',
            ].join(',');
        }

        clickablePaginationNode(node) {
            if (!node) return null;
            if (node.matches?.('button,a,[role="button"]')) return node;
            return node.querySelector?.('button,a,[role="button"]') || node;
        }

        clickPaginationControl(node) {
            const target = this.clickablePaginationNode(node);
            if (!target) return false;
            try { target.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
            try { target.focus?.({ preventScroll: true }); } catch (e) {}
            try {
                target.click();
                return true;
            } catch (e) {
                try {
                    const view = target.ownerDocument?.defaultView || window;
                    target.dispatchEvent(new view.MouseEvent('click', { bubbles: true, cancelable: true, view }));
                    return true;
                } catch (ignore) {
                    return false;
                }
            }
        }

        paginationControlMeta(node) {
            const clickable = this.clickablePaginationNode(node);
            const rootSelector = this.paginationRootSelector();
            const paginationRoot = node.closest?.(rootSelector) || clickable?.closest?.(rootSelector) || null;
            return {
                element: clickable,
                inPagination: Boolean(paginationRoot),
                text: tools.normalizedText(clickable || node),
                ariaLabel: clickable?.getAttribute?.('aria-label') || node.getAttribute?.('aria-label') || '',
                ariaDisabled: clickable?.getAttribute?.('aria-disabled') || node.getAttribute?.('aria-disabled') || '',
                title: clickable?.getAttribute?.('title') || node.getAttribute?.('title') || '',
                rel: clickable?.getAttribute?.('rel') || node.getAttribute?.('rel') || '',
                className: String(clickable?.className || node.className || ''),
                parentClassName: String(clickable?.parentElement?.className || node.parentElement?.className || ''),
                disabled: tools.isDisabled(clickable || node),
            };
        }

        findNextPageControl() {
            const directSelectors = [
                'a[rel="next"]', 'button[rel="next"]',
                '[aria-label="下一页"]', '[title="下一页"]',
                '[aria-label="Next Page" i]', '[title="Next Page" i]',
                '.ant-pagination-next', '.soupager__btn--next',
                '[class*="pagination"] [class*="next"]', '[class*="Pagination"] [class*="next"]',
                '[class*="pager"] [class*="next"]', '[class*="Pager"] [class*="next"]',
                '[class*="soupager"] [class*="next"]',
            ];
            const candidates = [];
            const seen = new Set();
            const add = (node) => {
                const element = this.clickablePaginationNode(node);
                if (!element || seen.has(element) || element.closest?.('[data-job-seeker-overlay="1"]')) return;
                seen.add(element);
                candidates.push(node);
            };
            for (const selector of directSelectors) {
                try { document.querySelectorAll(selector).forEach(add); } catch (e) {}
            }
            try {
                document.querySelectorAll(this.paginationRootSelector()).forEach(root => {
                    root.querySelectorAll('button,a,[role="button"]').forEach(add);
                });
            } catch (e) {}
            try {
                document.querySelectorAll('button,a,[role="button"]').forEach(node => {
                    if (/^(?:下一页|下页|next(?:\s*page)?)(?:\s*[>›»])?$/i.test(tools.normalizedText(node))) add(node);
                });
            } catch (e) {}
            let disabled = null;
            for (const node of candidates) {
                const meta = this.paginationControlMeta(node);
                if (!meta.element || !tools.isVisible(meta.element)) continue;
                const state = tools.zhaopinPaginationControlState(meta);
                if (state === 'next') return { state, element: meta.element, meta };
                if (state === 'disabled' && !disabled) disabled = { state, element: meta.element, meta };
            }
            return disabled || { state: 'missing', element: null, meta: {} };
        }

        currentPageMarker() {
            const selectors = [
                '.ant-pagination-item-active',
                '[class*="pagination"] [aria-current="page"]', '[class*="Pagination"] [aria-current="page"]',
                '[class*="pagination"] [class*="active"]', '[class*="Pagination"] [class*="active"]',
                '[class*="pager"] [class*="active"]', '[class*="Pager"] [class*="active"]',
                '[class*="soupager"] [class*="active"]',
            ];
            for (const selector of selectors) {
                let nodes = [];
                try { nodes = Array.from(document.querySelectorAll(selector)); } catch (e) {}
                for (const node of nodes) {
                    if (!tools.isVisible(node)) continue;
                    const match = tools.normalizedText(node).match(/\d+/);
                    if (match) return match[0];
                }
            }
            try {
                const parsed = new URL(location.href);
                for (const key of ['page', 'pageNo', 'pageNum', 'pageIndex', 'currentPage', 'current', 'p']) {
                    const value = parsed.searchParams.get(key);
                    if (/^\d+$/.test(value || '')) return value;
                }
            } catch (e) {}
            return '';
        }

        paginationSnapshot() {
            const candidates = this.collectCandidates();
            return {
                url: location.href,
                page: this.currentPageMarker(),
                jobCount: candidates.length,
                fingerprint: candidates.map(item => item.identity).sort().join('|'),
            };
        }

        async waitForPageTransition(before, timeoutMs = 10000) {
            const deadline = Date.now() + timeoutMs;
            let latest = this.paginationSnapshot();
            let outcome = tools.zhaopinPageTransitionOutcome(before, latest);
            while (Date.now() < deadline) {
                const risk = this.riskReason();
                const limit = this.platformLimitReason();
                if (risk || limit) throw new Error(risk || limit);
                if (outcome.ready) return { verified: true, after: latest, outcome };
                await tools.asyncSleep(500);
                latest = this.paginationSnapshot();
                outcome = tools.zhaopinPageTransitionOutcome(before, latest);
            }
            return { verified: outcome.changed, after: latest, outcome };
        }

        async turnToNextPage() {
            const maxTurns = Math.max(0, Math.min(20, Number(OPTIONS.searchResultScrollRounds) || 0));
            if (this.pageTurnCount >= maxTurns) {
                this.lastPageOutcome = 'page_turn_limit';
                this.savePaginationState({ pending: false });
                return false;
            }
            const before = this.paginationSnapshot();
            this.pageBefore = before.page || '';
            this.pageAfter = before.page || '';
            this.pageNumber = before.page || this.pageNumber;
            this.pageJobCountBefore = before.jobCount;
            this.pageJobCountAfter = before.jobCount;
            let lastControl = { state: 'missing', element: null, meta: {} };
            for (let attempt = 1; attempt <= 3; attempt++) {
                const alreadyChanged = tools.zhaopinPageTransitionOutcome(before, this.paginationSnapshot());
                if (alreadyChanged.changed) {
                    lastControl = { state: 'next', element: lastControl.element, meta: lastControl.meta };
                } else {
                    lastControl = this.findNextPageControl();
                    if (lastControl.state === 'disabled') {
                        this.paginationTarget = tools.elementBrief(lastControl.element);
                        this.lastPageOutcome = 'last_page';
                        this.savePaginationState({ pending: false });
                        return false;
                    }
                    if (lastControl.state === 'missing') {
                        if (attempt < 3) {
                            this.lastPageOutcome = `waiting_for_next_button_${attempt}`;
                            await tools.asyncSleep(1000 * attempt);
                            continue;
                        }
                        this.paginationTarget = '';
                        this.lastPageOutcome = 'next_button_missing';
                        this.savePaginationState({ pending: false });
                        return false;
                    }
                    this.paginationTarget = tools.elementBrief(lastControl.element);
                    this.lastPageOutcome = 'next_button_selected';
                    await this.api.event('zhaopin_next_page_selected', `智联下一页按钮已定位，准备第 ${attempt}/3 次翻页`, 'script', 'info', {
                        attempt,
                        pageTurnCount: this.pageTurnCount,
                        pageBefore: this.pageBefore,
                        target: this.paginationTarget,
                        urlIndex: this.urlIndex,
                    });
                    this.savePaginationState({
                        pending: true,
                        pageTurnCount: this.pageTurnCount + 1,
                    });
                    if (!this.clickPaginationControl(lastControl.element)) {
                        this.lastPageOutcome = `next_click_failed_${attempt}`;
                        if (attempt < 3) await tools.asyncSleep(800 * attempt);
                        continue;
                    }
                    await this.api.event('zhaopin_next_page_clicked', `智联已点击下一页 ${attempt}/3`, 'script', 'info', {
                        attempt,
                        pageBefore: this.pageBefore,
                        urlIndex: this.urlIndex,
                    });
                }
                const transition = await this.waitForPageTransition(before);
                this.pageAfter = transition.after.page || this.pageAfter;
                this.pageNumber = transition.after.page || this.pageNumber;
                this.pageJobCountAfter = transition.after.jobCount;
                if (transition.verified) {
                    this.pageTurnCount += 1;
                    this.lastPageOutcome = transition.outcome.jobsChanged ? 'page_jobs_changed' : 'page_changed';
                    this.listEmptyRetries = 0;
                    this.enqueueNewCandidates();
                    this.savePaginationState({ pending: false });
                    await this.api.event('zhaopin_next_page_verified', `智联下一页已生效: ${this.pageBefore || '?'} -> ${this.pageAfter || '?'}`, 'script', 'info', {
                        pageTurnCount: this.pageTurnCount,
                        pageBefore: this.pageBefore,
                        pageAfter: this.pageAfter,
                        jobCountBefore: this.pageJobCountBefore,
                        jobCountAfter: this.pageJobCountAfter,
                        urlChanged: transition.outcome.urlChanged,
                        pageChanged: transition.outcome.pageChanged,
                        jobsChanged: transition.outcome.jobsChanged,
                        urlIndex: this.urlIndex,
                    });
                    return true;
                }
                this.lastPageOutcome = `next_click_unconfirmed_${attempt}`;
                if (attempt < 3) await tools.asyncSleep(800 * attempt);
            }
            this.savePaginationState({ pending: false });
            throw new Error('智联下一页连续点击 3 次后，页码、网址和岗位列表均未变化');
        }

        waitFor(type, requestId, timeout = OPTIONS.jobInfoResponseTimeout) {
            const key = `${type}:${requestId}`;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pending.delete(key);
                    reject(new Error(`等待智联详情页响应超时: ${type}`));
                }, timeout);
                this.pending.set(key, { resolve, reject, timer });
            });
        }

        resolvePending(type, data) {
            const key = `${type}:${data?.requestId || ''}`;
            const pending = this.pending.get(key);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pending.delete(key);
            pending.resolve(data);
        }

        cancelPending(type, requestId, reason = '') {
            const key = `${type}:${requestId}`;
            const pending = this.pending.get(key);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pending.delete(key);
            if (reason) pending.reject(new Error(reason));
        }

        closeActiveDetail(requestId = '') {
            if (this.broadcast) this.broadcast.send(this.targets.detail, this.types.CLOSE, { requestId }).catch(() => null);
            if (this.activeTab) tools.closeTabHandle(this.activeTab);
            this.activeTab = null;
            localStorage.removeItem(this.contextKey);
        }

        async readCandidate(candidate) {
            const requestId = `zhaopin_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
            const context = {
                requestId,
                navigationUrl: tools.zhaopinJobIdentityUrl(candidate.navigationUrl),
                identity: candidate.identity,
                externalJobId: candidate.externalJobId,
                createdAt: Date.now(),
            };
            this.writeJson(this.contextKey, context);
            if (candidate.inline) {
                if (!candidate.element?.isConnected) throw new Error('智联岗位卡片已失效');
                tools.clickLikeUser(candidate.element);
                await tools.asyncSleep(1200);
                return this.readJobInfo(document, { ...context, inline: true });
            }
            const wait = this.waitFor(this.types.JOB_INFO, requestId);
            this.activeTab = tools.openTabNSetTimestamp(candidate.navigationUrl, this.targets.detail, false, {
                force: true,
                cooldownMs: 0,
            });
            if (!this.activeTab) {
                const reason = '浏览器拦截了智联详情页，请允许 zhaopin.com 弹出窗口';
                this.cancelPending(this.types.JOB_INFO, requestId);
                throw new Error(reason);
            }
            return wait;
        }

        async applyThroughDetail(jobInfo, candidate, attempt = 1) {
            const requestId = jobInfo.requestId || this.detailContext().requestId;
            const idempotencyKey = `zhaopin:${jobInfo.external_job_id || jobInfo.url}:apply`;
            await this.api.createAction('apply', {
                idempotencyKey,
                transactionState: 'prepared',
                score: jobInfo.score,
                threshold: OPTIONS.thread,
            }, jobInfo, 'prepared');
            if (candidate.inline) {
                try {
                    return await this.executeApply({
                        requestId,
                        job: jobInfo,
                        idempotencyKey,
                        resumeName: OPTIONS.zhaopinResumeName,
                        attempt,
                    });
                } catch (error) {
                    return {
                        success: false,
                        clicked: true,
                        unknown: true,
                        preservePage: true,
                        reason: `智联投递指令执行后状态未知: ${error}`,
                        requestId,
                    };
                }
            }
            const wait = this.waitFor(this.types.APPLY_RESULT, requestId, 45000);
            try {
                await this.broadcast.send(this.targets.detail, this.types.APPLY, {
                    requestId,
                    job: jobInfo,
                    idempotencyKey,
                    resumeName: OPTIONS.zhaopinResumeName,
                    attempt,
                });
            } catch (error) {
                this.cancelPending(this.types.APPLY_RESULT, requestId);
                return { success: false, preClickFailure: true, reason: String(error), requestId };
            }
            return wait.catch(error => ({
                success: false,
                clicked: true,
                unknown: true,
                preservePage: true,
                reason: `智联投递指令发出后未收到确认: ${error}`,
                requestId,
            }));
        }

        isDetailCompatibilityFailure(code) {
            return [
                'zhaopin_detail_title_missing',
                'zhaopin_detail_description_missing',
                'zhaopin_detail_action_missing',
            ].includes(String(code || ''));
        }

        resetDetailCompatibilityFailures() {
            this.detailFailureCode = '';
            this.detailFailureCount = 0;
        }

        async handleDetailCompatibilityFailure(code, reason, candidate) {
            const normalizedCode = String(code || 'zhaopin_detail_unknown');
            if (this.detailFailureCode === normalizedCode) this.detailFailureCount += 1;
            else {
                this.detailFailureCode = normalizedCode;
                this.detailFailureCount = 1;
            }
            const message = `智联详情元素异常，已跳过当前岗位 ${this.detailFailureCount}/3: ${reason}`;
            this.logger?.add(message);
            await this.api.event('zhaopin_detail_job_skipped', message, 'script', 'warning', {
                failureCode: normalizedCode,
                consecutiveCount: this.detailFailureCount,
                jobId: candidate?.externalJobId || '',
            });
            if (this.detailFailureCount >= 3) {
                await this.pausePlatform(
                    `智联详情页连续 ${this.detailFailureCount} 个岗位出现同类元素异常: ${reason}`,
                    'zhaopin_detail_compatibility_pause',
                );
            }
        }

        async processCandidate(candidate) {
            this.currentJob = candidate;
            this.seen.add(candidate.identity);
            let jobInfo = null;
            let lastError = null;
            let lastFailureCode = '';
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    jobInfo = await this.readCandidate(candidate);
                    if (jobInfo.pageFailure) {
                        const error = new Error(jobInfo.reason || '智联详情读取失败');
                        error.failureCode = String(jobInfo.failureCode || '');
                        error.manualIntervention = Boolean(jobInfo.manualIntervention);
                        throw error;
                    }
                    break;
                } catch (error) {
                    lastError = error;
                    lastFailureCode = String(error.failureCode || '');
                    this.closeActiveDetail();
                    if (this.riskReason() || this.platformLimitReason() || error.manualIntervention || jobInfo?.manualIntervention) break;
                    if (attempt < 3) {
                        this.logger?.add(`智联详情读取失败 ${attempt}/3，准备重试: ${error}`);
                        await tools.asyncSleep(1500 * attempt);
                    }
                }
            }
            if (!jobInfo || jobInfo.pageFailure) {
                const reason = String(lastError?.message || jobInfo?.reason || lastError || '智联详情读取失败');
                if (!this.riskReason() && !this.platformLimitReason() && this.isDetailCompatibilityFailure(lastFailureCode)) {
                    await this.handleDetailCompatibilityFailure(lastFailureCode, reason, candidate);
                    return;
                }
                await this.pausePlatform(this.riskReason() || this.platformLimitReason() || reason, 'zhaopin_detail_failed');
                return;
            }
            this.resetDetailCompatibilityFailures();
            jobInfo.url = jobInfo.url || candidate.identity;
            jobInfo.external_job_id = jobInfo.external_job_id || candidate.externalJobId;
            this.currentJob = { ...candidate, title: jobInfo.title, externalJobId: jobInfo.external_job_id };
            if (jobInfo.alreadyApplied) {
                const idempotencyKey = `zhaopin:${jobInfo.external_job_id || jobInfo.url}:apply`;
                await this.api.createAction('already_applied', {
                    idempotencyKey,
                    transactionState: 'confirmed',
                    source: 'detail_read',
                }, jobInfo, 'confirmed');
                await this.api.event('already_applied', `智联岗位已投递，跳过: ${jobInfo.title}`, 'script', 'info', {
                    jobId: jobInfo.external_job_id,
                });
                this.logger?.add(`已投递，跳过: ${jobInfo.title}`);
                this.closeActiveDetail(jobInfo.requestId);
                return;
            }
            this.logger?.add(`智联开始评分: ${jobInfo.title}`);
            const analysis = await this.api.analyzeJob({
                title: jobInfo.title,
                salary: jobInfo.salary || '',
                detail: jobInfo.detail,
                company: jobInfo.company || '',
                city: jobInfo.city || '',
                url: jobInfo.url,
                external_job_id: jobInfo.external_job_id || '',
                talked: false,
            });
            const score = Number(analysis.total_score || 0);
            jobInfo.score = score;
            this.logger?.add(`智联匹配度: ${score}`);
            await this.api.event('job_analysis_finished', `智联职位分析完成: ${jobInfo.title} / ${score}`, 'script', 'info', {
                title: jobInfo.title,
                jobId: jobInfo.external_job_id,
                score,
                platformAction: analysis.platform_action || '',
            });
            if (!(await this.syncControl(`智联评分完成: ${jobInfo.title}`))) return;
            const shouldApply = score >= OPTIONS.thread
                && (analysis.platform_action === 'apply' || (!analysis.platform_action && analysis.recommendation === 'greet'));
            if (!shouldApply) {
                await this.api.event('decision_skip', `智联跳过职位: ${jobInfo.title} / ${score}`, 'script', 'info', {
                    jobId: jobInfo.external_job_id,
                    score,
                    recommendation: analysis.recommendation || '',
                    reason: analysis.match_reason || analysis.blocked_reason || '',
                });
                this.closeActiveDetail(jobInfo.requestId);
                return;
            }
            const localLimit = this.applicationLimitReason();
            if (localLimit) {
                await this.pausePlatform(localLimit, 'zhaopin_local_apply_limit');
                return;
            }
            await this.waitForApplicationInterval();
            if (!(await this.syncControl(`智联准备投递: ${jobInfo.title}`))) return;
            const result = await this.applyThroughDetail(jobInfo, candidate, 1).catch(error => ({
                success: false,
                preClickFailure: true,
                reason: String(error),
            }));
            if (result.success) {
                if (!result.alreadyApplied) {
                    const counter = this.markApplicationAttempt(true);
                    this.logger?.add(`智联投递成功，本轮 ${counter.runCount}，今日 ${counter.dailyCount}`);
                } else {
                    this.logger?.add(`智联岗位已投递，已同步历史: ${jobInfo.title}`);
                }
                this.closeActiveDetail(jobInfo.requestId);
                return;
            }
            if (result.preClickFailure && !result.clicked) {
                let finalResult = result;
                for (let attempt = 2; attempt <= 3 && finalResult.preClickFailure && !finalResult.clicked; attempt++) {
                    await tools.asyncSleep(1200 * attempt);
                    finalResult = await this.applyThroughDetail(jobInfo, candidate, attempt).catch(error => ({
                        success: false,
                        preClickFailure: true,
                        reason: String(error),
                    }));
                }
                if (finalResult.success) {
                    if (!finalResult.alreadyApplied) {
                        const counter = this.markApplicationAttempt(true);
                        this.logger?.add(`智联投递成功，本轮 ${counter.runCount}，今日 ${counter.dailyCount}`);
                    } else {
                        this.logger?.add(`智联岗位已投递，已同步历史: ${jobInfo.title}`);
                    }
                    this.closeActiveDetail(jobInfo.requestId);
                    return;
                }
                result.reason = finalResult.reason || result.reason;
                if (finalResult.clicked) result.clicked = true;
                if (finalResult.preservePage) result.preservePage = true;
                if (finalResult.unknown) result.unknown = true;
            }
            if (result.clicked) {
                this.markApplicationAttempt(false);
                if (result.unknown) {
                    await this.api.createAction('apply_delivery_unknown', {
                        idempotencyKey: `zhaopin:${jobInfo.external_job_id || jobInfo.url}:apply`,
                        transactionState: 'unknown',
                        reason: result.reason || '投递指令发出后状态未知',
                    }, jobInfo, 'unknown').catch(() => null);
                }
            }
            if (!result.clicked) {
                await this.api.createAction('apply', {
                    idempotencyKey: `zhaopin:${jobInfo.external_job_id || jobInfo.url}:apply`,
                    transactionState: 'failed',
                    reason: result.reason || '投递前操作失败',
                }, jobInfo, 'failed').catch(() => null);
            }
            const pauseEventType = result.unknown
                ? 'apply_delivery_unknown'
                : (result.failureKind === 'platform_limit' ? 'platform_limit_pause'
                    : (result.failureKind === 'manual_intervention' ? 'manual_intervention_required' : 'zhaopin_apply_failed'));
            await this.pausePlatform(result.reason || '智联投递失败', pauseEventType, Boolean(result.preservePage || result.clicked));
            if (!result.preservePage && !result.clicked) this.closeActiveDetail(jobInfo.requestId);
        }

        async switchOrCooldown(reason) {
            if (this.urlIndex + 1 < this.urls.length) {
                this.navigateToUrl(this.urlIndex + 1, reason);
                return;
            }
            const min = Math.max(1, Number(OPTIONS.searchRoundCooldownMinMinutes || 1));
            const max = Math.max(min, Number(OPTIONS.searchRoundCooldownMinutes || min));
            const minutes = min + Math.random() * (max - min);
            this.cooldownUntil = Date.now() + Math.floor(minutes * 60 * 1000);
            this.writeJson(this.urlStateKey, {
                index: this.urlIndex,
                reason: 'all_urls_exhausted',
                cooldownUntil: this.cooldownUntil,
                updatedAt: Date.now(),
            });
            this.logger?.add(`智联岗位页均已耗尽，冷却 ${minutes.toFixed(1)} 分钟`);
            await this.api.event('zhaopin_cooldown_started', `智联岗位页均已耗尽，进入冷却`, 'script', 'info', {
                cooldownUntil: new Date(this.cooldownUntil).toISOString(),
                urlCount: this.urls.length,
            });
            this.scheduleCooldownResume();
        }

        scheduleCooldownResume() {
            if (this.cooldownTimer) clearTimeout(this.cooldownTimer);
            if (!this.cooldownUntil) return;
            this.cooldownTimer = setTimeout(() => {
                this.cooldownTimer = null;
                if (this.pause) return;
                this.cooldownUntil = 0;
                this.writeJson(this.urlStateKey, {
                    index: 0,
                    reason: 'cooldown_finished',
                    cooldownUntil: 0,
                    updatedAt: Date.now(),
                });
                this.resetPaginationState(0, 'cooldown_finished');
                location.href = this.urls[0];
            }, Math.max(1000, this.cooldownUntil - Date.now()));
        }

        async loop() {
            if (this.loopRunning || this.pause) return;
            this.loopRunning = true;
            try {
                if (!this.acquireLease()) return;
                const risk = this.riskReason();
                const limit = this.platformLimitReason();
                if (risk || limit) {
                    await this.pausePlatform(risk || limit, risk ? 'manual_intervention_required' : 'platform_limit_pause');
                    return;
                }
                if (this.queue.length === 0) {
                    const foundCount = this.enqueueNewCandidates();
                    if (foundCount > 0) {
                        this.listEmptyRetries = 0;
                    } else if (this.collectCandidates().length === 0 && this.listEmptyRetries < 3) {
                        this.listEmptyRetries += 1;
                        this.lastPageOutcome = `waiting_for_cards_${this.listEmptyRetries}`;
                        this.logger?.add(`智联岗位卡片尚未加载，等待重试 ${this.listEmptyRetries}/3`);
                        await tools.asyncSleep(1200 * this.listEmptyRetries);
                        if (!this.pause) setTimeout(() => this.loop(), 0);
                        return;
                    }
                }
                if (this.queue.length > 0) {
                    const candidate = this.queue.shift();
                    if (candidate.element && !candidate.element.isConnected && candidate.inline) {
                        setTimeout(() => this.loop(), 0);
                        return;
                    }
                    await this.processCandidate(candidate);
                    if (!this.pause) setTimeout(() => this.loop(), 0);
                    return;
                }
                const mayContinue = await this.turnToNextPage();
                if (this.queue.length > 0 || mayContinue) {
                    setTimeout(() => this.loop(), 0);
                    return;
                }
                await this.api.event('zhaopin_pagination_exhausted', `智联岗位页已耗尽: ${this.lastPageOutcome}`, 'script', 'info', this.heartbeatDetail());
                await this.switchOrCooldown(this.lastPageOutcome);
            } catch (error) {
                if (tools.isBackendUnavailableError(error)) {
                    this.pause = true;
                    this.running = false;
                    this.releaseLease();
                    this.logger?.add(`后端不可用，智联已暂停: ${error}`);
                } else {
                    await this.pausePlatform(String(error), 'zhaopin_loop_failed');
                }
            } finally {
                this.loopRunning = false;
                this.currentJob = null;
            }
        }

        async runList() {
            this.setupBroadcast(this.targets.list);
            this.broadcast.on(this.types.JOB_INFO, (from, data) => {
                if (from === this.targets.detail) this.resolvePending(this.types.JOB_INFO, data || {});
            });
            this.broadcast.on(this.types.APPLY_RESULT, (from, data) => {
                if (from === this.targets.detail) this.resolvePending(this.types.APPLY_RESULT, data || {});
            });
            this.logger = new Logger(
                async () => this.api.control('resume'),
                async () => this.api.control('pause', '用户在智联页面点击暂停'),
            );
            this.logger.add('智联招聘脚本已就绪，等待 CLI start');
            const ready = await this.syncControl('智联岗位列表已连接');
            if (!this.urls.length) {
                await this.pausePlatform('未配置有效的智联岗位列表网址', 'zhaopin_config_invalid');
                return;
            }
            const currentIndex = this.currentConfiguredIndex();
            const savedUrlState = this.safeJson(this.urlStateKey, {});
            this.cooldownUntil = Number(savedUrlState.cooldownUntil || 0);
                if (this.cooldownUntil && this.cooldownUntil <= Date.now()) {
                    this.cooldownUntil = 0;
                    this.writeJson(this.urlStateKey, { index: 0, reason: 'cooldown_finished', cooldownUntil: 0, updatedAt: Date.now() });
                    this.resetPaginationState(0, 'cooldown_finished');
                    location.href = this.urls[0];
                    return;
                }
                this.urlIndex = currentIndex >= 0 ? currentIndex : Number(savedUrlState.index || 0);
                if (currentIndex < 0 && this.navigateToUrl(Math.min(this.urlIndex, this.urls.length - 1), '进入用户配置的智联岗位页')) return;
                this.restorePaginationState();
            if (ready && this.acquireLease()) {
                this.running = true;
                this.logger.setPaused(false);
                if (this.cooldownUntil) this.scheduleCooldownResume();
                else this.loop();
            }
            this.heartbeatTimer = setInterval(async () => {
                if (this.cooldownUntil && Date.now() >= this.cooldownUntil) {
                    this.cooldownUntil = 0;
                    this.writeJson(this.urlStateKey, { index: 0, reason: 'cooldown_finished', cooldownUntil: 0, updatedAt: Date.now() });
                    this.resetPaginationState(0, 'cooldown_finished');
                    location.href = this.urls[0];
                    return;
                }
                const shouldRun = await this.syncControl(this.cooldownUntil && Date.now() < this.cooldownUntil
                    ? '智联岗位页冷却中'
                    : '智联岗位列表运行中');
                if (shouldRun && !this.running) {
                    if (!this.acquireLease()) return;
                    this.running = true;
                    this.logger.setPaused(false);
                    if (this.cooldownUntil && Date.now() < this.cooldownUntil) this.scheduleCooldownResume();
                    else this.loop();
                } else if (shouldRun && !this.loopRunning && !(this.cooldownUntil && Date.now() < this.cooldownUntil)) {
                    this.loop();
                }
            }, 3000);
            window.addEventListener('beforeunload', () => this.releaseLease());
        }

        async runPassport() {
            const reason = '智联招聘需要登录，请完成登录后返回岗位页';
            await this.api.heartbeat('login', 'paused', reason, {
                version: OPTIONS.scriptVersion,
                path: location.pathname,
                humanRequired: true,
            });
            await this.api.event('manual_intervention_required', reason, 'script', 'error', {
                path: location.pathname,
                humanRequired: true,
            });
            await this.api.control('pause', reason).catch(() => null);
            banner(reason);
        }

        run() {
            if (location.hostname === 'passport.zhaopin.com') {
                this.runPassport();
                return;
            }
            if (tools.isZhaopinListUrl(location.href)) {
                this.runList();
                return;
            }
            const context = this.detailContext();
            if (context.requestId) {
                this.runDetail();
                return;
            }
            this.api.heartbeat('unmatched', 'idle', '智联页面不是配置的岗位列表或受控详情页', {
                version: OPTIONS.scriptVersion,
                path: location.pathname,
            });
            new Logger(() => {
                location.href = OPTIONS.zhaopinJobUrls[0] || 'https://www.zhaopin.com/recommend';
            });
        }
    }

    if (globalThis.__JOB_SEEKER_TEST_MODE__) {
        globalThis.__JOB_SEEKER_TEST_HOOKS__ = Object.freeze({
            detectInterruptionText: (text) => tools.detectInterruptionText(text),
            detectPlatformLimitText: (text) => tools.detectPlatformLimitText(text),
            detectQuotaWarningText: (text) => tools.detectQuotaWarningText(text),
            isQuotaReminderText: (text) => tools.isQuotaReminderText(text),
            quotaReminderReasonFromValue: (value) => tools.quotaReminderReasonFromValue(value),
            isChatEntryRejectedError: (value) => tools.isChatEntryRejectedError(value),
            isSystemFeedName: (text) => tools.isSystemFeedName(text),
            isIgnoredFeedName: (text) => tools.isIgnoredFeedName(text),
            isCompositeFeedName: (text) => tools.isCompositeFeedName(text),
            isLikelyCustomFeedName: (text) => tools.isLikelyCustomFeedName(text),
            isStrongCustomFeedName: (text) => tools.isStrongCustomFeedName(text),
            sanitizeCompanyName: (value, title, salary) => tools.sanitizeCompanyName(value, title, salary),
            isBackendUnavailableError: (value) => tools.isBackendUnavailableError(value),
            jobIdentityUrl: (value) => tools.jobIdentityUrl(value),
            jobIdFromValue: (value) => tools.jobIdFromValue(value),
            logSafeUrl: (value) => tools.logSafeUrl(value),
            sanitizeTelemetryText: (value) => tools.sanitizeTelemetryText(value),
            documentScrollFallbackEligible: (metrics) => tools.documentScrollFallbackEligible(metrics),
            scrollMetricsOutcome: (before, after) => tools.scrollMetricsOutcome(before, after),
            zhaopinJobIdFromValue: (value) => tools.zhaopinJobIdFromValue(value),
            zhaopinJobIdentityUrl: (value) => tools.zhaopinJobIdentityUrl(value),
            isZhaopinListUrl: (value) => tools.isZhaopinListUrl(value),
            zhaopinActionState: (value) => tools.zhaopinActionState(value),
            zhaopinPaginationControlState: (meta) => tools.zhaopinPaginationControlState(meta),
            zhaopinListSourceIdentity: (value) => tools.zhaopinListSourceIdentity(value),
            zhaopinPageTransitionOutcome: (before, after) => tools.zhaopinPageTransitionOutcome(before, after),
            randomApplyDelayMs: (min, max, randomValue) => tools.randomApplyDelayMs(min, max, randomValue),
        });
        return;
    }

    if (location.hostname === 'www.zhaopin.com' || location.hostname === 'passport.zhaopin.com') {
        new Zhaopin().run();
    } else {
        new Zhipin().run();
    }
})();
