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
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import z from '@deepseek-ai/schemastery';
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { relaunchHelperSource } from './relaunch-helper.js';
import { RestartCoordinator } from './restart-coordinator.js';
import { superviseRestartHelper } from './restart-helper-lifecycle.js';
export const name = 'dsh-restart';
export const inject = ['tools', 'commands', 'agents', 'shell', 'sandboxPolicy'];
const RestartConfigSchema = z.object({
    legacyRestart: z.boolean().default(false),
    continuePrompt: z.string().default('（系统已重启完成）请继续之前未完成的工作。'),
    resumeWaitMs: z.number().default(1800000),
    resumeMaxAgeMs: z.number().default(7200000),
    watchdogEnabled: z.boolean().default(false),
    watchdogCooldownMs: z.number().default(60000),
    watchdogPollMs: z.number().default(1000),
});
/**
 * dsh 0.1.7+ : 宿主从插件导出的 Config schema 派生「插件配置」表单(旧 installSection 已移除)。
 * 本地补丁:导出 Config 供宿主投影表单,命名空间即本插件的 profile entry id「dsh-restart」。
 */
export const Config = RestartConfigSchema;
const DEFAULT_CONFIG = {
    legacyRestart: false,
    continuePrompt: '（系统已重启完成）请继续之前未完成的工作。',
    resumeWaitMs: 1800000,
    resumeMaxAgeMs: 7200000,
    watchdogEnabled: false,
    watchdogCooldownMs: 60000,
    watchdogPollMs: 1000,
};
/** The "process file index": boot facts for external inspection. */
const INDEX_FILENAME = 'dsh-process.json';
/** The "resume marker": the in-progress session to restore after a restart. */
const RESUME_FILENAME = 'dsh-resume.json';
/** Compatibility stop marker consumed by watchdogs detached by older releases. */
const LEGACY_WATCHDOG_STOP_FILENAME = 'dsh-stop.flag';
/** Stable identity for this loaded DSH process. */
const PROCESS_STARTED_AT = new Date(performance.timeOrigin).toISOString();
function homeDir() {
    return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}
function indexFilePath() {
    return path.join(homeDir(), INDEX_FILENAME);
}
function resumeFilePath() {
    return path.join(homeDir(), RESUME_FILENAME);
}
/** Disable any detached watchdog that may have survived an upgrade. */
function disableLegacyWatchdog() {
    try {
        fs.mkdirSync(homeDir(), { recursive: true });
        fs.writeFileSync(path.join(homeDir(), LEGACY_WATCHDOG_STOP_FILENAME), 'disabled by dsh-restart: embedded watchdog retired\n', 'utf8');
    }
    catch (error) {
        console.error('[dsh-restart] failed to disable legacy watchdog:', error);
    }
}
/** Record the in-progress sessions before restart (for auto-resume after reboot). */
function writeResumeMarker(sessionIds) {
    try {
        fs.writeFileSync(resumeFilePath(), JSON.stringify({
            sessionIds,
            restartAt: new Date().toISOString(),
            pid: process.pid,
        }, null, 2) + '\n', 'utf8');
    }
    catch (error) {
        console.error('[dsh-restart] failed to write resume marker:', error);
    }
}
/** Read a session id defensively from an agent-shaped object. */
function sessionIdOf(agent) {
    const session = agent?.session;
    const id = session?.id ?? session?.header?.id;
    return typeof id === 'string' && id !== '' ? id : undefined;
}
/** Read the resume marker recorded before the last restart (list or legacy single form). */
function readResumeMarker() {
    try {
        const parsed = JSON.parse(fs.readFileSync(resumeFilePath(), 'utf8'));
        const sessionIds = Array.isArray(parsed.sessionIds)
            ? parsed.sessionIds.filter((id) => typeof id === 'string' && id !== '')
            : typeof parsed.sessionId === 'string' && parsed.sessionId !== ''
                ? [parsed.sessionId]
                : [];
        const at = typeof parsed.restartAt === 'string' ? Date.parse(parsed.restartAt) : Number.NaN;
        return Number.isFinite(at) ? { sessionIds, restartAt: at } : { sessionIds };
    }
    catch {
        return { sessionIds: [] };
    }
}
/** Append a line to the plugin's own debug log for diagnosing auto-continue. */
function debugLog(message) {
    try {
        fs.appendFileSync(path.join(homeDir(), 'dsh-restart-auto.log'), `${new Date().toISOString()} ${message}\n`, 'utf8');
    }
    catch { /* best-effort */ }
}
/** Remove the resume marker once it has been consumed. */
function clearResumeMarker() {
    try {
        fs.unlinkSync(resumeFilePath());
    }
    catch { /* already gone */ }
}
/**
 * After a restart, wait for the recorded session to be resumed (the client
 * re-opens it) and then inject one "continue" follow-up so the agent picks up
 * the interrupted work without a manual prompt. Polls the live agent registry;
 * gives up after ~60s and clears the marker.
 */
