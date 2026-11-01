import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/** WCAG AA: body text needs 4.5:1; placeholders and decorative marks 3:1. */
const TEXT = 4.5
const HINT = 3

const css = readFileSync(join(__dirname, '..', 'src', 'ui', 'tokens.css'), 'utf8')

type Rgba = { rgb: [number, number, number]; alpha: number }

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  assert.notEqual(start, -1, `${selector} missing from tokens.css`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(oklch\([^)]*\))/g)].map((m) => [m[1], m[2]]))
}

function oklch(value: string): Rgba {
  const [l, c, h, alpha = 1] = value
    .replace(/oklch\(|\)/g, '')
    .split(/[\s/]+/)
    .filter(Boolean)
    .map(Number)
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const linear = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S
  ].map((x) => Math.min(1, Math.max(0, x)))
  const encode = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)
  return { rgb: linear.map(encode) as Rgba['rgb'], alpha }
}

function luminance([r, g, b]: number[]): number {
  const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Glass over a busy wallpaper is unknowable, so it's judged over the window colour it imitates. */
function contrast(fg: string, bg: string, base: string): number {
  const under = oklch(base).rgb
  const back = oklch(bg)
  const behind = back.rgb.map((x, i) => x * back.alpha + under[i] * (1 - back.alpha))
  const front = oklch(fg)
  const shown = front.rgb.map((x, i) => x * front.alpha + behind[i] * (1 - front.alpha))
  const [hi, lo] = [luminance(shown), luminance(behind)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const dark = block(':root,')
const light = { ...dark, ...block("[data-theme='light']") }
const THEMES = { dark, light }

for (const [name, tokens] of Object.entries(THEMES)) {
  for (const surface of ['window', 'sidebar', 'glass']) {
    test(`${name}: text is readable on ${surface}`, () => {
      for (const ink of ['ink-1', 'ink-2', 'ink-3', 'accent', 'danger', 'warning', 'soon', 'success']) {
        const ratio = contrast(tokens[ink], tokens[surface], tokens.window)
        assert.ok(ratio >= TEXT, `${ink} on ${surface}: ${ratio.toFixed(2)} < ${TEXT}`)
      }
      const hint = contrast(tokens['ink-4'], tokens[surface], tokens.window)
      assert.ok(hint >= HINT, `ink-4 on ${surface}: ${hint.toFixed(2)} < ${HINT}`)
    })
  }

  test(`${name}: white on a filled button is readable`, () => {
    const ratio = contrast(tokens['on-accent'], tokens['accent-fill'], tokens.window)
    assert.ok(ratio >= TEXT, `on-accent on accent-fill: ${ratio.toFixed(2)}`)
  })
}

test('the system-light palette is the light palette', () => {
  assert.deepEqual(block("[data-theme='system']"), block("[data-theme='light']"))
})
