import { compileTemplate } from '@relax.js/core/html'
import { LinkOpenFileRequestedEvent } from './events'

/**
 * The files the next prompt should name: the button that links whatever the
 * editor has open, and a chip per linked file with an X to drop it. Owns the
 * list; whoever sends the prompt reads it off the row and clears it.
 */
export class LinkedFilesRow extends HTMLElement {
  private readonly template = compileTemplate(`
    <button type="button" class="link-file" title="Link the file open in the editor; the prompt asks the agent to read it." r-click="linkOpenFile()">Link open file</button>
    <span class="files">
      <span loop="f in files" class="file" title="{{f.path}}">
        {{f.name}}
        <button type="button" class="unlink" title="Unlink {{f.path}}" r-click="unlink(f)">✕</button>
      </span>
    </span>
  `)
  private linked: string[] = []

  connectedCallback(): void {
    if (this.childElementCount > 0) return
    this.appendChild(this.template.content)
    this.render()
  }

  /** Links a file the host resolved; the same file twice stays one chip. */
  link(path: string): void {
    if (this.linked.includes(path)) return
    this.linked = [...this.linked, path]
    this.render()
  }

  /** The linked files, in the order they were linked. */
  get paths(): string[] {
    return [...this.linked]
  }

  clear(): void {
    if (this.linked.length === 0) return
    this.linked = []
    this.render()
  }

  private render(): void {
    this.template.render(
      { files: this.linked.map((path) => ({ path, name: path.split('/').pop() ?? path })) },
      {
        linkOpenFile: () => this.dispatchEvent(new LinkOpenFileRequestedEvent()),
        unlink: (file: { path: string }) => {
          this.linked = this.linked.filter((path) => path !== file.path)
          this.render()
        },
      },
    )
  }
}

customElements.define('linked-files-row', LinkedFilesRow)