function tryAutoContinue(ctx, dynamic) {
    const marker = readResumeMarker();
    const sessionIds = marker.sessionIds;
    debugLog(`auto-continue: marker has ${sessionIds.length} session(s) ${JSON.stringify(sessionIds)}`);
    if (sessionIds.length === 0)
        return;
    const configOf = () => {
        try {
            return dynamic();
        }
        catch {
            return DEFAULT_CONFIG;
        }
    };
    const maxAgeMs = Math.max(0, configOf().resumeMaxAgeMs ?? DEFAULT_CONFIG.resumeMaxAgeMs);
    const ageMs = marker.restartAt === undefined ? 0 : Date.now() - marker.restartAt;
    if (ageMs > maxAgeMs) {
        debugLog('auto-continue: marker is stale, dropping it');
        clearResumeMarker();
        return;
    }
    const pending = new Set(sessionIds);
    // Local patch (2026-09-25): polling is now only a boot-time fallback. A session
    // the client re-opens later is caught by the listener below, so the loop stops
    // after resumeWaitMs instead of deleting the marker at ~60s.
    const timers = new Set();
    let stopCreated;
    let done = false;
    const dispose = () => {
        if (done)
            return;
        done = true;
        for (const timer of timers)
            clearTimeout(timer);
        timers.clear();
        stopCreated?.();
        stopCreated = undefined;
    };
    const finish = () => {
        dispose();
        clearResumeMarker();
    };
    const deliver = (agent, sessionId, via) => {
        debugLog(`auto-continue: agent for ${sessionId} is live (${via}), following up`);
        try {
            ;
            agent.followup(createUserMessage({
                content: [{ type: 'text', text: configOf().continuePrompt }],
                source: { kind: 'plugin:dsh-restart', form: 'instructions' },
            }));
        }
        catch (error) {
            console.error('[dsh-restart] auto-continue failed:', error);
            debugLog(`auto-continue: followup error for ${sessionId}: ${String(error)}`);
            return;
        }
        pending.delete(sessionId);
        if (pending.size === 0) {
            debugLog('auto-continue: all sessions continued');
            finish();
        }
    };
    // Primary path: the client may re-open an interrupted session at any later time.
    const onCreate = ctx.on;
    stopCreated = onCreate('agent/created', (payload) => {
        const sessionId = sessionIdOf(payload?.agent);
        if (sessionId === undefined || !pending.has(sessionId))
            return;
        deliver(payload.agent, sessionId, 'agent/created');
    });
    const scan = () => {
        for (const sessionId of [...pending]) {
            const agent = ctx.agents.get(sessionId);
            if (agent !== undefined)
                deliver(agent, sessionId, 'poll');
        }
    };
    scan();
    if (pending.size > 0) {
        const deadline = Date.now() + (configOf().resumeWaitMs ?? DEFAULT_CONFIG.resumeWaitMs);
        const tick = () => {
            scan();
            if (pending.size === 0 || done)
                return;
            if (Date.now() >= deadline) {
                debugLog(`auto-continue: polling window over, still waiting for a re-open of ${pending.size} session(s) ${JSON.stringify([...pending])}`);
                return;
            }
            timers.add(setTimeout(tick, 500));
        };
        timers.add(setTimeout(tick, 500));
        // Final safety net: drop a marker that no session ever claimed.
        timers.add(setTimeout(() => {
            if (pending.size === 0)
                return;
            debugLog(`auto-continue: gave up after ${Math.round(maxAgeMs / 1000)}s, ${pending.size} session(s) never resumed: ${JSON.stringify([...pending])}`);
            finish();
        }, Math.max(0, maxAgeMs - ageMs)));
    }
    ctx.effect(() => () => dispose());
}
/** Quote one argv element for a cmd-runnable command line. */
function quoteArg(value) {
    return /[\s"]/.test(value) ? '"' + value.replace(/"/g, '\\"') + '"' : value;
}
/** Reconstruct the launch command line from the running node process. */
function launchCommandLine() {
    return [process.execPath, ...process.execArgv, ...process.argv.slice(1)]
        .map(quoteArg)
        .join(' ');
}
/** Write pid + cwd + command line at boot (kept for external inspection). */
function writeProcessIndex() {
    try {
        const file = indexFilePath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({
            pid: process.pid,
            cwd: process.cwd(),
            commandLine: launchCommandLine(),
            execPath: process.execPath,
            execArgv: process.execArgv,
            argv: process.argv.slice(1),
            startedAt: PROCESS_STARTED_AT,
        }, null, 2) + '\n', 'utf8');
    }
    catch (error) {
        console.error('[dsh-restart] failed to write process index:', error);
    }
}
const restartCoordinator = new RestartCoordinator();
/**
 * launchd 托管检测。
 *
 * 背景: 本机 web profile 由 launchd KeepAlive 托管(com.lanws.dsh-web)。若按
 * 插件原生的「派生 detached helper 抢端口」路径重启, 新进程与 launchd 拉起的
 * 进程会同时争抢监听端口(EADDRINUSE), 且插件的 supervisor 探测只覆盖 systemd,
 * 认不出 launchd, 检测救不了。
 *
 * 判据: launchd 派生的进程环境里带 XPC_SERVICE_NAME=<label>, 这是 launchd 托管的
 * 权威标记 —— 比「探 launchctl print 是否存在该 label」更准(后者在进程并非由
 * 该 label 拉起时会误判), 也无需猜测 label 名。
 */
