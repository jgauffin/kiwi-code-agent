import { readFile } from 'node:fs/promises'
import { deflateRawSync } from 'node:zlib'
import ts from 'typescript'

// The release bundle carries the prompts as compressed text, decoded the first
// time each is used, so they are not read off dist/extension.js with a glance
// or a grep. It hides nothing from anyone determined: the decoder ships too.

/** Static text shorter than this stays as written: keys and short labels, not prompts. */
const MIN_LENGTH = 40

/** Defines `__kp` at the top of the bundle; every sealed string calls it. */
export const SEAL_DECODER =
  'var __kp=(()=>{const z=require("zlib"),m=new Map;return s=>{let t=m.get(s);if(t===void 0){t=z.inflateRawSync(Buffer.from(s,"base64")).toString("utf8");m.set(s,t)}return t}})();'

export function encode(text) {
  return deflateRawSync(Buffer.from(text, 'utf8')).toString('base64')
}

/** The esbuild plugin: the extension's own TypeScript and the markdown it embeds, sealed on load. */
export function sealStrings() {
  return {
    name: 'seal-strings',
    setup(build) {
      build.onLoad({ filter: /[\\/]src[\\/].*\.ts$/ }, async (args) => {
        if (args.path.endsWith('.d.ts')) return undefined
        const source = await readFile(args.path, 'utf8')
        return { contents: sealSource(source, args.path), loader: 'js' }
      })
      build.onLoad({ filter: /\.md$/ }, async (args) => {
        const text = await readFile(args.path, 'utf8')
        return { contents: `export default __kp(${JSON.stringify(encode(text))})`, loader: 'js' }
      })
    },
  }
}

/** One TypeScript file as JavaScript, its long strings and templates sealed. */
export function sealSource(source, fileName) {
  const out = ts.transpileModule(source, {
    fileName,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, isolatedModules: true, sourceMap: false },
    transformers: { before: [sealTransformer] },
  })
  return out.outputText
}

function sealTransformer(context) {
  const f = context.factory
  const sealed = (text) => f.createCallExpression(f.createIdentifier('__kp'), undefined, [f.createStringLiteral(encode(text))])

  const visit = (node) => {
    // Types are erased anyway, and module specifiers and names must stay literal.
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return node
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExternalModuleReference(node)) return node
    if (ts.isTaggedTemplateExpression(node)) return node
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.length >= MIN_LENGTH && !isName(node)) {
      return sealed(node.text)
    }
    if (ts.isTemplateExpression(node) && staticLength(node) >= MIN_LENGTH) return sealTemplate(node)
    return ts.visitEachChild(node, visit, context)
  }

  // Every piece of static text becomes a call, the substitutions stay where they were:
  // still a template, so each value is turned into text exactly as before.
  const sealTemplate = (node) => {
    const parts = []
    if (node.head.text) parts.push(sealed(node.head.text))
    for (const span of node.templateSpans) {
      parts.push(ts.visitNode(span.expression, visit))
      if (span.literal.text) parts.push(sealed(span.literal.text))
    }
    const spans = parts.map((part, i) => f.createTemplateSpan(part, i === parts.length - 1 ? f.createTemplateTail('') : f.createTemplateMiddle('')))
    return f.createTemplateExpression(f.createTemplateHead(''), spans)
  }

  return (file) => ts.visitNode(file, visit)
}

/** A string standing as a property, method or enum member name, which a call cannot replace. */
function isName(node) {
  return node.parent !== undefined && 'name' in node.parent && node.parent.name === node
}

function staticLength(node) {
  return node.head.text.length + node.templateSpans.reduce((sum, span) => sum + span.literal.text.length, 0)
}
