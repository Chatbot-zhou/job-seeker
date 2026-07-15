const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('web_script.js', 'utf8');
const context = { __JOB_SEEKER_TEST_MODE__: true };
vm.createContext(context);
vm.runInContext(source, context);
const hooks = context.__JOB_SEEKER_TEST_HOOKS__;

test('risk classifier ignores generic job text and detects real challenges', () => {
  assert.equal(hooks.detectInterruptionText('负责 login service、verify token 和 rate limit 设计'), '');
  assert.match(hooks.detectInterruptionText('请完成安全验证后继续访问'), /安全验证/);
  assert.match(hooks.detectInterruptionText('登录状态已失效，请重新登录'), /登录/);
  assert.match(hooks.detectPlatformLimitText('访问过于频繁，请稍后再试'), /频繁/);
  assert.equal(hooks.detectQuotaWarningText('今天剩余次数还有30次'), '平台额度提醒');
});

test('risk detection avoids generic whole-page English tokens', () => {
  assert.doesNotMatch(source, /body\.innerText[\s\S]{0,200}\b(?:verify|login|limit)\b/i);
  assert.match(source, /riskSurfaceText/);
  assert.match(source, /interruptionLocationReason/);
});

test('search safety state persists across refreshes', () => {
  assert.match(source, /__job_seeker_search_budget/);
  assert.match(source, /__job_seeker_search_round_state/);
  assert.match(source, /maxSearchSubmissionsPerHour/);
  assert.match(source, /maxSearchSubmissionsPerDay/);
});

test('job list scrolling is verified and never falls back to window scrolling', () => {
  assert.match(source, /jobListFingerprint/);
  assert.match(source, /search_result_scroll_verified/);
  assert.doesNotMatch(source, /window\.scrollBy\s*\(/);
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
});

test('background tabs remain non-active', () => {
  assert.match(source, /GM_openInTab/);
  assert.match(source, /active:\s*false/);
});
