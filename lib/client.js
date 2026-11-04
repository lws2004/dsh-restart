window.__ModuleLoader__.load({
	id: "dsh-restart",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/client/restart-monitor.ts
		const RESTART_URL = "/plugins/dsh-restart/restart";
		var RestartProbeUnavailableError = class extends Error {
			constructor(message, options) {
				super(message, options);
				this.name = "RestartProbeUnavailableError";
			}
		};
		function abortError(signal) {
			return signal?.reason ?? new DOMException("The operation was aborted.", "AbortError");
		}
		function defaultSleep(delayMs, signal) {
			if (signal?.aborted) return Promise.reject(abortError(signal));
			return new Promise((resolve, reject) => {
				const onAbort = () => {
					window.clearTimeout(timer);
					signal?.removeEventListener("abort", onAbort);
					reject(abortError(signal));
				};
				const timer = window.setTimeout(() => {
					signal?.removeEventListener("abort", onAbort);
					resolve();
				}, delayMs);
				signal?.addEventListener("abort", onAbort, { once: true });
			});
		}
		function parseRestartIdentity(value) {
			const candidate = value;
			if (candidate === null || !Number.isInteger(candidate.pid) || Number(candidate.pid) <= 0 || typeof candidate.startedAt !== "string" || candidate.startedAt === "") throw new Error("invalid restart identity");
			return {
				pid: Number(candidate.pid),
				startedAt: candidate.startedAt
			};
		}
		async function fetchRestartIdentity(fetchImpl, signal) {
			let response;
			try {
				response = await fetchImpl(RESTART_URL, {
					method: "GET",
					cache: "no-store",
					signal
				});
			} catch (error) {
				if (signal?.aborted) throw error;
				throw new RestartProbeUnavailableError("identity probe unavailable", { cause: error });
			}
			if (!response.ok) throw new RestartProbeUnavailableError(`identity probe failed: HTTP ${response.status}`);
			return parseRestartIdentity(await response.json());
		}
		async function frontendReady(fetchImpl, signal) {
			let response;
			try {
				response = await fetchImpl("/", {
					method: "GET",
					cache: "no-store",
					signal
				});
			} catch (error) {
				if (signal?.aborted) throw error;
				throw new RestartProbeUnavailableError("frontend probe unavailable", { cause: error });
			}
			if (response.status === 401 || response.status === 403) throw new Error(`restart recovery unauthorized: HTTP ${response.status}`);
			return response.ok;
		}
		function identityChanged(before, after) {
			return before.pid !== after.pid || before.startedAt !== after.startedAt;
		}
		/** Restart DSH and wait until the process identity changes. */
		async function restartAndWait(options = {}) {
			const fetchImpl = options.fetchImpl ?? fetch;
			const isVisible = options.isVisible ?? (() => document.visibilityState === "visible");
			const maxRecoveryProbes = options.maxRecoveryProbes ?? 120;
			const maxVisibleStableProbes = options.maxVisibleStableProbes ?? 90;
			const pollIntervalMs = options.pollIntervalMs ?? 1e3;
			const sleep = options.sleep ?? defaultSleep;
			const { signal } = options;
			const baseline = await fetchRestartIdentity(fetchImpl, signal);
			const response = await fetchImpl(RESTART_URL, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
				signal
			});
			if (!response.ok) throw new Error(`restart request failed: HTTP ${response.status}`);
			let visibleStableProbes = 0;
			let recoveryProbes = 0;
			while (visibleStableProbes < maxVisibleStableProbes) {
				await sleep(pollIntervalMs, signal);
				let current;
				try {
					current = await fetchRestartIdentity(fetchImpl, signal);
				} catch (error) {
					if (!(error instanceof RestartProbeUnavailableError)) throw error;
					continue;
				}
				if (identityChanged(baseline, current)) {
					recoveryProbes += 1;
					try {
						if (await frontendReady(fetchImpl, signal)) return "restarted";
					} catch (error) {
						if (!(error instanceof RestartProbeUnavailableError)) throw error;
					}
					if (recoveryProbes >= maxRecoveryProbes) throw new Error("restarted process did not serve the authenticated frontend");
					continue;
				}
				if (isVisible()) visibleStableProbes += 1;
			}
			return "stale";
		}
		// src/client/styles.ts
		/** Stable local class names; the plugin ships as one self-contained client.js. */
		const styles = {
			toggleRow: "dsh-restart-toggle-row",
			toggleCopy: "dsh-restart-toggle-copy",
			label: "dsh-restart-label",
			hint: "dsh-restart-hint",
			restartRow: "dsh-restart-restart-row",
			actionHint: "dsh-restart-action-hint",
			failed: "dsh-restart-failed",
			restart: "dsh-restart-button"
		};
		const STYLE_ID = "dsh-restart-settings-card-styles";
		/** Install card styles once without creating a second dynamically loaded asset. */
		function ensureStyles() {
			if (document.getElementById(STYLE_ID) !== null) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = `
.dsh-restart-toggle-row{display:flex;align-items:flex-start;gap:12px;padding:12px 0}
.dsh-restart-toggle-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}
.dsh-restart-label{font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dsh-restart-hint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.dsh-restart-restart-row{display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-restart-action-hint,.dsh-restart-failed{flex:1;min-width:0;margin:0;font-size:12px;line-height:1.5}
.dsh-restart-action-hint{color:var(--dsw-alias-label-tertiary)}.dsh-restart-failed{color:var(--dsw-alias-label-error)}
.dsh-restart-button{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dsh-restart-button:disabled{opacity:.4;cursor:default}
.dsh-restart-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
@media(max-width:480px){.dsh-restart-restart-row{align-items:stretch;flex-direction:column}.dsh-restart-button{width:100%}}
`;
			document.head.append(style);
		}
		// src/client/SettingsCard.tsx
		const RESTART_SUCCEEDED_KEY = "dsh-restart:completed";
		function consumeRestartSucceeded() {
			try {
				const succeeded = sessionStorage.getItem(RESTART_SUCCEEDED_KEY) === "1";
				if (succeeded) sessionStorage.removeItem(RESTART_SUCCEEDED_KEY);
				return succeeded;
			} catch {
				return false;
			}
		}
		function rememberRestartSucceeded() {
			try {
				sessionStorage.setItem(RESTART_SUCCEEDED_KEY, "1");
			} catch {}
		}
		/**
		* The dsh-restart configuration page: the restart method, the continue prompt,
		* and the immediate restart control. The Plugins page draws the title and
		* one-liner itself; this component renders only what the page asks for.
		* @param props - the view asked for, locale copy, the form snapshot, and its actions.
		* @returns the one-liner, or the settings form.
		*/
		function SettingsCard(props) {
			const { t } = props;
			const state = props.useDshRestart((snapshot) => snapshot);
			const [restarting, setRestarting] = (0, react.useState)(false);
			const [restartFailed, setRestartFailed] = (0, react.useState)(false);
			const [restartStale, setRestartStale] = (0, react.useState)(false);
			const [restartSucceeded, setRestartSucceeded] = (0, react.useState)(consumeRestartSucceeded);
			const restartController = (0, react.useRef)(null);
			(0, react.useEffect)(() => () => {
				restartController.current?.abort();
			}, []);
			(0, react.useEffect)(() => {
				if (!restartSucceeded) return;
				const timer = window.setTimeout(() => {
					setRestartSucceeded(false);
				}, 5e3);
				return () => {
					window.clearTimeout(timer);
				};
			}, [restartSucceeded]);
			if (props.view === "summary") return t("description");
			const disabled = !state.writable || state.saving;
			const restartNow = async () => {
				if (restarting) return;
				setRestarting(true);
				setRestartFailed(false);
				setRestartStale(false);
				setRestartSucceeded(false);
				const controller = new AbortController();
				restartController.current = controller;
				try {
					if (await restartAndWait({
						signal: controller.signal,
						isVisible: () => document.visibilityState === "visible"
					}) === "stale") {
						setRestartStale(true);
						setRestarting(false);
						return;
					}
					rememberRestartSucceeded();
					window.location.reload();
				} catch {
					if (controller.signal.aborted) return;
					setRestartFailed(true);
					setRestarting(false);
				} finally {
					if (restartController.current === controller) restartController.current = null;
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(_deepseek_ai_dsh_client_ui_primitives.SettingsForm, {
				labels: {
					unavailable: t("unavailable"),
					readOnly: t("readOnly"),
					saveFailed: t("saveFailed"),
					save: t("save"),
					saving: t("saving")
				},
				state,
				onSave: props.save,
				onDiscard: props.discard,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: styles.toggleRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: styles.toggleCopy,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.label,
								children: t("legacyRestart")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: styles.hint,
								children: t("legacyRestartHint")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
							checked: state.legacyRestart,
							onChange: (next) => {
								props.edit("legacyRestart", next ? "true" : "false");
							},
							label: t("legacyRestart"),
							disabled
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SettingsValueField, {
						id: "dsh-restart-continue-prompt",
						label: t("continuePrompt"),
						hint: t("continuePromptHint"),
						overriddenLabel: t("overridden"),
						resetLabel: t("reset"),
						invalidLabel: t("invalidValue"),
						disabled,
						...state.continuePrompt,
						onEdit: (text) => {
							props.edit("continuePrompt", text);
						},
						onReset: () => {
							props.resetField("continuePrompt");
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: styles.restartRow,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: restartFailed || restartStale ? styles.failed : styles.actionHint,
							role: "status",
							"aria-live": "polite",
							children: restartStale ? t("restartStale") : restartFailed ? t("restartFailed") : restartSucceeded ? t("restartSucceeded") : t("restartHint")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: styles.restart,
							disabled: restarting,
							onClick: () => {
								restartNow();
							},
							children: t(restarting ? "restarting" : "restartNow")
						})]
					})
				]
			});
		}
		// src/client/locales.ts
		const zh = {
			title: "DSH 重启",
			description: "重启方式与自动继续提示词",
			legacyRestart: "旧重启方式",
			legacyRestartHint: "true = 用 PowerShell/WMI/taskkill 旧方式重启（适配）；false = Node 原生重启",
			continuePrompt: "重启后注入的提示词",
			continuePromptHint: "重启后自动继续时注入给 agent 的文本（空则用默认）",
			unavailable: "宿主未提供该配置",
			readOnly: "当前配置为只读",
			saveFailed: "保存失败，请检查后重试。",
			save: "保存",
			saving: "保存中…",
			overridden: "已覆盖",
			reset: "恢复默认",
			invalidValue: "该值无效",
			restartNow: "立即重启",
			restarting: "正在重启…",
			restartHint: "配置改动需保存后生效；立即重启会短暂断开当前页面。",
			restartFailed: "未能安排重启，请检查服务日志后重试。",
			restartStale: "已发送重启请求，但进程身份始终未变化。请检查服务日志。",
			restartSucceeded: "DSH 已重启并恢复连接。"
		};
		const en = {
			title: "DSH Restart",
			description: "Restart method and auto-continue prompt",
			legacyRestart: "Legacy restart",
			legacyRestartHint: "true = old PowerShell/WMI/taskkill restart; false = Node-native restart",
			continuePrompt: "Continue prompt",
			continuePromptHint: "Text injected to the agent after restart (empty = default)",
			unavailable: "The Host does not serve this configuration",
			readOnly: "This configuration is read-only",
			saveFailed: "The save did not land. Check the values and try again.",
			save: "Save",
			saving: "Saving…",
			overridden: "Overridden",
			reset: "Reset",
			invalidValue: "Not a valid value",
			restartNow: "Restart now",
			restarting: "Restarting…",
			restartHint: "Changes apply once saved; restarting briefly disconnects this page.",
			restartFailed: "Could not schedule the restart. Check the service logs and try again.",
			restartStale: "The restart was requested, but the process identity never changed. Check the service logs.",
			restartSucceeded: "DSH restarted and reconnected."
		};
		// src/client/index.ts
		const name = "dsh-restart-client";
		const inject = [
			"slots",
			"locale",
			"configForms"
		];
		/** Dictionary namespace owned by this plugin. */
		const NS = "restart.card";
		/** Settings namespace this page edits: the plugin's own profile entry id. */
		const NAMESPACE = "dsh-restart";
		/**
		* A boolean field. The form model stages text, so the control writes 'true'
		* and 'false'; any other draft is not a value this field accepts.
		* @param field - field name inside the namespace section.
		* @returns the field's conversion spec.
		*/
		function settingsBooleanField(field) {
			return {
				field,
				format: (value) => value === true ? "true" : "false",
				parse: (text) => {
					if (text === "true") return {
						kind: "set",
						value: true
					};
					if (text === "false") return {
						kind: "set",
						value: false
					};
				}
			};
		}
		/**
		* Mount the restart configuration page while the Host serves its namespace.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			ensureStyles();
			ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-restart: dictionaries");
			const form = new _deepseek_ai_dsh_client_ui_primitives.SettingsFormModel(ctx.configForms.get(NAMESPACE), [settingsBooleanField("legacyRestart"), (0, _deepseek_ai_dsh_client_ui_primitives.settingsTextField)("continuePrompt")]);
			ctx.effect(() => () => {
				form.dispose();
			}, "dsh-restart: form subscription");
			const actions = form.actions();
			const store = form.bind(() => ({
				...form.shell(),
				legacyRestart: form.field("legacyRestart").text === "true",
				continuePrompt: form.field("continuePrompt")
			}));
			ctx.effect(() => ctx.configForms.whileServed([NAMESPACE], () => ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
				name: "plugins.bundle.config",
				key: "dsh-restart",
				locale: NS,
				inject: () => ({
					...actions,
					hooks: { dshRestart: store }
				})
			}, SettingsCard))), "dsh-restart: page");
		}
		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map