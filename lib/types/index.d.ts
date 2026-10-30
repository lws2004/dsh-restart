/**
 * dsh-restart — permanent "restart the whole DeepSeek Harness" plugin.
 *
 * Registers a model-callable `restart_harness` tool and a `/restart` command
 * that reload plugins and configuration by restarting the DSH node process.
 *
 * Restart mechanism (Node-native):
 *   - discovery is unnecessary: this plugin runs INSIDE the DSH node process, so
 *     `process.pid` / `process.cwd()` / `process.execPath` / `process.execArgv` /
 *     `process.argv` are read directly.
 *   - relaunch: spawn a detached `node -e` helper (survives the parent's exit via
 *     `detached: true` + `stdio: 'ignore'` + `unref()`), which waits until the old
 *     process releases the listen port, then spawns the new DSH (same argv + cwd,
 *     stdout/stderr appended to timestamped logs). The old process then
 *     `process.exit(0)`s after `delayMs` so the tool result can flush first.
 *   - a "process index" file (`$DSH_HOME/dsh-process.json`) is still written at
 *     boot for external inspection (pid + cwd + command line).
 *
 * @module dsh-restart
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-restart";
export declare const inject: string[];
/**
 * Auto-continue 注入消息的持久来源。
 *
 * 按官方规范: `MessageSourceMap` 是可合并扩展的联合类型, 每个生产者声明自己的 kind,
 * **没有统一的 catch-all `plugin` kind**。所以这里声明本插件专属的 kind 并 augment 进映射表,
 * 而不是往既有 kind 里塞 `plugin:${name}` 这种字符串。
 *
 * `form: 'instructions'` —— 注入的内容是让模型照做的指令。
 */
export interface RestartContinuationSource {
    readonly kind: 'plugin:dsh-restart';
    /** 注入文本取自本插件的 `continuePrompt` 配置。 */
    readonly form: 'instructions';
}
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        /** 重启完成后由本插件注入的「继续之前未完成的工作」消息。 */
        'plugin:dsh-restart': RestartContinuationSource;
    }
}
/**
 * dsh 0.1.7+ : 宿主从插件导出的 Config schema 派生「插件配置」表单(旧 installSection 已移除)。
 * 本地补丁:导出 Config 供宿主投影表单,命名空间即本插件的 profile entry id「dsh-restart」。
 */
export declare const Config: import("@deepseek-ai/schemastery").default<Schemastery.ObjectS<NoInfer<{
    legacyRestart: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    continuePrompt: import("@deepseek-ai/schemastery").default<string, string, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    resumeWaitMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    resumeMaxAgeMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    watchdogEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    watchdogCooldownMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    watchdogPollMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    legacyRestart: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    continuePrompt: import("@deepseek-ai/schemastery").default<string, string, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    resumeWaitMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    resumeMaxAgeMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    watchdogEnabled: import("@deepseek-ai/schemastery").default<boolean, boolean, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    watchdogCooldownMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
    watchdogPollMs: import("@deepseek-ai/schemastery").default<number, number, Mode extends "volatile" | "volatile-defined" ? "volatile-defined" : "defined">;
}>>, "plain">;
export declare function apply(ctx: Context): void;