function launchdServiceName() {
    const name = process.env.XPC_SERVICE_NAME;
    return typeof name === 'string' && name !== '' ? name : undefined;
}
/**
 * 重启元信息(不调度任何重启)。给「等轮末再重启」的路径用: 工具要立刻把结果交回模型,
 * 但真正的 kickstart 必须等到本轮结束之后。
 */
function pendingRestartInfo() {
    const label = launchdServiceName();
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    const target = label === undefined ? undefined : uid === undefined ? label : `gui/${uid}/${label}`;
    return {
        ok: true,
        pid: process.pid,
        cwd: process.cwd(),
        commandLine: launchCommandLine(),
        delayMs: 0,
        logOut: path.join(homeDir(), 'logs', 'dsh-web-stdout.log'),
        logErr: path.join(homeDir(), 'logs', 'dsh-web-stderr.log'),
        via: target === undefined ? undefined : 'launchd',
        launchdLabel: target,
    };
}
/**
 * 经 launchd 重启: kickstart -k 会让 launchd 停掉当前进程并按原样拉起新的,
 * 环境由 service.sh 从钥匙串重建。插件不派生任何替代进程, 因此不会与 launchd
 * 抢端口 —— 这正是本机 web profile 需要的唯一正确路径(与 dsh-web-restart 同源)。
 */
