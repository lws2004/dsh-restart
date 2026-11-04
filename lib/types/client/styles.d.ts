/** Stable local class names; the plugin ships as one self-contained client.js. */
export declare const styles: {
    readonly toggleRow: "dsh-restart-toggle-row";
    readonly toggleCopy: "dsh-restart-toggle-copy";
    readonly label: "dsh-restart-label";
    readonly hint: "dsh-restart-hint";
    readonly restartRow: "dsh-restart-restart-row";
    readonly actionHint: "dsh-restart-action-hint";
    readonly failed: "dsh-restart-failed";
    readonly restart: "dsh-restart-button";
};
/** Install card styles once without creating a second dynamically loaded asset. */
export declare function ensureStyles(): void;
