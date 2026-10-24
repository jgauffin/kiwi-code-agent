import { compileTemplate } from '@relax.js/core/html'
import type { AttachedImage } from '../protocol'
import { prepareImage } from './image-prep'

/**
 * The images the next prompt carries: a thumbnail each, with an X to drop it.
 * Owns the list; whoever sends the prompt reads it off the row and clears it.
 * Nothing here is written anywhere: the images live in this element until sent.
 */
export class AttachedImagesRow extends HTMLElement {
  private readonly template = compileTemplate(`
    <span class="image" loop="i in images" title="Attached image {{i.number}}">
      <img src="{{i.src}}" alt="Attached image {{i.number}}">
      <button type="button" class="remove-image" title="Remove image {{i.number}}" r-click="remove(i)">✕</button>
    </span>
  `)
  private attached: AttachedImage[] = []

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.appendChild(this.template.content)
    this.render()
  }

  attach(images: AttachedImage[]): void {
    if (images.length === 0) return
    this.attached = [...this.attached, ...images]
    this.render()
  }

  /** The attached images, in the order they were attached. */
  get images(): AttachedImage[] {
    return [...this.attached]
  }

  clear(): void {
    if (this.attached.length === 0) return
    this.attached = []
    this.render()
  }

  private render(): void {
    this.template.render(
      { images: this.attached.map((image, index) => ({ index, number: index + 1, src: `data:${image.mediaType};base64,${image.data}` })) },
      {
        remove: (shown: { index: number }) => {
          this.attached = this.attached.filter((_, index) => index !== shown.index)
          this.render()
        },
      },
    )
  }
}

customElements.define('attached-images-row', AttachedImagesRow)

function imageFiles(transfer: DataTransfer | null): File[] {
  return [...(transfer?.files ?? [])].filter((file) => file.type.startsWith('image/'))
}

async function readImage(file: File): Promise<AttachedImage> {
  const read = await readFile(file)
  return prepareImage(file, file.type, read)
}

function readFile(file: File): Promise<AttachedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`))
    reader.onload = () => {
      // A data URL: "data:<type>;base64,<data>".
      const url = String(reader.result)
      resolve({ mediaType: file.type, data: url.slice(url.indexOf(',') + 1) })
    }
    reader.readAsDataURL(file)
  })
}

async function attachFiles(row: AttachedImagesRow, files: File[]): Promise<void> {
  try {
    row.attach(await Promise.all(files.map(readImage)))
  } catch (error) {
    console.error('Kiwipow Agent: could not attach the image', error)
  }
}

/**
 * Makes `host` take pasted and dropped images into the row `rowOf` finds for
 * the place they landed on. A clipboard that also holds text pastes as text:
 * office apps put a picture of the copied cells beside them, and the cells are
 * what was meant. A dropped file is only read, never opened or moved.
 */
export function acceptImages(host: HTMLElement, rowOf: (target: EventTarget | null) => AttachedImagesRow | null): void {
  host.addEventListener('paste', (event) => {
    const files = imageFiles(event.clipboardData)
    const row = rowOf(event.target)
    if (files.length === 0 || !row || event.clipboardData?.getData('text/plain')) return
    event.preventDefault()
    void attachFiles(row, files)
  })
  host.addEventListener('dragover', (event) => {
    if (imageFiles(event.dataTransfer).length > 0 || [...(event.dataTransfer?.items ?? [])].some((item) => item.kind === 'file' && item.type.startsWith('image/'))) {
      event.preventDefault()
    }
  })
  host.addEventListener('drop', (event) => {
    const files = imageFiles(event.dataTransfer)
    const row = rowOf(event.target)
    if (files.length === 0 || !row) return
    event.preventDefault()
    void attachFiles(row, files)
  })
}
