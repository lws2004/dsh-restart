/**
 * dsh-restart — client half: the plugin's configuration page on the Web
 * Plugins page, bound to the `dsh-restart` settings namespace the Host
 * derives from this plugin's exported Config schema.
 *
 * The page registers into `plugins.bundle.config`, keyed by this bundle's
 * package name, while the Host serves that namespace — a deployment whose
 * Host never serves it shows no trace of the page.
 */

import type { Context } from './context-types.ts'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  SettingsFormModel, settingsTextField,
  type SettingsFieldSpec, type SettingsFieldState, type SettingsFormActions, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { SettingsCard } from './SettingsCard.tsx'
import { en, zh } from './locales.ts'
import { ensureStyles } from './styles.ts'

export const name = 'dsh-restart-client'
export const inject = ['slots', 'locale', 'configForms']

/** Dictionary namespace owned by this plugin. */
export const NS = 'restart.card'

/** Settings namespace this page edits: the plugin's own profile entry id. */
const NAMESPACE = 'dsh-restart'

/** What the page renders: the shared form shell plus this card's two controls. */
export interface RestartCardState extends SettingsFormShell {
  /** Whether the legacy PowerShell/WMI restart path is selected. */
  legacyRestart: boolean
  /** The staged continue prompt. */
  continuePrompt: SettingsFieldState
}

/** The registration-side face the page's slot entry injects. */
export interface RestartCardFace extends SettingsFormActions {
  hooks: {
    /** Page snapshot bound by the renderer as useDshRestart. */
    dshRestart: SnapshotStore<RestartCardState>
  }
}

export type SettingsCardProps =
  PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<typeof NS>
  & InjectFace<RestartCardFace>

/**
 * A boolean field. The form model stages text, so the control writes 'true'
 * and 'false'; any other draft is not a value this field accepts.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
function settingsBooleanField(field: string): SettingsFieldSpec {
  return {
    field,
    format: value => value === true ? 'true' : 'false',
    parse: (text) => {
      if (text === 'true') return { kind: 'set', value: true }
      if (text === 'false') return { kind: 'set', value: false }
      return undefined
    },
  }
}

/**
 * Mount the restart configuration page while the Host serves its namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: Context): void {
  ensureStyles()
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-restart: dictionaries')

  const form = new SettingsFormModel<Record<string, unknown>>(ctx.configForms.get(NAMESPACE), [
    settingsBooleanField('legacyRestart'),
    settingsTextField('continuePrompt'),
  ])
  ctx.effect(() => () => { form.dispose() }, 'dsh-restart: form subscription')
  const actions = form.actions()
  const store = form.bind<RestartCardState>(() => ({
    ...form.shell(),
    legacyRestart: form.field('legacyRestart').text === 'true',
    continuePrompt: form.field('continuePrompt'),
  }))

  ctx.effect(
    () => ctx.configForms.whileServed([NAMESPACE], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
      // Keyed by the bundle's package name: the page renders it on that
      // bundle's own page, which is where an installed plugin is configured.
      name: 'plugins.bundle.config', key: 'dsh-restart', locale: NS,
      inject: (): RestartCardFace => ({ ...actions, hooks: { dshRestart: store } }),
    }, SettingsCard))),
    'dsh-restart: page',
  )
}
