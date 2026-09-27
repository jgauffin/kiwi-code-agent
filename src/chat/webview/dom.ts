/** An element with its class and, when given, its text. */
export function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
