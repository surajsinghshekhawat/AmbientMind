/** Shipped in the app's Resources/legal (see electron-builder.yml) and opened from Settings → About. */
export const LEGAL_DOCS = {
  privacy: 'PRIVACY.md',
  terms: 'TERMS.md',
  notices: 'THIRD_PARTY_NOTICES.md'
} as const

export type LegalDoc = keyof typeof LEGAL_DOCS

export function isLegalDoc(value: unknown): value is LegalDoc {
  return typeof value === 'string' && Object.hasOwn(LEGAL_DOCS, value)
}
