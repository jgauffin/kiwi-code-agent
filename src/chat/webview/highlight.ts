import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

// Only the languages that show up in agent replies are bundled; the full set
// would dwarf the rest of the webview. An unregistered language renders as plain text.
const languages: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin,
  markdown, powershell, python, rust, scss, shell, sql, typescript, xml, yaml,
}
for (const [name, grammar] of Object.entries(languages)) hljs.registerLanguage(name, grammar)
// File extensions highlight.js has no alias for.
hljs.registerAliases(['xaml', 'csproj', 'props', 'targets', 'xsd', 'vsixmanifest'], { languageName: 'xml' })
hljs.registerAliases(['cmd', 'bat'], { languageName: 'shell' })

export type Highlighted = { html: string; highlighted: boolean }

/** HTML for code: token spans when the language is known, escaped text otherwise. */
export function highlightCode(text: string, lang: string | undefined): Highlighted {
  const language = lang ? hljs.getLanguage(lang) : undefined
  if (!language) return { html: escapeHtml(text), highlighted: false }
  return { html: hljs.highlight(text, { language: lang!, ignoreIllegals: true }).value, highlighted: true }
}

/** Fills the element with the colored code, or with plain text when the language is unknown. */
export function fillCode(target: HTMLElement, text: string, lang: string | undefined): void {
  const { html, highlighted } = highlightCode(text, lang)
  if (!highlighted) {
    target.textContent = text
    return
  }
  target.innerHTML = html
  target.classList.add('hljs')
}

/** The language a file is written in, judged by its name; undefined when none is bundled for it. */
export function languageForPath(path: string): string | undefined {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1).toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  const dot = name.lastIndexOf('.')
  if (dot < 0) return undefined
  const extension = name.slice(dot + 1)
  return hljs.getLanguage(extension) ? extension : undefined
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
