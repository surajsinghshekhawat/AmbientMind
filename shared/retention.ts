/** Caps used by the retention sweep. Kept here so tests need no Electron. */

export const KEEP_EXAMPLES = 2000
export const KEEP_PROCESSED_DAYS = 90
export const KEEP_DECISIONS = 5000
/**
 * A deleted task blocks re-import only while its tombstone exists. Mail and
 * calendar sync look back days, not months, so this is far past any window
 * that could bring the item back.
 */
export const KEEP_TOMBSTONE_DAYS = 90
