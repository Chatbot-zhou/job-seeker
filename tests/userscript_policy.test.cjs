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
  const entryUrl = 'https://www.zhipin.com/wapi/zpgeek/friend/add.json?securityId=secret-value&jobId=job-123';
  assert.equal(hooks.logSafeUrl(entryUrl), 'https://www.zhipin.com/wapi/zpgeek/friend/add.json?jobId=job-123');
  const message = hooks.sanitizeTelemetryText(`请求入口: ${entryUrl}`);
  assert.doesNotMatch(message, /securityId|secret-value/);
  assert.match(message, /jobId=job-123/);
  assert.match(source, /const activeKeyword = currentJobSource === 'keyword_search'/);
  assert.match(source, /sourceLabel: activeSourceLabel/);
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
