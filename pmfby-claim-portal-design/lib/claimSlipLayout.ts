export const PAGE_WIDTH = 210
export const PAGE_HEIGHT = 297
export const MARGIN = 16
export const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN
export const BODY_BOTTOM = 213
export const MEDIA_TOP = 218
export const FOOTER_TOP = 275

export interface MeasuredBlock {
  key: string
  lines: string[]
  lineHeight: number
  maxLines: number
}

/** Pure layout: input lines have already been measured with the intended font. */
export function computeSlipLayout(blocks: MeasuredBlock[], startY = 47, bottom = BODY_BOTTOM) {
  let cursor = startY
  return blocks.map(block => {
    const available = Math.max(0, Math.floor((bottom - cursor - 3) / block.lineHeight))
    const count = Math.min(block.maxLines, available)
    const lines = block.lines.slice(0, count)
    const truncated = block.lines.length > count
    // The renderer reserves width for '...' when measuring each line.
    if (truncated && lines.length) lines[lines.length - 1] = lines[lines.length - 1].trimEnd() + '...'
    const y = cursor
    const height = lines.length * block.lineHeight
    cursor = Math.min(bottom, cursor + height + 3)
    return { key: block.key, lines, y, height, lineHeight: block.lineHeight, truncated }
  })
}