function launchRestartViaLaunchd(delayMs) {
    const label = launchdServiceName();
    if (label === undefined)
        return undefined;
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    const target = uid === undefined ? label : `gui/${uid}/${label}`;
    // 预检 label 是否可寻址: 不可寻址就别等了, 直接退回原生路径。
    const probe = spawnSync('launchctl', ['print', target], {
        encoding: 'utf8',
        timeout: 5000,
    });
    if (probe.error || probe.status !== 0) {
        const detail = probe.error ? String(probe.error) : `exit=${probe.status} ${probe.stderr ?? ''}`;
        debugLog('launchd label not addressable: ' + detail);
        return undefined;
    }
    // 必须延迟再 kickstart: kickstart -k 会把本进程 SIGKILL 掉, 立即执行的话
    // 工具结果与本轮回复都来不及送达(实测: 消息没回送, 只能靠人再发一条)。
    // delayMs 正是为此存在的 —— 先把结果交出去, 到点再重启。
    const wait = Math.max(0, delayMs);
    const timer = setTimeout(() => {
        try {
            const result = spawnSync('launchctl', ['kickstart', '-k', target], {
                encoding: 'utf8',
                timeout: 30000,
            });
            if (result.error || result.status !== 0) {
                const detail = result.error ? String(result.error) : `exit=${result.status} ${result.stderr ?? ''}`;
                debugLog('launchd kickstart failed: ' + detail);
            }
        }
        catch (error) {
            debugLog('launchd kickstart threw: ' + String(error));
        }
    }, wait);
    // 定时器不阻止进程退出 —— 但它必须触发, 所以不能 unref; 进程本来就要被 kickstart 杀掉。
    void timer;
    debugLog(`launchd kickstart scheduled in ${wait}ms: ${target}`);
    return {
        ok: true,
        pid: process.pid,
        cwd: process.cwd(),
        commandLine: launchCommandLine(),
        delayMs: wait,
        logOut: path.join(homeDir(), 'logs', 'dsh-web-stdout.log'),
        logErr: path.join(homeDir(), 'logs', 'dsh-web-stderr.log'),
        via: 'launchd',
        launchdLabel: target,
    };
}
/**
 * Node-native self-restart. Spawns a detached helper that relaunches DSH after
 * the current process has exited and released its port, then schedules the
 * current process's own exit.
 */
