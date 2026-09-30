/** Markdown the extension ships as a file is bundled as its text where a prompt needs it too. */
declare module '*.md' {
  const text: string
  export default text
}
