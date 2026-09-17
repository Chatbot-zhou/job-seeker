const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('web_script.js', 'utf8');
const context = { __JOB_SEEKER_TEST_MODE__: true, URL };
vm.createContext(context);
vm.runInContext(source, context);
const hooks = context.__JOB_SEEKER_TEST_HOOKS__;

test('risk classifier ignores generic job text and detects real challenges', () => {
  assert.equal(hooks.detectInterruptionText('负责 login service、verify token 和 rate limit 设计'), '');
  assert.match(hooks.detectInterruptionText('请完成安全验证后继续访问'), /安全验证/);
  assert.match(hooks.detectInterruptionText('登录状态已失效，请重新登录'), /登录/);
  assert.match(hooks.detectPlatformLimitText('访问过于频繁，请稍后再试'), /频繁/);
  assert.equal(hooks.detectQuotaWarningText('今天剩余次数还有30次'), '平台额度提醒');
  assert.equal(hooks.detectPlatformLimitText('您今天已与120位BOSS沟通，还剩30次沟通机会哦'), '');
});

test('risk detection avoids generic whole-page English tokens', () => {
  assert.doesNotMatch(source, /body\.innerText[\s\S]{0,200}\b(?:verify|login|limit)\b/i);
  assert.match(source, /riskSurfaceText/);
  assert.match(source, /interruptionLocationReason/);
});

test('search safety state persists across refreshes', () => {
  assert.match(source, /__job_seeker_search_budget/);
  assert.match(source, /__job_seeker_search_round_state/);
  assert.match(source, /__job_seeker_search_cooldown_resume_state/);
  assert.match(source, /maxSearchSubmissionsPerHour/);
  assert.match(source, /maxSearchSubmissionsPerDay/);
  assert.match(source, /searchRoundCooldownMinMinutes:\s*1/);
  assert.match(source, /searchRoundCooldownMinutes:\s*5/);
});