function launchRestart(delayMs) {
    const argv = [...process.execArgv, ...process.argv.slice(1)];
    const cwd = process.cwd();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const logOut = path.join(os.tmpdir(), `dsh-restart-${stamp}.out.log`);
    const logErr = path.join(os.tmpdir(), `dsh-restart-${stamp}.err.log`);
    const helperPath = path.join(os.tmpdir(), `dsh-restart-helper-${process.pid}-${Date.now()}.cjs`);
    // Detached helper: waits for the old process to release its port, then spawns
    // the new DSH with the same argv + cwd, output appended to the log files.
    // Written to a temp .cjs rather than passed via `node -e`, because the shared
    // relaunch helper contains quoting that does not survive an inline argument.
    const helperCode = [
        "const { spawn, spawnSync } = require('node:child_process')",
        "const fs = require('node:fs')",
        "const os = require('node:os')",
        "const path = require('node:path')",
        relaunchHelperSource(),
        `const argv = ${JSON.stringify(argv)}`,
        `const cwd = ${JSON.stringify(cwd)}`,
        `const logOut = ${JSON.stringify(logOut)}`,
        `const logErr = ${JSON.stringify(logErr)}`,
        `const selfPath = ${JSON.stringify(helperPath)}`,
        `const delay = ${delayMs + 800}`,
        'setTimeout(() => {',
        '  try {',
        '    relaunchDsh(process.execPath, argv, cwd, logOut, logErr)',
        '  } catch (e) {',
        "    try { fs.appendFileSync(logErr, new Date().toISOString() + ' relaunch failed: ' + String(e && e.stack || e) + '\\n', 'utf8') } catch {}",
        '  } finally {',
        '    try { fs.unlinkSync(selfPath) } catch {}',
        '    process.exit(0)',
        '  }',
        '}, delay)',
    ].join('\n');
    fs.writeFileSync(helperPath, helperCode, 'utf8');
    const helper = spawn(process.execPath, [helperPath], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
        windowsHide: true,
    });
    const info = {
        ok: true,
        pid: process.pid,
        cwd,
        commandLine: launchCommandLine(),
        delayMs,
        logOut,
        logErr,
    };
    superviseRestartHelper(helper, {
        delayMs,
        exit: () => process.exit(0),
        onError: (error) => {
            restartCoordinator.release(info);
            try {
                fs.unlinkSync(helperPath);
            }
            catch { /* helper never owned cleanup */ }
            console.error('[dsh-restart] failed to spawn restart helper:', error);
            debugLog(`restart helper spawn failed: ${String(error)}`);
        },
    });
    return info;
}
function restart(delayMs) {
    return restartCoordinator.claim(() => {
        // launchd 托管时必须让 launchd 来重启 —— 自派生进程会与 KeepAlive 抢端口。
        if (launchdServiceName() !== undefined) {
            const viaLaunchd = launchRestartViaLaunchd(delayMs);
            if (viaLaunchd !== undefined)
                return viaLaunchd;
            // kickstart 失败时退回原生路径, 至少让用户拿到可用的重启路径。
        }
        return launchRestart(delayMs);
    }).value;
}
function isLoopbackWebRequest(req) {
    const address = req.socket.remoteAddress;
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
/** Accept the privileged restart action only from this Web host on loopback. */
function isTrustedWebRestart(req) {
    if (!isLoopbackWebRequest(req))
        return false;
    const { origin, host } = req.headers;
    if (typeof origin !== 'string' || typeof host !== 'string')
        return false;
    try {
        const parsed = new URL(origin);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host;
    }
    catch {
        return false;
    }
}
/** Session ids that should resume after a deliberate restart. */
function runningSessionIds(ctx) {
    return [...new Set(ctx.agents.roots()
            .filter(agent => agent.status === 'running')
            .map(agent => String(agent.id)))];
}
/**
 * 等「当前轮结束」就重启, 而不是固定延迟、也不等整个 agent 空闲(2026-10-30)。
 *
 * 为什么不等 whenIdle: `whenIdle()` 等的是整个 agent 排空, 用户在轮后又连发消息就永远等不到,
 * 重启被无限推迟。而 inbox 是持久投影(插入/认领/丢弃都是持久事实), 轮后新到的消息在重启后
 * 仍会被处理 —— 所以正确语义是「当前轮结束即重启, 新消息排队到重启后」, 而不是让新消息干扰重启。
 *
 * 触发: 目标会话的 `agent/turn-stopping`(轮次没有工具或 steering 后续时触发, 即轮末)。
 * 兜底: maxWaitMs 到点强制重启, 避免事件没到导致永不重启。
 */
function scheduleRestartAfterTurnEnd(ctx, sessionIds, maxWaitMs) {
    const targets = new Set(sessionIds.map(String));
    let fired = false;
    let dispose;
    let timer;
    const fire = (reason) => {
        if (fired)
            return;
        fired = true;
        try {
            dispose?.();
        }
        catch {
            // 监听器可能已随宿主收尾释放, 不影响重启。
        }
        if (timer !== undefined)
            clearTimeout(timer);
        debugLog('restart-after-turn-end: firing (' + reason + ')');
        // 轮末到回送完成之间还有一小段收尾, 留 800ms 再 kickstart, 避免回复没送达。
        setTimeout(() => {
            try {
                restart(0);
            }
            catch (error) {
                debugLog('restart-after-turn-end: restart failed: ' + String(error));
            }
        }, 800);
    };
    dispose = ctx.on('agent/turn-stopping', (payload) => {
        const id = String(payload?.agent?.id ?? '');
        if (!targets.has(id))
            return;
        fire('turn-stopping');
    });
    timer = setTimeout(() => fire('timeout'), Math.max(6000, Math.floor(maxWaitMs)));
}
/**
 * Legacy restart (PowerShell + WMI + taskkill), kept for compatibility: reads
 * the process index, writes a helper .ps1, launches it detached via WMI, and
 * lets it taskkill the tree before relaunching via cmd /c.
 */
function buildLegacyScript(indexPath, delayMs) {
    const indexPathLiteral = indexPath.replace(/'/g, "''");
    return `$ErrorActionPreference = 'Stop'
$indexPath = '${indexPathLiteral}'
if (-not (Test-Path -LiteralPath $indexPath)) { throw "process index not found: $indexPath" }
$idx = Get-Content -LiteralPath $indexPath -Raw | ConvertFrom-Json
$pid0 = [int]$idx.pid
$cwd = [string]$idx.cwd
$cmdline = [string]$idx.commandLine
if (-not (Get-Process -Id $pid0 -ErrorAction SilentlyContinue)) { throw "recorded pid $pid0 is not alive" }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logOut = Join-Path $env:TEMP ("dsh-restart-" + $stamp + ".out.log")
$logErr = Join-Path $env:TEMP ("dsh-restart-" + $stamp + ".err.log")
$cwdB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cwd))
$cmdB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cmdline))
$logOutB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($logOut))
$logErrB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($logErr))
$helperTemplate = @'
$ErrorActionPreference = 'Continue'
$nodePid = __PID__
$cwdB64 = '__CWDB64__'
$cmdB64 = '__CMDB64__'
$logOutB64 = '__LOGOUTB64__'
$logErrB64 = '__LOGERRB64__'
$delayMs = __DELAY__
$cwd = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($cwdB64))
$cmdline = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($cmdB64))
$logOut = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($logOutB64))
$logErr = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($logErrB64))
Start-Sleep -Milliseconds $delayMs
taskkill /F /T /PID $nodePid 2>&1 | Out-Null
Start-Sleep -Milliseconds 500
try {
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/s','/c', $cmdline -WorkingDirectory $cwd -WindowStyle Hidden -RedirectStandardOutput $logOut -RedirectStandardError $logErr
} catch {
  Invoke-CimMethod Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdline; CurrentDirectory = $cwd } | Out-Null
}
'@
$helper = $helperTemplate.Replace('__PID__', [string]$pid0).Replace('__CWDB64__', $cwdB64).Replace('__CMDB64__', $cmdB64).Replace('__LOGOUTB64__', $logOutB64).Replace('__LOGERRB64__', $logErrB64).Replace('__DELAY__', [string]${delayMs})
$helperPath = Join-Path $env:TEMP 'dsh-restart-helper.ps1'
Set-Content -LiteralPath $helperPath -Value $helper -Encoding UTF8
$launch = 'pwsh.exe -NoProfile -NonInteractive -File "' + $helperPath + '"'
$r = Invoke-CimMethod Win32_Process -MethodName Create -Arguments @{ CommandLine = $launch }
$result = [ordered]@{ pid = $pid0; cwd = $cwd; commandLine = $cmdline; delayMs = ${delayMs}; helperReturnValue = [int]$r.ReturnValue; helperPid = [int]$r.ProcessId; logOut = $logOut; logErr = $logErr }
$result | ConvertTo-Json -Compress`;
}
/** Run the legacy PowerShell/WMI restart through the shell service. */
async function restartLegacy(ctx, delayMs, policy) {
    const request = {
        command: buildLegacyScript(indexFilePath(), delayMs),
        timeoutMs: 30000,
    };
    if (policy !== undefined)
        request.sandboxPolicy = policy;
    const spec = ctx.shell.resolve(request);
    const result = await ctx.shell.run(spec);
    const stdout = result.stdout && typeof result.stdout.text === 'string' ? result.stdout.text : '';
    const stderr = result.stderr && typeof result.stderr.text === 'string' ? result.stderr.text : '';
    if (result.exitCode !== 0) {
        return { ok: false, error: 'legacy restart failed', exitCode: result.exitCode, stdout, stderr };
    }
    try {
        return { ok: true, ...JSON.parse(stdout.trim()) };
    }
    catch {
        return { ok: false, error: 'failed to parse legacy restart output', stdout, stderr };
    }
}
export function apply(ctx) {
    debugLog(`apply: start pid=${process.pid}`);
    try {
        writeProcessIndex();
        debugLog('apply: index written');
    }
    catch (error) {
        debugLog('apply: writeProcessIndex THREW: ' + String(error));
    }
    disableLegacyWatchdog();
    let resolveConfig = () => DEFAULT_CONFIG;
    const dynamic = () => resolveConfig();
    try {
        ctx.inject(['settings'], (settingsCtx) => {
            // TS 5.9 对 schemastery 3.18.2 的 z.object() 推断出 Schema<ObjectS, ObjectT> (S≠T),
            // 与 installSection 的 z<T> 不兼容; 运行时无差异, 用断言收敛到声明类型。
            settingsCtx.settings.installSection(ctx, 'dsh-restart', RestartConfigSchema, DEFAULT_CONFIG, {
                setSource: (get) => { resolveConfig = get; },
                onChange: () => { },
            });
        });
        debugLog('apply: settings installed');
    }
    catch (error) {
        debugLog('apply: settings installSection THREW: ' + String(error));
    }
    try {
        tryAutoContinue(ctx, dynamic);
        debugLog('apply: auto-continue scheduled');
    }
    catch (error) {
        debugLog('apply: tryAutoContinue THREW: ' + String(error));
    }
    // The restart bundle may mount before the Web host. A one-shot ctx.get()
    // therefore makes the Settings button permanently unavailable on that boot.
    // Inject the optional service so the route follows the Web server lifetime.
    ctx.inject(['webServer'], (webCtx) => {
        const webServer = webCtx.webServer;
        webCtx.effect(() => webServer.register({
            kind: 'exact',
            path: '/plugins/dsh-restart/restart',
            handler: (req, res) => {
                if (req.method === 'GET') {
                    if (!isLoopbackWebRequest(req)) {
                        res.writeHead(403);
                        res.end('forbidden');
                        return;
                    }
                    res.writeHead(200, {
                        'content-type': 'application/json; charset=utf-8',
                        'cache-control': 'no-store',
                    });
                    res.end(JSON.stringify({ pid: process.pid, startedAt: PROCESS_STARTED_AT }));
                    return;
                }
                if (req.method !== 'POST') {
                    res.writeHead(405, { allow: 'GET, POST' });
                    res.end('method not allowed');
                    return;
                }
                if (!isTrustedWebRestart(req)) {
                    res.writeHead(403);
                    res.end('forbidden');
                    return;
                }
                const sessionIds = runningSessionIds(ctx);
                if (sessionIds.length > 0)
                    writeResumeMarker(sessionIds);
                const result = restart(2000);
                res.writeHead(202, {
                    'content-type': 'application/json; charset=utf-8',
                    'cache-control': 'no-store',
                });
                res.end(JSON.stringify({ ...result, sessionIds }));
            },
        }), 'dsh-restart: restart route');
    });
    try {
        ctx.tools.register(defineTool({
            name: 'restart_harness',
            description: '重启整个 DeepSeek Harness 进程，用于重新加载插件与配置（profile 的 cordis 组合、settings 等）。'
                + '默认 waitForTurnEnd=true：本工具立即返回，真正的重启排在本轮回复送达之后，'
                + '因此不会掐断本轮、也不需要你停手；轮后新到的用户消息留在持久 inbox，重启后继续处理。'
                + '重启完成后自动注入「请继续之前未完成的工作」恢复会话。'
                + 'waitForTurnEnd=false 退回旧的固定延迟行为（此时调用后本轮不要再发起工具调用）。'
                + '返回旧进程 pid、cwd、命令行与日志文件路径。',
            parameters: {
                waitForTurnEnd: { type: 'boolean', description: '等当前轮结束再重启（默认 true）：工具立即返回，重启排在本轮回复送达之后；轮后新到的消息留在持久 inbox，重启后继续处理。' },
                maxWaitMs: { type: 'number', description: 'waitForTurnEnd 的最长等待毫秒数，超时强制重启，默认 60000（与旧固定延迟同档，保证最坏情况不退化）。' },
                delayMs: { type: 'number', description: '固定延迟重启（仅 waitForTurnEnd=false 时生效），默认且不低于 6000。' },
            },
            output: {
                schema: { type: 'json' },
                render(_args, value) {
                    return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
                },
            },
            async execute(args, exec) {
                const a = (args ?? {});
                // 下限 6000ms: 工具结果送达后还要留出模型生成这一轮文字回复并推到客户端的
                // 时间 —— 太短会出现「重启已执行, 但本轮消息没回送」, 只能靠人再发一条。
                const delayMs = Number(a.delayMs) > 0 ? Math.max(6000, Math.floor(Number(a.delayMs))) : 6000;
                // Only resume sessions that were mid-turn (running) at restart time. Idle
                // (already-ended) conversations are left alone — the client re-opens them.
                const sessionIds = runningSessionIds(ctx);
                if (sessionIds.length > 0)
                    writeResumeMarker(sessionIds);
                // 默认路径(2026-10-30): 等当前轮结束即重启 —— 比固定延迟灵敏(短回复不必白等),
                // 也比 whenIdle 稳(轮后新消息不会拖住重启; inbox 是持久投影, 它们在重启后照常处理)。
                const waitForTurnEnd = a.waitForTurnEnd !== false;
                if (waitForTurnEnd && sessionIds.length > 0 && !dynamic().legacyRestart) {
                    const maxWaitMs = Number(a.maxWaitMs) > 0 ? Math.floor(Number(a.maxWaitMs)) : 60000;
                    scheduleRestartAfterTurnEnd(ctx, sessionIds, maxWaitMs);
                    return { ...pendingRestartInfo(), sessionIds, mode: 'after-turn-end', maxWaitMs };
                }
                if (dynamic().legacyRestart) {
                    let policy;
                    if (exec?.agent?.session) {
                        try {
                            policy = ctx.sandboxPolicy.resolve({ session: exec.agent.session });
                        }
                        catch {
                            policy = undefined;
                        }
                    }
                    const result = await restartLegacy(ctx, delayMs, policy);
                    return { ...result, sessionIds };
                }
                return { ...restart(delayMs), sessionIds };
            },
        }));
        debugLog('apply: restart_harness tool registered');
    }
    catch (error) {
        debugLog('apply: tools.register THREW: ' + String(error));
    }
    try {
        ctx.commands.register({
            name: 'restart',
            description: '重启 DeepSeek Harness（重载插件与配置）',
            recordInput: false,
            async handler(invocation) {
                // Only resume sessions that were mid-turn (running); idle conversations stay put.
                const sessionIds = runningSessionIds(ctx);
                if (sessionIds.length > 0)
                    writeResumeMarker(sessionIds);
                let result;
                if (dynamic().legacyRestart) {
                    let policy;
                    if (invocation?.agent?.session) {
                        try {
                            policy = ctx.sandboxPolicy.resolve({ session: invocation.agent.session });
                        }
                        catch {
                            policy = undefined;
                        }
                    }
                    result = await restartLegacy(ctx, 2000, policy);
                }
                else {
                    result = restart(2000);
                }
                const r = result;
                if (r.ok === false) {
                    return { kind: 'error', text: r.error ?? '重启失败' };
                }
                return {
                    kind: 'success',
                    text: r.via === 'launchd'
                        ? `重启已安排：launchd 将重启 DSH（${r.launchdLabel}），PID ${r.pid} 即将退出，将恢复 ${sessionIds.length} 个会话`
                        : `重启已安排：DSH 进程 PID ${r.pid} 将在约 ${r.delayMs}ms 后重启，将恢复 ${sessionIds.length} 个会话，新进程日志见 ${r.logOut}`,
                };
            },
        });
        debugLog('apply: restart command registered');
    }
    catch (error) {
        debugLog('apply: commands.register THREW: ' + String(error));
    }
    debugLog('apply: complete');
}
