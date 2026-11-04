/**
 * dsh-restart — client half: the plugin's configuration page on the Web
 * Plugins page, bound to the `dsh-restart` settings namespace the Host
 * derives from this plugin's exported Config schema.
 *
 * The page registers into `plugins.bundle.config`, keyed by this bundle's
 * package name, while the Host serves that namespace — a deployment whose
 * Host never serves it shows no trace of the page.
 */
import type { Context } from './context-types.ts';
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { type SettingsFieldState, type SettingsFormActions, type SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives';
export declare const name = "dsh-restart-client";
export declare const inject: string[];
/** Dictionary namespace owned by this plugin. */
export declare const NS = "restart.card";
/** What the page renders: the shared form shell plus this card's two controls. */
export interface RestartCardState extends SettingsFormShell {
    /** Whether the legacy PowerShell/WMI restart path is selected. */
    legacyRestart: boolean;
    /** The staged continue prompt. */
    continuePrompt: SettingsFieldState;
}
/** The registration-side face the page's slot entry injects. */
export interface RestartCardFace extends SettingsFormActions {
    hooks: {
        /** Page snapshot bound by the renderer as useDshRestart. */
        dshRestart: SnapshotStore<RestartCardState>;
    };
}
export type SettingsCardProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<typeof NS> & InjectFace<RestartCardFace>;
/**
 * Mount the restart configuration page while the Host serves its namespace.
 * @param ctx - the browser plugin context.
 */
export declare function apply(ctx: Context): void;
