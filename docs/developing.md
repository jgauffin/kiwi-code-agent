# Developing

```
npm install
npm test          # no network or engine needed
npm run build     # dist/: extension, webview, cli.mjs, ripgrep
```

F5 launches the Extension Development Host. Open the "KiwiAgent" view in the activity bar.

## Use the working copy as the installed extension

Load the extension from this repo in your normal VS Code instead of a packaged copy:

```
npm run link-dev   # installs the .vsix so VS Code registers it, then points the installed folder at this repo
```

Reload the window once. From then on, after `npm run build` (or the `npm: watch` task) the extension notices its own bundle changed and offers "Reload Window". Sessions and the open session survive the reload; engines resume on the next prompt. `npm run unlink-dev` removes the link.

## Package

```
npm run package   # kiwi-agent-<version>.vsix
```
