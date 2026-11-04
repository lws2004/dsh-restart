import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { SettingsForm, SettingsValueField, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import { restartAndWait } from "./restart-monitor.js";
import { styles as css } from "./styles.js";
const RESTART_SUCCEEDED_KEY = 'dsh-restart:completed';
function consumeRestartSucceeded() {
    try {
        const succeeded = sessionStorage.getItem(RESTART_SUCCEEDED_KEY) === '1';
        if (succeeded)
            sessionStorage.removeItem(RESTART_SUCCEEDED_KEY);
        return succeeded;
    }
    catch {
        return false;
    }
}
function rememberRestartSucceeded() {
    try {
        sessionStorage.setItem(RESTART_SUCCEEDED_KEY, '1');
    }
    catch { /* reload still works */ }
}
/**
 * The dsh-restart configuration page: the restart method, the continue prompt,
 * and the immediate restart control. The Plugins page draws the title and
 * one-liner itself; this component renders only what the page asks for.
 * @param props - the view asked for, locale copy, the form snapshot, and its actions.
 * @returns the one-liner, or the settings form.
 */
export function SettingsCard(props) {
    const { t } = props;
    const state = props.useDshRestart(snapshot => snapshot);
    const [restarting, setRestarting] = useState(false);
    const [restartFailed, setRestartFailed] = useState(false);
    const [restartStale, setRestartStale] = useState(false);
    const [restartSucceeded, setRestartSucceeded] = useState(consumeRestartSucceeded);
    const restartController = useRef(null);
    useEffect(() => () => { restartController.current?.abort(); }, []);
    useEffect(() => {
        if (!restartSucceeded)
            return;
        const timer = window.setTimeout(() => { setRestartSucceeded(false); }, 5000);
        return () => { window.clearTimeout(timer); };
    }, [restartSucceeded]);
    if (props.view === 'summary')
        return t('description');
    const disabled = !state.writable || state.saving;
    const restartNow = async () => {
        if (restarting)
            return;
        setRestarting(true);
        setRestartFailed(false);
        setRestartStale(false);
        setRestartSucceeded(false);
        const controller = new AbortController();
        restartController.current = controller;
        try {
            const result = await restartAndWait({
                signal: controller.signal,
                isVisible: () => document.visibilityState === 'visible',
            });
            if (result === 'stale') {
                setRestartStale(true);
                setRestarting(false);
                return;
            }
            rememberRestartSucceeded();
            window.location.reload();
        }
        catch {
            if (controller.signal.aborted)
                return;
            setRestartFailed(true);
            setRestarting(false);
        }
        finally {
            if (restartController.current === controller)
                restartController.current = null;
        }
    };
    return (_jsxs(SettingsForm, { labels: {
            unavailable: t('unavailable'),
            readOnly: t('readOnly'),
            saveFailed: t('saveFailed'),
            save: t('save'),
            saving: t('saving'),
        }, state: state, onSave: props.save, onDiscard: props.discard, children: [_jsxs("div", { className: css.toggleRow, children: [_jsxs("div", { className: css.toggleCopy, children: [_jsx("span", { className: css.label, children: t('legacyRestart') }), _jsx("span", { className: css.hint, children: t('legacyRestartHint') })] }), _jsx(Switch, { checked: state.legacyRestart, onChange: (next) => { props.edit('legacyRestart', next ? 'true' : 'false'); }, label: t('legacyRestart'), disabled: disabled })] }), _jsx(SettingsValueField, { id: "dsh-restart-continue-prompt", label: t('continuePrompt'), hint: t('continuePromptHint'), overriddenLabel: t('overridden'), resetLabel: t('reset'), invalidLabel: t('invalidValue'), disabled: disabled, ...state.continuePrompt, onEdit: (text) => { props.edit('continuePrompt', text); }, onReset: () => { props.resetField('continuePrompt'); } }), _jsxs("div", { className: css.restartRow, children: [_jsx("p", { className: restartFailed || restartStale ? css.failed : css.actionHint, role: "status", "aria-live": "polite", children: restartStale ? t('restartStale') : restartFailed ? t('restartFailed') : restartSucceeded ? t('restartSucceeded') : t('restartHint') }), _jsx("button", { type: "button", className: css.restart, disabled: restarting, onClick: () => { void restartNow(); }, children: t(restarting ? 'restarting' : 'restartNow') })] })] }));
}
