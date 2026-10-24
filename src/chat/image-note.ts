/** How a prompt that carried images says so where its text would be: the session's title, a paired phone's list. */
export function imageCountNote(count: number): string {
  return count === 1 ? '1 image' : `${count} images`
}

/** What stands in for the words of a prompt that has none but images; nothing when it has words or no images. */
export function imageOnlyLabel(text: string, imageCount: number): string | undefined {
  return text.trim() === '' && imageCount > 0 ? imageCountNote(imageCount) : undefined
}
