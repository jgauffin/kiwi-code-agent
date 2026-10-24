import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { PromptImage } from '../session/code-session'

/** A prompt as the engine takes it: plain text, or the images first and the text after them. */
export function userMessage(text: string, images: PromptImage[]): SDKUserMessage {
  const content =
    images.length === 0
      ? text
      : [
          ...images.map((image) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.mediaType, data: image.data } })),
          ...(text ? [{ type: 'text' as const, text }] : []),
        ]
  return {
    type: 'user',
    // The SDK types the media type as the four formats it takes; the images were made one of them before they got here.
    message: { role: 'user', content } as SDKUserMessage['message'],
    parent_tool_use_id: null,
  }
}
