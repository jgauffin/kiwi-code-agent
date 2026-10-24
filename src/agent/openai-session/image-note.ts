import type { ChatMessage } from './chat-messages'

/** What the model reads in place of pictures it can no longer be shown. */
export function imagesNote(count: number): string {
  return count === 1 ? '[1 image was attached here]' : `[${count} images were attached here]`
}

/** The user's words followed by the note, or the note alone when there were no words. */
export function withImagesNote(text: string, count: number): string {
  if (count <= 0) return text
  return text.trim() === '' ? imagesNote(count) : `${text}\n\n${imagesNote(count)}`
}

/** The message with its images replaced by the note; any other message is returned as it is. */
export function withoutImages(message: ChatMessage): ChatMessage {
  if (message.role !== 'user' || !message.images?.length) return message
  return { role: 'user', content: withImagesNote(message.content, message.images.length) }
}
