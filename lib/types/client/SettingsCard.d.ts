import type { SettingsCardProps } from './index.ts';
/**
 * The dsh-restart configuration page: the restart method, the continue prompt,
 * and the immediate restart control. The Plugins page draws the title and
 * one-liner itself; this component renders only what the page asks for.
 * @param props - the view asked for, locale copy, the form snapshot, and its actions.
 * @returns the one-liner, or the settings form.
 */
export declare function SettingsCard(props: SettingsCardProps): string | import("react").JSX.Element;
