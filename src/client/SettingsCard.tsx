import { useEffect, useRef, useState } from 'react'
import { SettingsForm, SettingsValueField, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsCardProps } from './index.ts'
import { restartAndWait } from './restart-monitor.ts'
import { styles as css } from './styles.ts'

const RESTART_SUCCEEDED_KEY = 'dsh-restart:completed'

function consumeRestartSucceeded(): boolean {
  try {
    const succeeded = sessionStorage.getItem(RESTART_SUCCEEDED_KEY) === '1'
    if (succeeded) sessionStorage.removeItem(RESTART_SUCCEEDED_KEY)
    return succeeded
  } catch {
    return false
  }
}

function rememberRestartSucceeded(): void {
  try { sessionStorage.setItem(RESTART_SUCCEEDED_KEY, '1') } catch { /* reload still works */ }
}

/**
 * The dsh-restart configuration page: the restart method, the continue prompt,
 * and the immediate restart control. The Plugins page draws the title and
 * one-liner itself; this component renders only what the page asks for.
 * @param props - the view asked for, locale copy, the form snapshot, and its actions.
 * @returns the one-liner, or the settings form.
 */
export function SettingsCard(props: SettingsCardProps) {
  const { t } = props
  const state = props.useDshRestart(snapshot => snapshot)
  const [restarting, setRestarting] = useState(false)
  const [restartFailed, setRestartFailed] = useState(false)
  const [restartStale, setRestartStale] = useState(false)
  const [restartSucceeded, setRestartSucceeded] = useState(consumeRestartSucceeded)
  const restartController = useRef<AbortController | null>(null)

  useEffect(() => () => { restartController.current?.abort() }, [])
  useEffect(() => {
    if (!restartSucceeded) return
    const timer = window.setTimeout(() => { setRestartSucceeded(false) }, 5000)
    return () => { window.clearTimeout(timer) }
  }, [restartSucceeded])

  if (props.view === 'summary') return t('description')
  const disabled = !state.writable || state.saving

  const restartNow = async (): Promise<void> => {
    if (restarting) return
    setRestarting(true)
    setRestartFailed(false)
    setRestartStale(false)
    setRestartSucceeded(false)
    const controller = new AbortController()
    restartController.current = controller
    try {
      const result = await restartAndWait({
        signal: controller.signal,
        isVisible: () => document.visibilityState === 'visible',
      })
      if (result === 'stale') {
        setRestartStale(true)
        setRestarting(false)
        return
      }
      rememberRestartSucceeded()
      window.location.reload()
    } catch {
      if (controller.signal.aborted) return
      setRestartFailed(true)
      setRestarting(false)
    } finally {
      if (restartController.current === controller) restartController.current = null
    }
  }

  return (
    <SettingsForm
      labels={{
        unavailable: t('unavailable'),
        readOnly: t('readOnly'),
        saveFailed: t('saveFailed'),
        save: t('save'),
        saving: t('saving'),
      }}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <div className={css.toggleRow}>
        <div className={css.toggleCopy}>
          <span className={css.label}>{t('legacyRestart')}</span>
          <span className={css.hint}>{t('legacyRestartHint')}</span>
        </div>
        <Switch
          checked={state.legacyRestart}
          onChange={(next) => { props.edit('legacyRestart', next ? 'true' : 'false') }}
          label={t('legacyRestart')}
          disabled={disabled}
        />
      </div>

      <SettingsValueField
        id="dsh-restart-continue-prompt"
        label={t('continuePrompt')}
        hint={t('continuePromptHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidValue')}
        disabled={disabled}
        {...state.continuePrompt}
        onEdit={(text) => { props.edit('continuePrompt', text) }}
        onReset={() => { props.resetField('continuePrompt') }}
      />

      <div className={css.restartRow}>
        <p className={restartFailed || restartStale ? css.failed : css.actionHint} role="status" aria-live="polite">
          {restartStale ? t('restartStale') : restartFailed ? t('restartFailed') : restartSucceeded ? t('restartSucceeded') : t('restartHint')}
        </p>
        <button type="button" className={css.restart} disabled={restarting} onClick={() => { void restartNow() }}>
          {t(restarting ? 'restarting' : 'restartNow')}
        </button>
      </div>
    </SettingsForm>
  )
}
