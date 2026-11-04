import assert from 'node:assert/strict'
import test from 'node:test'

import { hasUserPending, needsResume } from '../lib/restart-idle.js'

test('only a session whose turn is still running is resumed', () => {
  // 轮还在跑 → 重启后注入继续提示。
  assert.equal(needsResume('running'), true)
  // 空白会话与已结束的会话都恒为 idle → 不注入, 也就不会凭空多出未命名会话。
  assert.equal(needsResume('idle'), false)
  assert.equal(needsResume(undefined), false)
})
test('queued user input suppresses the continuation prompt', () => {
  const userPending = { inbox: { nextTurn: [{ source: { kind: 'user' } }], nextStep: [] } }
  const pluginOnly = { inbox: { nextTurn: [], nextStep: [{ source: { kind: 'plugin:openviking-memory' } }] } }
  const empty = { inbox: { nextTurn: [], nextStep: [] } }

  // 队列里已有用户消息 → 不再注入「继续」, 否则用户消息被挤到下一轮。
  assert.equal(hasUserPending(userPending), true)
  assert.equal(hasUserPending(pluginOnly), false)
  assert.equal(hasUserPending(empty), false)
})
