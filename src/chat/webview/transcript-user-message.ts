import type { SessionEvent } from '../../agent/session/code-session'
import { imageCountNote } from '../image-note'
import { renderAnsi } from './ansi'
import { block, copyButton, imageNote, thumbnails } from './transcript-blocks'

/** What the extension sent on the person's behalf is named, not quoted; the host never passes its text on. */
export function userMessageBlock(event: Extract<SessionEvent, { type: 'user_message' }>): HTMLElement {
  const count = event.imageCount ?? 0
  const note = imageCountNote(count)
  let message: HTMLElement
  if (event.label) message = block('turn kickoff', event.label)
  else {
    message = block('user', event.text, renderAnsi)
    message.appendChild(copyButton(() => event.text))
  }
  // An image-only prompt already says so as its label.
  if (count > 0 && event.label !== note) message.appendChild(imageNote(note))
  if (event.images?.length) message.appendChild(thumbnails(event.images))
  return message
}

export function resumeButton(onResume: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'resume'
  button.textContent = 'Resume'
  button.addEventListener('click', onResume)
  return button
}
