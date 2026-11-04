/**
 * dsh-restart — client half: the plugin's configuration page on the Web
 * Plugins page, bound to the `dsh-restart` settings namespace the Host
 * derives from this plugin's exported Config schema.
 *
 * The page registers into `plugins.bundle.config`, keyed by this bundle's
 * package name, while the Host serves that namespace — a deployment whose
 * Host never serves it shows no trace of the page.
 */
import { SettingsFormModel, settingsTextField, } from '@deepseek-ai/dsh-client-ui-primitives';
import { SettingsCard } from "./SettingsCard.js";
import { en, zh } from "./locales.js";
import { ensureStyles } from "./styles.js";
export const name = 'dsh-restart-client';
export const inject = ['slots', 'locale', 'configForms'];
/** Dictionary namespace owned by this plugin. */
export const NS = 'restart.card';
/** Settings namespace this page edits: the plugin's own profile entry id. */
const NAMESPACE = 'dsh-restart';
/**
 * A boolean field. The form model stages text, so the control writes 'true'
 * and 'false'; any other draft is not a value this field accepts.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
function settingsBooleanField(field) {
    return {
        field,
        format: value => value === true ? 'true' : 'false',
        parse: (text) => {
            if (text === 'true')
                return { kind: 'set', value: true };
            if (text === 'false')
                return { kind: 'set', value: false };
            return undefined;
        },
    };
}
/**
 * Mount the restart configuration page while the Host serves its namespace.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx) {
    ensureStyles();
    const t = ctx.locale.bind(NS);
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-restart: dictionaries');
    const form = new SettingsFormModel(ctx.configForms.get(NAMESPACE), [
        settingsBooleanField('legacyRestart'),
        settingsTextField('continuePrompt'),
    ]);
    ctx.effect(() => () => { form.dispose(); }, 'dsh-restart: form subscription');
    const actions = form.actions();
    const store = form.bind(() => ({
        ...form.shell(),
        legacyRestart: form.field('legacyRestart').text === 'true',
        continuePrompt: form.field('continuePrompt'),
    }));
    ctx.effect(() => ctx.configForms.whileServed([NAMESPACE], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        // Keyed by the bundle's package name: the page renders it on that
        // bundle's own page, which is where an installed plugin is configured.
        name: 'plugins.bundle.config', key: 'dsh-restart', locale: NS,
        inject: () => ({ ...actions, hooks: { dshRestart: store } }),
    }, SettingsCard))), 'dsh-restart: page');
}
