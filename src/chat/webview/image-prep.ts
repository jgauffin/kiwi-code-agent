import type { AttachedImage } from '../protocol'

/** The longest edge, in pixels, an image keeps when it goes to the model. */
export const MAX_EDGE = 2000

const MODEL_FORMATS = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** The size an image is sent at: its proportions kept, the longer edge no more than `MAX_EDGE`. */
export function sentSize(width: number, height: number): { width: number; height: number } {
  const longer = Math.max(width, height)
  if (longer <= MAX_EDGE) return { width, height }
  const scale = MAX_EDGE / longer
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** The type an image is sent as: its own when the model takes it, PNG otherwise. */
export function sentType(mediaType: string): string {
  return MODEL_FORMATS.includes(mediaType) ? mediaType : 'image/png'
}

/** Whether the image has to be redrawn: too large, or in a format the model does not take. */
export function needsRedraw(mediaType: string, width: number, height: number): boolean {
  return !MODEL_FORMATS.includes(mediaType) || Math.max(width, height) > MAX_EDGE
}

/**
 * Makes the image ready for the model: scaled down to `MAX_EDGE` and converted to PNG
 * when its format is not one the model takes. An image that needs neither is left as it is.
 * A resized GIF becomes PNG, as a canvas cannot write one.
 */
export async function prepareImage(file: Blob, mediaType: string, original: AttachedImage): Promise<AttachedImage> {
  // A webview without image decoding cannot measure it; the image goes as it was read.
  if (typeof createImageBitmap !== 'function') return original
  const bitmap = await createImageBitmap(file)
  try {
    if (!needsRedraw(mediaType, bitmap.width, bitmap.height)) return original
    const { width, height } = sentSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height)
    const type = mediaType === 'image/gif' ? 'image/png' : sentType(mediaType)
    const url = canvas.toDataURL(type)
    return { mediaType: type, data: url.slice(url.indexOf(',') + 1) }
  } finally {
    bitmap.close()
  }
}
