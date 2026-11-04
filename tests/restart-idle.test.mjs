import assert from 'node:assert/strict'
import test from 'node:test'

import { needsResume } from '../lib/restart-idle.js'

test('only a session whose turn is still running is resumed', () => {
  // 轮还在跑 → 重启后注入继续提示。
  assert.equal(needsResume('running'), true)
  // 空白会话与已结束的会话都恒为 idle → 不注入, 也就不会凭空多出未命名会话。
  assert.equal(needsResume('idle'), false)
  assert.equal(needsResume(undefined), false)
})
