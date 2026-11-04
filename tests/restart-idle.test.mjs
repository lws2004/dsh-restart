import assert from 'node:assert/strict'
import test from 'node:test'

import { agentIsIdle, allRootsIdle } from '../lib/restart-idle.js'

test('agent is idle only when its status is idle and both inbox queues are empty', () => {
  assert.equal(agentIsIdle({ status: 'idle' }), true)
  assert.equal(agentIsIdle({ status: 'idle', inbox: { nextTurn: [], nextStep: [] } }), true)
  assert.equal(agentIsIdle({ status: 'running', inbox: { nextTurn: [], nextStep: [] } }), false)
  assert.equal(agentIsIdle({ status: 'idle', inbox: { nextTurn: [{}], nextStep: [] } }), false)
  assert.equal(agentIsIdle({ status: 'idle', inbox: { nextTurn: [], nextStep: [{}] } }), false)
})

test('the deferred restart waits for every root session, not just the first one to finish', () => {
  const idle = { status: 'idle', inbox: { nextTurn: [], nextStep: [] } }
  const busy = { status: 'running', inbox: { nextTurn: [], nextStep: [] } }
  const queued = { status: 'idle', inbox: { nextTurn: [], nextStep: [{}] } }

  assert.equal(allRootsIdle([]), true)
  assert.equal(allRootsIdle([idle, idle]), true)
  // 一个会话结束不代表可以重启: 另一个还在跑时判定必须为假。
  assert.equal(allRootsIdle([idle, busy]), false)
  // 已经排队但尚未开跑的输入同样算未完成工作。
  assert.equal(allRootsIdle([idle, queued]), false)
})
