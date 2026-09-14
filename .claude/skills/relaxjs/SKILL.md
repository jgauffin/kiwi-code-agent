---
name: relaxjs
description: Core model for writing UI with @relax.js/core (Relaxjs) - plain custom elements, no virtual DOM, no reactive state, no component base class. Use when writing or changing components, templates, forms, routing, services or tests in a project that depends on @relax.js/core, and when a Relaxjs page renders blank or a value never updates.
---
<!-- @relax.js/core 1.8.0 -->

# Relaxjs

Relaxjs has no virtual DOM, no reactive state and no component base class. Patterns carried over
from React compile, type-check and do nothing. That is the failure mode to guard against.

## The model

Components are plain custom elements: extend `HTMLElement`, use the native lifecycle, register
with `customElements.define`. There is no base class and no decorator that registers a component.

`connectedCallback` is synchronous. Kick off async loading from it, do not mark it `async` and
expect the browser to wait.

Nothing re-renders on its own. When data changes, update the DOM at that point.

A component owns its own logic and state. Parents pass data in, not behavior. Siblings talk
through a shared parent or a broker, never through delegates threaded down the tree.

Failures are reported, not thrown. A template that cannot resolve an expression renders empty and
reports. Reported errors collect in `window.relaxErrors` and print with
`window.relaxDebug = { errors: true }`; in a test, `captureRelaxErrors()` turns them into
assertions.

## Where to go

- **relaxjs-templates**: `compileTemplate` and `html`, loops, conditionals, pipes, `r-<event>`
  handlers, and why a `render()` sometimes changes nothing
- **relaxjs-forms**: `FormValidator`, `readData`/`setFormData`, form-associated custom elements
- **relaxjs-routing**: routes, `<r-route-target>`, route parameters, targets that never render
- **relaxjs-services**: dependency injection and the HTTP, WebSocket and SSE clients
- **relaxjs-testing**: `mount()`, `flush()`, `captureRelaxErrors()`, and the debug traces
- **relaxjs-setup**: startup order in `main.ts`, i18n loading, build configuration

## Events

Create an explicit class extending `Event`, put the data on it as properties, and register it in
`HTMLElementEventMap` so `addEventListener` infers the type. Do not use `CustomEvent`.

```typescript
export class IssueSelectedEvent extends Event {
    static readonly type = 'issue-selected';

    constructor(public readonly issueId: string) {
        super(IssueSelectedEvent.type, { bubbles: true });
    }
}

declare global {
    interface HTMLElementEventMap {
        [IssueSelectedEvent.type]: IssueSelectedEvent;
    }
}
```

## Do not

- Reach for a state store, computed properties or a reactive wrapper. Update the DOM where the
  change happens.
- Add a component base class, a render loop or a diffing layer.
- Use `CustomEvent`, or `enum` where a `declare type` string union works.
- Duplicate native HTML. Use `<dialog>`, `<details>`, `<input type="date">` and friends before
  writing a component.
- Swallow errors. An empty `catch` is a bug.

Full documentation: `node_modules/@relax.js/core/docs/GettingStarted.md`
