import * as vscode from 'vscode'
import { fontSizeStyle } from './webview-font-size'

/** The page every KiwiAgent webview loads: one bundle, the root element naming the app that runs. */
export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, rootElement: string): string {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'))
  const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.css'))
  const size = fontSizeStyle(vscode.workspace.getConfiguration('kiwiAgent').get<number>('fontSize', 0))
  const nonce = crypto.randomUUID().replace(/-/g, '')
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} data:; font-src ${webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
${size}
<title>KiwiAgent</title>
</head>
<body>
<${rootElement}></${rootElement}>
<script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`
}
