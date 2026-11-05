/**
 * 重启后的会话恢复判据: 只恢复「跑过任务、且当前轮仍在运行」的会话。
 *
 * 单独成模块是为了让判据能被单元测试直接覆盖 —— 调度路径本身会真的拉起重启进程,
 * 不适合在测试里触发。
 *
 * @module dsh-restart/restart-idle
 */

/**
 * 会话是否需要重启后注入「继续」提示。
 *
 * 判据只有一条: Agent 处于 running。正在跑的轮次天然意味着「跑过任务」; 从未跑过任务的
 * 新建空白会话(用户刚点「新建会话」、只被插件注入过上下文)恒为 idle, 不会被拉起, 也就
 * 不会因为它凭空多出一个未命名会话。已经结束的会话没有未完成的工作, 交给客户端按上次
 * 选择恢复界面即可。
 *
 * 不读会话的轮次边界投影: 宿主 0.2.1-rc.5 的发布产物里还没有 `turnBoundaryOf`, 只依赖
 * `Agent.status` —— 它在所有已发布版本里都存在。
 *
 * @param status - Agent 当前状态。
 * @returns 需要注入继续提示时为 true。
 */
export function needsResume(status: string | undefined): boolean {
  return status === 'running'
}
/** 判据读取的 inbox 子集(只关心队列里有没有真实用户输入)。 */
export interface RestartInboxAgent {
  readonly inbox?: {
    readonly nextTurn?: readonly unknown[]
    readonly nextStep?: readonly unknown[]
  }
}

/**
 * 会话的 inbox 里是否已经排着真实用户输入。
 *
 * 重启完成时若用户已经发过消息(它已经进了队列), 再注入「继续之前未完成的工作」只会让
 * agent 先跑一轮空转、用户消息被排到后面 —— 也就是「收到两个消息, 回送的那条在后面」。
 * 判据只认真实用户输入(source.kind === 'user'), 插件注入的上下文不算。
 *
 * @param agent - Agent 形态的值(状态 + inbox)。
 * @returns 队列里存在真实用户输入时为 true。
 */
export function hasUserPending(agent: RestartInboxAgent): boolean {
  const pending = [...(agent.inbox?.nextTurn ?? []), ...(agent.inbox?.nextStep ?? [])]
  return pending.some((message) => {
    const kind = (message as { source?: { kind?: unknown } } | undefined)?.source?.kind
    return kind === 'user'
  })
}

/** inbox 中可被扣下的两个队列(与宿主 Agent['inbox'] 对齐的最小接口)。 */
export interface RestartInboxDrain {
  readonly nextTurn: readonly unknown[]
  readonly nextStep: readonly unknown[]
  splice(target: 'next-turn' | 'next-step', start: number, deleteCount: number, inserted: unknown[]): unknown[]
}

/**
 * 扣下 inbox 中所有尚未开跑的排队消息, 保持 next-step → next-turn 的顺序。
 *
 * 重启排程的 fire 发生在 turn/end 的同步监听器里。此刻若不清理 inbox, 宿主 agent-loop
 * 会在 turn/end 之后立刻看到「inbox.hasPending」并开下一轮, 把重启推迟到那一轮结束 ——
 * 2026-11-05 实测就是被一条排队消息拖了 4 分钟。清空后本轮结束即无后续轮次, 消息由调用方
 * 落盘并在重启后重放。
 *
 * @param inbox - 宿主 Agent 的 inbox。
 * @returns 按原队列顺序扣下的消息。
 */
export function drainQueuedMessages(inbox: RestartInboxDrain): unknown[] {
  const nextStep = inbox.nextStep.length > 0
    ? inbox.splice('next-step', 0, inbox.nextStep.length, [])
    : []
  const nextTurn = inbox.nextTurn.length > 0
    ? inbox.splice('next-turn', 0, inbox.nextTurn.length, [])
    : []
  return [...nextStep, ...nextTurn]
}
