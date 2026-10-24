// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunLog } from '../src/agent/runs/run-log'
import { forDisplay } from '../src/chat/display-event'

;(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => undefined })
vi.resetModules()
const { ChatTranscript } = await import('../src/chat/webview/chat-transcript')

const picture = { mediaType: 'image/png', data: 'AAAA' }

function shown(events: Parameters<InstanceType<typeof ChatTranscript>['apply']>[0][], live: boolean): InstanceType<typeof ChatTranscript> {
  const view = new ChatTranscript()
  document.body.appendChild(view)
  if (live) for (const event of events) view.apply(event)
  else view.reset(events, false)
  return view
}

describe('images in the transcript', () => {
  it('a_message_with_images_notes_how_many_it_carried', () => {
    const view = shown([{ type: 'user_message', text: 'look', imageCount: 2, images: [picture, picture] }], true)
    expect(view.querySelector('.user .image-note')?.textContent).toBe('2 images')
  })

  it('a_live_message_shows_its_images_as_thumbnails', () => {
    const view = shown([{ type: 'user_message', text: 'look', imageCount: 1, images: [picture] }], true)
    expect(view.querySelector<HTMLImageElement>('.user .sent-images img')?.src).toBe('data:image/png;base64,AAAA')
  })

  it('a_replayed_message_shows_the_note_and_no_images_since_the_log_keeps_only_the_count', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'image-log-'))
    try {
      const log = RunLog.forSession(dir, 's')
      await log.append({ type: 'user_message', text: 'look', imageCount: 1, images: [picture] })
      const events = (await log.read()).map((entry) => forDisplay(entry.event))
      const view = shown(events, false)
      expect(view.querySelector('.user .image-note')?.textContent).toBe('1 image')
      expect(view.querySelector('img')).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
