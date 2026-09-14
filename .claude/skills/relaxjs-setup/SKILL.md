---
name: relaxjs-setup
description: Starting and building a @relax.js/core application - the order of main.ts, i18n catalogue registration and locale loading, project structure, Vite and decorator configuration, and deployment. Use when creating a Relaxjs project, editing main.ts or index.html, adding translations, configuring the build, or when an injected service is undefined at startup, t() returns the key unchanged, or the app renders nothing on first load.
---
<!-- @relax.js/core 1.8.0 -->

# Starting a Relaxjs app

Three subsystems have to start in order: dependency injection, i18n, then routing. Getting it
wrong produces undefined services and untranslated text, and neither one reports a cause.

```typescript
// 1. Services first. @ContainerService registers as an import side effect.
import './services/ApiClient';
import './services/UserService';

// 2. Components. Each file ends in customElements.define(...)
import './components/HomePage';

async function bootstrap() {
    // 3. i18n before anything calls t()
    await setLocale(navigator.language || 'en');
    await loadNamespaces(['r-validation']);

    // 4. Routing last. This is when components start mounting.
    defineRoutes(routes);
    startRouting();
}

bootstrap();
```

A custom element is constructed the moment its tag is defined **and** the tag is in the DOM. If a
component import runs before a service import, and that component's tag sits in `index.html`, its
`@Inject` fields resolve to `undefined`.

## index.html holds the target, not the page

```html
<body>
    <r-route-target></r-route-target>
    <script type="module" src="/src/main.ts"></script>
</body>
```

Page components are created by the router after `startRouting()`, so they never construct before
setup finished. Without routing, append the root component from `bootstrap()` after the awaits
rather than writing its tag into `index.html`.

## t() returning the key

Either the namespace was not loaded, or something rendered before `setLocale()` resolved. Await
both, and re-render on `localechange` if the user can switch locale.

`registerCatalogue()` must run in your own code and before `setLocale()`. A bundler resolves an
import path relative to the file it is written in, so a glob written inside Relaxjs could only
ever see the library's own translations. Built-in namespaces you may need: `r-validation` for
validation messages, `r-pipes` for the locale-aware pipes.

## Build

Decorators need the right TypeScript and Vite configuration, and Vitest inherits it from Vite.
Everything in `import.meta.env` ends up in the public bundle, so no secrets there.

Organize `src/` by feature. Avoid a `utils/` dump folder: a helper shared by two features moves to
`src/shared/` with a clear filename.

## Detail

- `node_modules/@relax.js/core/docs/setup/bootstrapping.md` for the startup order and its failure modes
- `node_modules/@relax.js/core/docs/setup/vite.md` for the Vite and decorator configuration
- `node_modules/@relax.js/core/docs/setup/project-structure.md` for folder layout
- `node_modules/@relax.js/core/docs/setup/build-and-deploy.md` for base paths, environment and deployment
- `node_modules/@relax.js/core/docs/i18n/i18n.md` for catalogues, namespaces and ICU messages
- `node_modules/@relax.js/core/docs/GettingStarted.md` for a first app end to end
