import assert from 'node:assert/strict'
import test from 'node:test'

import { agentIsIdle, allRootsIdle, needsResume } from '../lib/restart-idle.js'

test('agent is idle only when its status is idle and both inbox queues are empty', () => {
  assert.equal(agentIsIdle({ status: 'idle' }), true)
  assert.equal(agentIsIdle({ status: 'idle', inbox: { nextTurn: [], nextStep: [] } }), true)
  assert.equal(agentIsIdle({ status: 'running', inbox: { nextTurn: [], nextStep: [] } }), false)
  assert.equal(agentIsIdle({ status: 'idle', inbox: { nextTurn: [{ source: { kind: 'user' } }], nextStep: [] } }), false)
  assert.equal(agentIsIdle({ status: 'idle', inbox: { nextTurn: [], nextStep: [{ source: { kind: 'user' } }] } }), false)
  // 插件注入的上下文没有唤醒来源, 不阻塞空闲判定。
  assert.equal(agentIsIdle({ status: 'idle', inbox: { nextTurn: [], nextStep: [{ source: { kind: 'plugin:openviking-memory' } }] } }), true)
})

test('the deferred restart waits for every root session, not just the first one to finish', () => {
  const idle = { status: 'idle', inbox: { nextTurn: [], nextStep: [] } }
  const busy = { status: 'running', inbox: { nextTurn: [], nextStep: [] } }
  const queued = { status: 'idle', inbox: { nextTurn: [], nextStep: [{ source: { kind: 'user' } }] } }

  assert.equal(allRootsIdle([]), true)
  assert.equal(allRootsIdle([idle, idle]), true)
  // 一个会话结束不代表可以重启: 另一个还在跑时判定必须为假。
  assert.equal(allRootsIdle([idle, busy]), false)
  // 已经排队但尚未开跑的输入同样算未完成工作。
  assert.equal(allRootsIdle([idle, queued]), false)
})
test('a session holding only plugin-injected inbox work is not resumed', () => {
  const running = { status: 'running', inbox: { nextTurn: [], nextStep: [] } }
  const userPending = { status: 'idle', inbox: { nextTurn: [], nextStep: [{ source: { kind: 'user' } }] } }
  const injectedOnly = { status: 'idle', inbox: { nextTurn: [], nextStep: [{ source: { kind: 'plugin:openviking-memory' } }] } }
  const empty = { status: 'idle', inbox: { nextTurn: [], nextStep: [] } }

  assert.equal(needsResume(running), true)
  assert.equal(needsResume(userPending), true)
  assert.equal(needsResume(empty), false)
  // 只有插件注入上下文、用户从未发过消息的空白会话不应被反复恢复。
  assert.equal(needsResume(injectedOnly), false)
})