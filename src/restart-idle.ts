/**
 * 延迟重启的空闲判据: 只有当所有活跃 root 会话都结束当前轮、且 inbox 没有排队输入时,
 * 才允许真正重启(见 index.ts 的 scheduleRestartAfterTurnEnd)。
 *
 * 单独成模块是为了让判据能被单元测试直接覆盖 —— 调度路径本身会真的拉起重启进程,
 * 不适合在测试里触发。
 *
 * @module dsh-restart/restart-idle
 */

/** 判据读取的 Agent 子集(只依赖状态与 inbox 队列长度)。 */
export interface RestartIdleAgent {
  readonly status?: string
  readonly inbox?: {
    readonly nextTurn?: readonly unknown[]
    readonly nextStep?: readonly unknown[]
  }
}

/**
 * 单个 Agent 是否没有在飞的工作。
 * @param agent - Agent 形态的值(状态 + inbox)。
 * @returns 该 Agent 处于 idle 且 inbox 无待办时为 true。
 */
export function agentIsIdle(agent: RestartIdleAgent): boolean {
  if (agent.status !== 'idle') return false
  // 只有真实用户输入会在轮末把 agent 拉起来续跑; 插件注入的上下文(如新会话的
  // profile 提示)没有唤醒来源, 不会自行执行, 因此不算在飞的工作。
  if ((agent.inbox?.nextTurn ?? []).some(isUserInput)) return false
  if ((agent.inbox?.nextStep ?? []).some(isUserInput)) return false
  return true
}

/**
 * 所有 root 会话是否都已空闲。
 * @param agents - 活跃 root 会话。
 * @returns 没有任何会话在跑、也没有排队输入时为 true。
 */
export function allRootsIdle(agents: Iterable<RestartIdleAgent>): boolean {
  for (const agent of agents) {
    if (!agentIsIdle(agent)) return false
  }
  return true
}
/** 真实用户输入(区别于插件注入的上下文/提示)。 */
export function isUserInput(message: unknown): boolean {
  const kind = (message as { source?: { kind?: unknown } } | undefined)?.source?.kind
  return kind === 'user'
}

/**
 * 会话是否需要在重启后恢复: 正在跑, 或 inbox 里还留着真实用户输入。
 *
 * 只看队列非空是不够的 —— 新会话创建时插件会往 inbox 注入上下文(source.kind 形如
 * `plugin:<name>`), 那种注入不该让一个用户从未使用过的空白会话被反复恢复, 否则每次
 * 重启都会把它拉起来, 列表里凭空多出一个未命名会话。
 *
 * @param agent - Agent 形态的值(状态 + inbox)。
 * @returns 重启后需要注入「继续」提示时为 true。
 */
export function needsResume(agent: RestartIdleAgent): boolean {
  if (agent.status === 'running') return true
  if ((agent.inbox?.nextTurn ?? []).some(isUserInput)) return true
  if ((agent.inbox?.nextStep ?? []).some(isUserInput)) return true
  return false
}