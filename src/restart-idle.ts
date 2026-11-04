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
  if ((agent.inbox?.nextTurn?.length ?? 0) > 0) return false
  if ((agent.inbox?.nextStep?.length ?? 0) > 0) return false
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
