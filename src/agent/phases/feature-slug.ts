/** The file name a feature's spec and working files go by. Free of imports, since the webview bundle reaches it too. */
export function featureSlug(feature: string): string {
  return (
    feature
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'feature'
  )
}