test('job list scrolling prefers containers and safely supports document fallback', () => {
  assert.match(source, /jobListFingerprint/);
  assert.match(source, /search_result_scroll_verified/);
  assert.match(source, /isLikelyLeftJobArea/);
  assert.match(source, /elementHasJobSignal/);
  assert.match(source, /isDetailLikeContainer/);
  assert.doesNotMatch(source, /job\[-_ \]\?sec\|sider\|side\|company\|chat/);
  assert.match(source, /targetDetailLike/);
  assert.match(source, /findJobListScrollCandidates/);
  assert.match(source, /dispatchJobListWheel/);
  assert.match(source, /new WheelEvent\('wheel'/);
  assert.match(source, /search_result_scroll_all_targets_failed/);
  assert.match(source, /scrollCandidateDebug/);
  assert.match(source, /recommend-job-list/);
  assert.match(source, /\[class\*="job-recommend"\]/);
  assert.match(source, /isFilterLikeContainer/);
  assert.match(source, /data-job-seeker-overlay/);
  assert.match(source, /pageHasJobSignal/);
  assert.match(source, /leftScrollableFallback/);
  assert.match(source, /nearestScrollableAncestor/);
  assert.match(source, /jobListRootCandidates/);
  assert.match(source, /isLeftScrollableGeometryFallback/);
  assert.match(source, /overlapsJobSignalArea/);
  assert.match(source, /pointTarget/);
  assert.match(source, /jobLinkCount\(el\) < 3 && jobCardCount\(el\) < 3/);
  assert.match(source, /documentScrollFallbackAllowed/);
  assert.match(source, /document\.scrollingElement/);
  assert.match(source, /window\.scrollBy\s*\(/);
  assert.match(source, /search_scroll_target_selected/);
  assert.match(source, /search_scroll_exhausted/);
  assert.equal(hooks.documentScrollFallbackEligible({
    path: '/web/geek/jobs', jobLinkCount: 17, jobCardCount: 45, scrollHeight: 2433, clientHeight: 900,
  }), true);
  assert.equal(hooks.documentScrollFallbackEligible({
    path: '/job_detail/example.html', jobLinkCount: 17, jobCardCount: 45, scrollHeight: 2433, clientHeight: 900,
  }), false);
  assert.equal(hooks.documentScrollFallbackEligible({
    path: '/web/geek/chat', jobLinkCount: 17, jobCardCount: 45, scrollHeight: 2433, clientHeight: 900,
  }), false);
  assert.equal(hooks.documentScrollFallbackEligible({
    path: '/web/geek/jobs', jobLinkCount: 17, jobCardCount: 45, scrollHeight: 2433, clientHeight: 900, riskBlocked: true,
  }), false);
  assert.equal(hooks.documentScrollFallbackEligible({
    path: '/web/geek/jobs', jobLinkCount: 0, jobCardCount: 0, scrollHeight: 2433, clientHeight: 900,
  }), false);
  const exhaustedOutcome = hooks.scrollMetricsOutcome(
    { position: 1200, contentHeight: 2100, jobCount: 20, fingerprint: 'same' },
    { position: 1200, viewportHeight: 900, contentHeight: 2100, jobCount: 20, fingerprint: 'same' },
  );
  assert.equal(exhaustedOutcome.moved, false);
  assert.equal(exhaustedOutcome.changed, false);
  assert.equal(exhaustedOutcome.exhausted, true);
  const loadedOutcome = hooks.scrollMetricsOutcome(
    { position: 0, contentHeight: 2100, jobCount: 20, fingerprint: 'old' },
    { position: 600, viewportHeight: 900, contentHeight: 2700, jobCount: 28, fingerprint: 'new' },
  );
  assert.equal(loadedOutcome.moved, true);
  assert.equal(loadedOutcome.changed, true);
  assert.equal(loadedOutcome.exhausted, false);
  const positionOnlyOutcome = hooks.scrollMetricsOutcome(
    { position: 0, contentHeight: 2100, jobCount: 20, fingerprint: 'same' },
    { position: 600, viewportHeight: 900, contentHeight: 2100, jobCount: 20, fingerprint: 'same' },
  );
  assert.equal(positionOnlyOutcome.moved, true);
  assert.equal(positionOnlyOutcome.changed, false);
  assert.equal(positionOnlyOutcome.exhausted, false);
  assert.match(source, /search_scroll_round_limit_reached/);
});

test('job identity ignores dynamic query data and telemetry redacts security ids', () => {
  const jobUrl = 'https://www.zhipin.com/job_detail/abc123.html?securityId=secret-value&lid=other#anchor';
  assert.equal(hooks.jobIdentityUrl(jobUrl), 'https://www.zhipin.com/job_detail/abc123.html');
  assert.equal(hooks.jobIdFromValue(jobUrl), 'abc123');
  assert.equal(hooks.jobIdFromValue('https://www.zhipin.com/web/geek/chat?jobId=job-123'), 'job-123');
  const entryUrl = 'https://www.zhipin.com/wapi/zpgeek/friend/add.json?securityId=secret-value&jobId=job-123';
  assert.equal(hooks.logSafeUrl(entryUrl), 'https://www.zhipin.com/wapi/zpgeek/friend/add.json?jobId=job-123');
  const message = hooks.sanitizeTelemetryText(`请求入口: ${entryUrl}`);
  assert.doesNotMatch(message, /securityId|secret-value/);
  assert.match(message, /jobId=job-123/);
  assert.match(source, /const activeKeyword = currentJobSource === 'keyword_search'/);
  assert.match(source, /sourceLabel: activeSourceLabel/);
});

test('Zhaopin adapter normalizes identity, paginates safely, isolates apply semantics, and bounds delays', () => {
  const url = 'https://www.zhaopin.com/jobdetail/CC123.htm?positionId=CC123&securityId=secret#detail';
  assert.equal(hooks.zhaopinJobIdFromValue(url), 'CC123');
  assert.equal(hooks.zhaopinJobIdentityUrl(url), 'https://www.zhaopin.com/jobdetail/CC123.htm');
  assert.equal(hooks.isZhaopinListUrl('https://www.zhaopin.com/recommend'), true);
  assert.equal(hooks.isZhaopinListUrl('https://www.zhaopin.com/sou/?jl=489'), true);
  // 新版搜索域必须被接受：后端 config 归一化也只认这几个域名，两边不能各说各话。
  assert.equal(hooks.isZhaopinListUrl('https://sou.zhaopin.com/?kw=算法工程师'), true);
  assert.equal(hooks.isZhaopinListUrl('https://www.zhaopin.com/jobs'), true);
  assert.equal(hooks.isZhaopinListUrl(url), false);
  assert.equal(hooks.zhaopinActionState('立即投递'), 'apply');
  assert.equal(hooks.zhaopinActionState('已投递'), 'already_applied');
  assert.equal(hooks.zhaopinActionState('立即沟通'), 'ignore');
  assert.equal(hooks.zhaopinPaginationControlState({ text: '下一页', inPagination: true }), 'next');
  assert.equal(hooks.zhaopinPaginationControlState({ text: '›', className: 'ant-pagination-next', inPagination: true }), 'next');
  assert.equal(hooks.zhaopinPaginationControlState({ ariaLabel: '下一页', disabled: true }), 'disabled');
  assert.equal(hooks.zhaopinPaginationControlState({ text: '下一职位', inPagination: true }), 'ignore');
  assert.equal(hooks.zhaopinPaginationControlState({ text: '立即投递', inPagination: true }), 'ignore');
  assert.equal(
    hooks.zhaopinListSourceIdentity('https://www.zhaopin.com/sou/?page=3&jl=489#jobs'),
    'https://www.zhaopin.com/sou/?jl=489',
  );
  const pageChanged = hooks.zhaopinPageTransitionOutcome(
    { url: 'https://www.zhaopin.com/recommend', page: '1', jobCount: 20, fingerprint: 'jobs-1' },
    { url: 'https://www.zhaopin.com/recommend', page: '2', jobCount: 20, fingerprint: 'jobs-2' },
  );
  assert.equal(pageChanged.pageChanged, true);
  assert.equal(pageChanged.jobsChanged, true);
  assert.equal(pageChanged.ready, true);
  const unchangedPage = hooks.zhaopinPageTransitionOutcome(
    { url: 'https://www.zhaopin.com/recommend', page: '2', jobCount: 20, fingerprint: 'jobs-2' },
    { url: 'https://www.zhaopin.com/recommend', page: '2', jobCount: 20, fingerprint: 'jobs-2' },
  );
  assert.equal(unchangedPage.changed, false);
  assert.equal(unchangedPage.ready, false);
  assert.equal(hooks.randomApplyDelayMs(3, 10, 0), 3000);
  assert.equal(hooks.randomApplyDelayMs(3, 10, 1), 10000);
  assert.match(source, /@match\s+https:\/\/www\.zhaopin\.com\/\*/);
  assert.match(source, /@match\s+https:\/\/passport\.zhaopin\.com\/\*/);
  assert.match(source, /transactionState:\s*'unknown'/);
  assert.match(source, /apply_delivery_unknown/);
  assert.match(source, /detailActionRoot/);
  assert.match(source, /state === 'already_applied' \|\| !tools\.isDisabled\(el\)/);
  assert.match(source, /text === '立即投递'/);
  assert.match(source, /text === '已投递'/);
  assert.match(source, /zhaopin_next_page_selected/);
  assert.match(source, /zhaopin_next_page_clicked/);
  assert.match(source, /zhaopin_next_page_verified/);
  assert.match(source, /zhaopin_pagination_exhausted/);
  assert.match(source, /clickPaginationControl/);
  assert.doesNotMatch(source, /clickLikeUser\(lastControl\.element\)/);
  assert.match(source, /zhaopin_detail_action_missing/);
  assert.match(source, /zhaopin_detail_job_skipped/);
  assert.match(source, /zhaopin_detail_compatibility_pause/);
  assert.match(source, /this\.detailFailureCount\s*>=\s*3/);
  assert.match(source, /paginationMode:\s*'next_button'/);
  const zhaopinAdapter = source.slice(source.indexOf('class Zhaopin'), source.indexOf('if (globalThis.__JOB_SEEKER_TEST_MODE__)'));
  // 早期版本规定智联“只翻页不滑动”，结果新版懒加载列表没有“下一页”按钮时
  // 会被误判为岗位耗尽、直接进入冷却。现在翻页失败后必须继续尝试滑动。
  assert.match(zhaopinAdapter, /async scrollListForMoreCandidates\(\)/);
  assert.match(zhaopinAdapter, /new WheelEvent\('wheel'/);
  assert.match(source, /cooldownUntil:\s*this\.cooldownUntil/);
  assert.match(source, /for \(let attempt = 2; attempt <= 3 && finalResult\.preClickFailure && !finalResult\.clicked; attempt\+\+\)/);
  assert.match(source, /location\.hostname === 'www\.zhaopin\.com'/);
});

test('Zhaopin structured job fields support JSON-LD and embedded page state', () => {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: '大模型应用工程师',
    hiringOrganization: { '@type': 'Organization', name: '杭州示例科技有限公司' },
    baseSalary: {
      currency: 'CNY',
      value: { minValue: 20, maxValue: 35, unitText: 'K/月' },
    },
    jobLocation: { address: { addressLocality: '杭州' } },
    description: '<p>负责大模型应用开发、评测与工程落地。</p>',
  };
  const fields = hooks.zhaopinStructuredJobFields({ '@graph': [{ '@type': 'BreadcrumbList' }, jsonLd] });
  assert.equal(fields.title, '大模型应用工程师');
  assert.equal(fields.company, '杭州示例科技有限公司');
  assert.match(fields.salary, /20-35/);
  assert.match(fields.salary, /K\/月/);
  assert.equal(fields.city, '杭州');
  assert.match(fields.detail, /大模型应用开发/);

  const embedded = hooks.zhaopinStructuredJobFields({
    props: {
      pageProps: {
        position: {
          positionName: '后端开发工程师',
          companyName: '上海示例网络有限公司',
          salaryDesc: '18-28K',
          cityName: '上海',
          positionDescription: '负责服务端系统设计、开发和稳定性建设。',
        },
      },
    },
  });
  assert.equal(embedded.company, '上海示例网络有限公司');
  assert.equal(embedded.salary, '18-28K');
  assert.equal(embedded.city, '上海');
});

test('Zhaopin pagination recovery trusts the real page and never fast-forwards after reload', () => {
  const saved = {
    runId: 'run-a',
    sourceIdentity: 'https://www.zhaopin.com/recommend',
    pageNumber: '8',
    fingerprint: 'jobs-page-8',
    pageTurnCount: 7,
  };
  const restored = hooks.zhaopinPaginationRestoreDecision(saved, {
    runId: 'run-a',
    sourceIdentity: 'https://www.zhaopin.com/recommend',
    pageNumber: '8',
    fingerprint: 'jobs-page-8',
  });
  assert.equal(restored.reset, false);
  assert.equal(restored.reason, 'state_restored');
  assert.equal(restored.pageTurnCount, 7);
  const reloaded = hooks.zhaopinPaginationRestoreDecision(saved, {
    runId: 'run-a',
    sourceIdentity: 'https://www.zhaopin.com/recommend',
    pageNumber: '1',
    fingerprint: 'jobs-page-1',
  });
  assert.equal(reloaded.reset, true);
  assert.equal(reloaded.reason, 'page_mismatch_after_reload');
  assert.equal(reloaded.pageTurnCount, 0);
  const changedJobs = hooks.zhaopinPaginationRestoreDecision(saved, {
    runId: 'run-a',
    sourceIdentity: 'https://www.zhaopin.com/recommend',
    pageNumber: '8',
    fingerprint: 'changed-jobs-page-8',
  });
  assert.equal(changedJobs.reason, 'fingerprint_mismatch_after_reload');
  assert.match(source, /zhaopin_pagination_state_reset/);
});

test('Zhaopin recent identities seed URL and stable job id dedupe keys', () => {
  const keys = Array.from(hooks.zhaopinRecentIdentityKeys({
    url: 'https://www.zhaopin.com/jobdetail/CC123.htm?securityId=secret',
    external_job_id: 'CC123',
  }));
  assert.deepEqual(
    [...keys].sort(),
    ['https://www.zhaopin.com/jobdetail/CC123.htm', 'zhaopin:inline:CC123'].sort(),
  );
  assert.match(source, /getRecentJobs\('zhaopin'\)/);
  assert.match(source, /zhaopin_recent_jobs_loaded/);
});

test('platform panels can start pause and stop without requiring CLI start', () => {
  assert.match(source, /api\.control\('start', '用户在 BOSS 页面控制面板点击开始'\)/);
  assert.match(source, /this\.api\.control\('start', '用户在智联页面控制面板点击开始'\)/);
  assert.match(source, /stopBtn\.innerText = "结束"/);
  assert.match(source, /当前平台已结束，可点击开始重新运行/);
  assert.doesNotMatch(source, /请回到 CLI 输入 start/);
});

test('both platforms render the same score breakdown and card company fallback', () => {
  const analysis = {
    education_score: 70,
    skill_score: 80,
    experience_score: 60,
    total_score: 72,
  };
  assert.equal(
    hooks.analysisScoreSummary(analysis),
    '学历专业 70 / 技术栈 80 / 项目经验 60 / 加权匹配度 72',
  );
  assert.equal(hooks.platformActionLabel('greet'), '打招呼');
  assert.equal(hooks.platformActionLabel('apply'), '立即投递');
  assert.match(source, /companyNameFromJobCard/);
  assert.match(source, /jobCardMetadata/);
  assert.match(source, /candidate\.company/);
  assert.match(source, /scoringVersion: analysis\.scoring_version/);
});

test('cooldown resumes once and returns to preferred feeds before keyword search', () => {
  assert.match(source, /tryAcquireCooldownResumeLock/);
  assert.match(source, /markCooldownResumeDone/);
  assert.match(source, /cooldownResumeRedirecting/);
  assert.match(source, /preferred_feed_after_cooldown_started/);
  assert.match(source, /搜索冷却结束，优先处理用户自定义推荐源/);
  assert.match(source, /Math\.min\(requestedUntil,\s*randomUntil\)/);
  const cooldownResume = source.indexOf('if (OPTIONS.preferredFeedMode !==');
  const keywordResume = source.indexOf("await beginSearchRound('cooldown_finished')", cooldownResume);
  assert.ok(cooldownResume >= 0 && keywordResume > cooldownResume, 'preferred feeds should be considered before keyword search after cooldown');
});

test('ordinary element failures skip first and pause after three matching failures', () => {
  assert.match(source, /pageFailureRetryCount\s*>=\s*3/);
  assert.match(source, /element_compatibility_pause/);
  assert.match(source, /已跳过且不刷新搜索页/);
  assert.doesNotMatch(source, /location\.reload\s*\(/);
});

test('feed tabs are rediscovered and map-like controls are excluded', () => {
  assert.match(source, /discoverPreferredFeedTabs/);
  assert.match(source, /切换自定义推荐源/);
  assert.match(source, /地图/);
  assert.match(source, /otherName\.startsWith\(name\)/);
  assert.match(source, /role[^\n]{0,80}tab|tabSemantics/i);
  assert.equal(hooks.isSystemFeedName('推荐'), true);
  assert.equal(hooks.isLikelyCustomFeedName('地图'), false);
  assert.equal(hooks.isLikelyCustomFeedName('筛选'), false);
  assert.equal(hooks.isLikelyCustomFeedName('校园'), false);
  assert.equal(hooks.isLikelyCustomFeedName('APP'), false);
  assert.equal(hooks.isLikelyCustomFeedName('求职类型'), false);
  assert.equal(hooks.isLikelyCustomFeedName('立即沟通'), false);
  assert.equal(hooks.isLikelyCustomFeedName('早九晚六点半/企业客服审核员/不加班'), false);
  assert.equal(hooks.isLikelyCustomFeedName('自然语言处理算法(北京)'), true);
  assert.equal(hooks.isLikelyCustomFeedName('大模型算法(西安)'), true);
  assert.equal(hooks.isCompositeFeedName('推荐 自然语言处理算法(北京) 大模型算法(杭州)'), true);
  assert.equal(hooks.isCompositeFeedName('自然语言处理算法(北京) 大模型算法(杭州)'), true);
  assert.equal(hooks.isLikelyCustomFeedName('推荐 自然语言处理算法(北京) 大模型算法(杭州)'), false);
  assert.equal(hooks.isStrongCustomFeedName('推荐 自然语言处理算法(北京) 大模型算法(杭州)'), false);
  assert.equal(hooks.isStrongCustomFeedName('自然语言处理算法(北京)'), true);
  assert.equal(hooks.isStrongCustomFeedName('大模型算法(杭州)'), true);
  assert.equal(hooks.isStrongCustomFeedName('西安'), false);
  assert.equal(hooks.isStrongCustomFeedName('周晨博'), false);
  assert.equal(hooks.isStrongCustomFeedName('早九晚六点半/企业客服审核员/不加班'), false);
});

test('finished preferred feed phase does not restart from the first tab', () => {
  assert.match(source, /preferred_feed_already_finished/);
  assert.match(source, /hasPreferredFeedCompletedForRun\(\)/);
  assert.match(source, /preferredFeedCooldownStateKey/);
  assert.match(source, /cooldownStartedEventKey/);
  assert.match(source, /!\(cooldownUntil && Date\.now\(\) < cooldownUntil\)/);
  assert.match(source, /preferred_feed_during_search_cooldown/);
  assert.match(source, /preferred_feed_cooldown_cycle_finished/);
  const prepareBranch = source.indexOf('const preparePreferredFeeds = async () => {');
  const completedGuard = source.indexOf('if (preferredFeedsDone || hasPreferredFeedCompletedForRun())', prepareBranch);
  const rediscover = source.indexOf('const result = await discoverPreferredFeedTabs();', prepareBranch);
  const completedReturn = source.indexOf('return false;', completedGuard);
  assert.ok(prepareBranch >= 0 && completedGuard > prepareBranch);
  assert.ok(rediscover > completedGuard, 'completed preferred feeds must be guarded before rediscovery');
  assert.ok(completedReturn > completedGuard && completedReturn < rediscover, 'completed preferred feeds should fall through to keyword search instead of reopening pages');
  const resetBranch = source.indexOf('localStorage.removeItem(preferredFeedStateKey)');
  const sessionReset = source.indexOf("api.event('session_counter_reset'");
  assert.ok(resetBranch >= 0 && sessionReset > resetBranch, 'new backend runs should clear the previous preferred-feed completion state');
});

test('active preferred feed progress is saved and restored after refresh', () => {
  assert.match(source, /savePreferredFeedProgress/);
  assert.match(source, /restorePreferredFeedProgress/);
  assert.match(source, /preferred_feed_progress_restored/);
  assert.match(source, /restore_after_refresh/);
  const prepareBranch = source.indexOf('const preparePreferredFeeds = async () => {');
  const rediscover = source.indexOf('const result = await discoverPreferredFeedTabs();', prepareBranch);
  const restoreBranch = source.indexOf('const restored = restorePreferredFeedProgress();', prepareBranch);
  const selectBranch = source.indexOf('selectPreferredFeedTab(startIndex', prepareBranch);
  assert.ok(prepareBranch >= 0 && rediscover > prepareBranch);
  assert.ok(restoreBranch > rediscover, 'preferred feed state should be restored after current DOM tabs are rediscovered');
  assert.ok(selectBranch > restoreBranch, 'restored custom tab should be selected before reading jobs');
});

test('preferred feed tab switching retries instead of skipping target tabs', () => {
  assert.match(source, /clickPreferredFeedElement/);
  assert.match(source, /preferred_feed_tab_switch_retry/);
  assert.match(source, /preferred_feed_tab_switch_assumed/);
  assert.doesNotMatch(source, /preferred_feed_tab_switch_unconfirmed/);
  assert.doesNotMatch(source, /推荐源切换未确认，跳过/);
  const switchBranch = source.indexOf('const selectPreferredFeedTab = async (index');
  const retryBranch = source.indexOf('for (let attempt = 1; attempt <= maxSwitchAttempts; attempt++)', switchBranch);
  const confirmBranch = source.indexOf("api.event('preferred_feed_tab_switch_confirmed'", switchBranch);
  assert.ok(switchBranch >= 0 && retryBranch > switchBranch);
  assert.ok(confirmBranch > retryBranch, 'feed tab switching should confirm after retry loop');
});

test('send-clicked unknown results are skipped without reopening chat', () => {
  assert.match(source, /send_clicked/);
  assert.match(source, /greet_delivery_unknown/);
  assert.match(source, /已跳过当前岗位并继续/);
  assert.doesNotMatch(source, /greet_unknown_pause_failed/);
  const unknownBranch = source.indexOf('if (deliveryUnknown)');
  const unknownReturn = source.indexOf('return;', unknownBranch);
  const retryBranch = source.indexOf('if (canRetry)', unknownBranch);
  assert.ok(unknownBranch >= 0 && unknownReturn > unknownBranch);
  assert.ok(retryBranch > unknownReturn, 'unknown delivery must return before retry handling');
});

test('chat send retries stay in the same page and search does not reopen chat on send failure', () => {
  assert.match(source, /sendMsgWithRetries/);
  assert.match(source, /message_send_attempt_retry/);
  assert.match(source, /chatSearchRoots/);
  assert.match(source, /activateGreetConversation/);
  assert.match(source, /chat_conversation_activation_clicked/);
  assert.match(source, /chat_conversation_activated/);
  assert.match(source, /\[role="textbox"\]\[contenteditable="true"\]/);
  assert.match(source, /data-slate-editor/);
  assert.match(source, /failureCode:\s*e\.preSendFailed \? 'message_pre_send_failed'/);
  assert.match(source, /retryable:\s*false/);
  assert.match(source, /打招呼连续 \$\{maxAttempts\} 次失败，系统已暂停/);
  assert.match(source, /api\.control\('pause'\)/);
});

test('greeting window timeout retries before final pause', () => {
  const timeoutBranch = source.indexOf("error: 'greet_window_timeout'");
  assert.ok(timeoutBranch >= 0);
  const retryableTrue = source.indexOf('retryable: true', timeoutBranch);
  const handleResultEnd = source.indexOf('});', timeoutBranch);
  assert.ok(retryableTrue > timeoutBranch && retryableTrue < handleResultEnd);
  assert.match(source, /greet_retry_scheduled/);
  assert.match(source, /openGreetingChat\(jobInfo, href, `retry_after_\$\{error\}`, nextAttempt\)/);
});

test('chat entry rejection pauses instead of falling back into an unusable chat page', () => {
  assert.equal(hooks.isChatEntryRejectedError('Error: 无法进行沟通'), true);
  assert.equal(hooks.isChatEntryRejectedError('Error: BOSS 网络响应异常: 502'), false);
  assert.match(source, /greet_entry_rejected/);
  const rejectedBranch = source.indexOf('if (tools.isChatEntryRejectedError(e))');
  const fallbackBranch = source.indexOf('if (jobInfo.chatUrl)', rejectedBranch);
  const rejectedReturn = source.indexOf('return;', rejectedBranch);
  assert.ok(rejectedBranch >= 0 && rejectedReturn > rejectedBranch);
  assert.ok(fallbackBranch > rejectedReturn, 'entry rejection must return before chatUrl fallback');
});

test('boss quota reminder is confirmed instead of treated as a hard limit', () => {
  const text = '温馨提示 您今天已与120位BOSS沟通，还剩30次沟通机会哦 好';
  assert.equal(hooks.isQuotaReminderText(text), true);
  assert.match(hooks.quotaReminderReasonFromValue({ zpData: { bizData: { chatRemindDialog: { title: '温馨提示', content: text } } } }), /BOSS 温馨提示/);
  assert.match(source, /findQuotaReminderDialog/);
  assert.match(source, /confirmQuotaReminderDialog/);
  assert.match(source, /clickLikeUser/);
  assert.match(source, /quota_reminder_confirmed/);
  assert.match(source, /quota_reminder_response_proceed/);
  assert.match(source, /接口返回额度提醒但已给出聊天入口，继续打开聊天页/);
  assert.match(source, /chat_entry_quota_reminder_unconfirmed/);
  assert.doesNotMatch(source, /继续当前流程: \$\{quotaReason\}/);
  assert.doesNotMatch(source, /dailyGreetSafeLimit|sessionGreetLimit/);
});

test('company extraction does not mistake title and salary for company', () => {
  assert.equal(hooks.sanitizeCompanyName('AI研发工程师\n15-25K', 'AI研发工程师', '15-25K'), '');
  assert.equal(hooks.sanitizeCompanyName('AI研发工程师 15-25K', 'AI研发工程师', '15-25K'), '');
  assert.equal(hooks.sanitizeCompanyName('杭州示例科技有限公司\nD轮及以上', 'AI研发工程师', '15-25K'), '杭州示例科技有限公司');
});

test('backend shutdown pauses search loop instead of retrying forever', () => {
  assert.equal(hooks.isBackendUnavailableError('请求失败: /jobs/analyze HTTP 500 background shutdown'), true);
  assert.equal(hooks.isBackendUnavailableError('OpenAI 请求失败: HTTP 404'), false);
  assert.match(source, /handleBackendUnavailable/);
  assert.match(source, /backend_unavailable_pause/);
  assert.match(source, /后端不可用，脚本已暂停/);
  const catchBranch = source.indexOf('if (tools.isBackendUnavailableError(e))');
  const loopFailedBranch = source.indexOf("api.event('loop_failed'", catchBranch);
  assert.ok(catchBranch >= 0 && loopFailedBranch > catchBranch, 'backend unavailable should be checked before generic loop_failed');
});

test('background tabs remain non-active', () => {
  assert.match(source, /GM_openInTab/);
  assert.match(source, /active:\s*false/);
});

test('Job51 adapter normalizes identity, list URLs, pagination detail, and apply state', () => {
  assert.equal(hooks.job51JobIdFromValue('https://we.51job.com/pc/job/123456'), '123456');
  assert.equal(hooks.job51JobIdFromValue('https://we.51job.com/pc/job/123456.html'), '123456');
  assert.equal(hooks.job51JobIdFromValue('https://we.51job.com/pc/job/123456?jobId=999'), '999');
  assert.equal(hooks.job51JobIdFromValue('https://jobs.51job.com/hangzhou/123456.html'), '123456');
  assert.equal(hooks.job51JobIdentityUrl('https://we.51job.com/pc/job/123456?from=list#top'), 'https://we.51job.com/pc/job/123456');

  assert.equal(hooks.isJob51ListUrl('https://we.51job.com/pc/search?keyword=python'), true);
  assert.equal(hooks.isJob51ListUrl('https://we.51job.com/pc/job/123456'), false);
  assert.equal(hooks.isJob51ListUrl('https://www.zhipin.com/web/geek/jobs'), false);

  assert.equal(hooks.job51ActionState('已投递'), 'already_applied');
  assert.equal(hooks.job51ActionState('立即投递'), 'apply');

  const keys = Array.from(hooks.job51RecentIdentityKeys({
    url: 'https://we.51job.com/pc/job/123456',
    external_job_id: '123456',
    company: '示例科技有限公司',
    title: 'AI 应用工程师',
  }));
  assert.deepEqual(keys, ['https://we.51job.com/pc/job/123456', 'job51:123456']);
  // 带 .html 后缀的详情网址也要归一到同一个稳定职位 ID，避免重复评分。
  assert.ok(
    Array.from(hooks.job51RecentIdentityKeys({ url: 'https://we.51job.com/pc/job/123456.html' })).includes('job51:123456'),
  );

  // 详情读取与心跳上报，保证列表页能按 requestId 收到 JD，且状态页有分页数据。
  assert.match(source, /pageTarget: this\.pageControlState/);
  assert.match(source, /pageJobCountBefore: this\.pageJobCountBefore/);
  assert.match(source, /const wait = this\.waitFor\(this\.types\.JOB_INFO, requestId\);/);
  assert.match(source, /读取 JD，读完后回收后台标签页/);

  // 详情页是前端渲染，必须先等职位名称元素再读，否则会把“还没渲染”当成“没有职位名称”。
  assert.match(source, /await this\.waitForDetailContent\(\);/);
  assert.match(source, /return await tools\.waitForOne\(this\.detailTitleSelectors\(\), timeout\)/);
  assert.match(source, /const title = this\.firstText\(rootDocument, this\.detailTitleSelectors\(\)\);/);
  // 详情标签页收到关闭广播要自行收掉，避免留下白屏标签页。
  assert.match(source, /this\.broadcast\.on\(this\.types\.CLOSE, \(from, data\) => \{[\s\S]{0,240}window\.close\(\);/);
});

test('Zhaopin list page does not reload forever when the configured URL redirects', () => {
  // 配置的搜索页会被 302 到规范化列表页，身份永远对不上；只允许纠正跳转一次。
  const now = 1_700_000_000_000;
  // 已经停在配置来源上：不需要纠正
  assert.equal(hooks.shouldCorrectListUrl(0, { navigatedAt: 0 }, now), false);
  // 身份对不上且从未纠正过：跳一次
  assert.equal(hooks.shouldCorrectListUrl(-1, {}, now), true);
  assert.equal(hooks.shouldCorrectListUrl(-1, { navigatedAt: 0 }, now), true);
  // 刚为纠正跳转过（页面被重定向回来）：接住当前列表页，不再跳
  assert.equal(hooks.shouldCorrectListUrl(-1, { navigatedAt: now - 1000 }, now), false);
  assert.equal(hooks.shouldCorrectListUrl(-1, { navigatedAt: now - 59000 }, now), false);
  // 冷却过后允许再纠正一次（例如用户手动跑到了别的列表页）
  assert.equal(hooks.shouldCorrectListUrl(-1, { navigatedAt: now - 61000 }, now), true);

  assert.match(source, /tools\.shouldCorrectListUrl\(currentIndex, savedUrlState\)/);
  assert.match(source, /listUrlRedirectCooldownMs: 60000/);
  assert.match(source, /zhaopin_list_url_redirected/);
  // navigatedAt 只在真正跳转时写入，翻页等空调用不会误标记。
  assert.match(
    source,
    /this\.writeJson\(this\.urlStateKey, \{ index, reason, updatedAt: Date\.now\(\) \}\);\s*\n\s*return false;/,
  );
  assert.match(source, /navigatedAt: Date\.now\(\)/);
});

test('apply success dialogs are recognized instead of paused as manual intervention', () => {
  // 智联投递成功后弹出的是「已向对方发送简历和打招呼语 + 自己的招呼语 + 留在此页 / 继续沟通」
  // （日志里的实测文案），前程无忧弹「投递成功」。
  assert.equal(hooks.isApplySuccessText('已向对方发送简历和打招呼语'), true);
  assert.equal(
    hooks.isApplySuccessText(
      '已向对方发送简历和打招呼语 您好，我对该职位很感兴趣，请您看下我的简历，如果合适可以随时联系我，谢谢。 留在此页 继续沟通',
    ),
    true,
  );
  assert.equal(hooks.isApplySuccessText('投递成功'), true);
  assert.equal(hooks.isApplySuccessText('简历投递成功，等待企业查看'), true);
  assert.equal(hooks.isApplySuccessText('已投递成功'), true);
  assert.equal(hooks.isApplySuccessText('您的简历已发送，请留意企业回复'), true);
  // 验证码/短信这类也含“已发送”，不能当成投递成功，否则会把验证弹窗当成功放过去。
  assert.equal(hooks.isApplySuccessText('验证码已发送到手机'), false);
  assert.equal(hooks.isApplySuccessText('短信已发送'), false);
  // 普通的确认弹窗和问卷弹窗都不算成功
  assert.equal(hooks.isApplySuccessText('确认投递该职位？'), false);
  assert.equal(hooks.isApplySuccessText('请补充以下问题'), false);

  // 关闭按钮必须包含“留在此页”，且绝不能包含会离开列表页的“继续沟通”。
  const labels = Array.from(hooks.applyDialogDismissLabels());
  assert.ok(labels.includes('留在此页'), String(labels));
  assert.ok(!labels.includes('继续沟通'), String(labels));
  // 识别成功弹窗的兜底按钮必须是“留在此页”这类专属按钮；
  // 用 确定/关闭 兜底会把投递前的确认框当成成功框，凭空记一笔投递。
  const stayLabels = Array.from(hooks.applyDialogStayLabels());
  assert.deepEqual(stayLabels, ['留在此页', '留在本页', '留在当前页', '暂不沟通']);
  assert.ok(!stayLabels.includes('确定') && !stayLabels.includes('确认') && !stayLabels.includes('关闭'));

  // 两处确认弹窗都要先判成功，再判问卷；错误信息带上弹窗签名便于定位。
  const successFirst = /if \(tools\.isApplySuccessDialog\(dialog, dialogText\)\) \{[\s\S]{0,900}const supplementalFields/;
  assert.match(source, successFirst);
  assert.match(source, /apply_success_dialog_dismissed/);
  assert.match(source, /tools\.applyDialogSignature\(dialog\)/);
  // 有“留在此页”按钮的弹窗一律按动作完成处理，不靠文案也能兜住
  assert.match(source, /isApplySuccessDialog\(dialog, dialogText = ''\)/);
  assert.match(source, /dismissApplySuccessDialog\(tools\.pendingApplySuccessNotices\(\), seenSuccessDialogs\)/);
});

test('apply verification tolerates re-rendered cards and trusts the success dialog', () => {
  // 投递后列表会重渲染，卡片节点失效，必须每轮重新定位，否则永远读不到“已投递”。
  assert.match(source, /resolveApplyScope\(job, context\.candidate\)/);
  assert.match(source, /resolveApplyScope\(job, candidate = null\) \{[\s\S]{0,220}this\.findCandidateCard\(job\)/);
  // 职位名找不到时用岗位 ID 的详情链接反查卡片
  assert.match(source, /a\[href\*="\$\{jobId\}"\]/);
  // 平台明确提示投递成功后直接记为已确认，不再干等按钮变化
  assert.match(source, /let successDialogSeen = false;/);
  assert.match(source, /if \(successDialogSeen\) break;/);
  assert.match(source, /verification: 'success_dialog'/);
  assert.match(source, /apply_confirmed[\s\S]{0,80}成功提示弹窗/);
  // 仍无法确认时把卡片上的按钮文字带进日志
  assert.match(source, /applyCardActionText\(job, context\.candidate\)/);
  assert.match(source, /cardAction: JSON\.stringify\(cardAction\)/);
});

test('Zhaopin scrolls for more jobs before switching source and cooling down', () => {
  // 顺序必须是 翻页 → 滑动 → 切岗位标签/冷却；滑动不能放在切换之后。
  assert.match(
    source,
    /const mayContinue = await this\.turnToNextPage\(\);[\s\S]{0,260}const scrolled = await this\.scrollListForMoreCandidates\(\);[\s\S]{0,220}zhaopin_pagination_exhausted/,
  );
  // 滑动要能识别懒加载出来的新岗位，才有“继续处理”的依据
  assert.match(source, /async scrollListForMoreCandidates\(\)/);
  assert.match(source, /listIdentitySnapshot\(\)/);
  assert.match(source, /this\.lastScrollOutcome = fresh\.size > 0 \? 'jobs_loaded' : 'no_new_jobs';/);
  assert.match(source, /if \(fresh\.size > 0\) \{\s*\n\s*this\.enqueueNewCandidates\(\);/);
  // 滚动容器找不到时退化成整页滚动，不能直接判定失败
  assert.match(source, /findListScrollContainer\(\)/);
  assert.match(source, /if \(documentTarget\) window\.scrollBy\(0, distance\);/);
  assert.match(source, /new WheelEvent\('wheel'/);
  // 轮数上限复用列表扩展次数，且新页/新来源要重置额度
  assert.match(source, /if \(this\.listScrollRound >= maxRounds\)/);
  assert.match(source, /this\.listScrollRound = 0;\s*\n\s*this\.lastScrollOutcome = 'idle';/);
  // 状态页要能看到滑动进度，否则“滑不动 → 冷却”看起来像直接冷却
  assert.match(source, /listScrollRound: this\.listScrollRound/);
  assert.match(source, /lastListScrollOutcome: this\.lastScrollOutcome/);
  assert.match(source, /zhaopin_list_scroll/);
});

test('apply dialogs are picked from the innermost node, not a page-wide wrapper', () => {
  // simpleDialogs() 的 [class*="dialog"] 会命中覆盖整页的 wrapper：文字里包含
  // 搜索筛选项，于是被当成“问卷输入项”误报，成功提示签名也变成整页文本。
  assert.match(source, /compactDialogs\(dialogs = \[\], maxChars = 600\)/);
  assert.match(source, /\.filter\(item => item\.length > 0 && item\.length <= maxChars\)/);
  // 按文字长度升序 => 最内层的真弹窗排在最前面
  assert.match(source, /\.sort\(\(a, b\) => a\.length - b\.length\)/);
  assert.match(source, /tools\.compactDialogs\(this\.simpleDialogs\(\)\)/);
  // 成功提示也可能不是 role=dialog，轮询要能扫到 toast
  assert.match(source, /pendingApplySuccessNotices\(\)/);
  assert.match(source, /\[class\*="toast"\],\[class\*="message"\],\[class\*="notice"\]/);
});

test('apply confirmation from the dialog step is not thrown away', () => {
  // 确认弹窗阶段已经拿到成功证据时，必须直接记为已确认，
  // 否则会继续等按钮变化并最终误记为“结果无法确认 + 暂停”。
  assert.match(source, /applyDialogConfirmed\(result\)/);
  assert.match(source, /if \(result\.confirmed === true\) return true;/);
  assert.match(source, /String\(result\.mode \|\| ''\) === 'success_dialog'/);
  assert.match(source, /dialogResult = await this\.confirmSimpleApplyDialog\([\s\S]{0,80}\|\| dialogResult;/);
  assert.match(source, /dialogResult = await this\.confirmApplyDialog\([\s\S]{0,90}\|\| dialogResult;/);
  assert.match(source, /if \(tools\.applyDialogConfirmed\(dialogResult\)\)/);
  assert.match(source, /verification: `dialog:\$\{dialogResult\.mode \|\| 'confirmed'\}`/);
});
