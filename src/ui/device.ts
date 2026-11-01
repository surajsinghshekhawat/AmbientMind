import type { Os } from '@shared/shortcuts'

export const clientOs: Os = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent) ? 'mac' : 'win'

/** How the copy names the computer, as in “stays on this Mac”. */
export const THIS_DEVICE = clientOs === 'mac' ? 'this Mac' : 'this PC'

/** The command key as people read it in a label: ⌘L, Ctrl+L. */
export const modKey = (key: string) => (clientOs === 'mac' ? `⌘${key}` : `Ctrl+${key}`)
