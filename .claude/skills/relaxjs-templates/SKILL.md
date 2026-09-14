---
name: relaxjs-templates
description: Rendering HTML with @relax.js/core - compileTemplate, the html tagged literal, loops, if/unless, pipes and r-<event> handlers. Use when building or fixing the markup a Relaxjs component renders, when a value renders empty or stale, when render() appears to do nothing, when a second html`` instance never appears, or when a click handler in a template never fires.
---
<!-- @relax.js/core 1.8.0 -->

# Relaxjs templates

Two engines. `compileTemplate` handles structure: nested paths, `loop`, `if`/`unless`, pipes and
`r-<event>` handlers. `html` is a tagged literal for one block of flat values with none of that.
Do not carry syntax across from one to the other.

Both update in place, and both fail quietly.

## Nothing throws, so read the errors

A mistyped path, a function that was never passed, an unknown event name, a render that changed
nothing: each renders empty or does nothing, and reports. In a test `captureRelaxErrors()` turns
that into an assertion, and every message says what to do instead. A blank element is almost always
a spelling mistake, not a data problem.

`render()` compares the context by identity, so pass a new object when data changes
(`render({ ...state })`) rather than mutating the one you passed last time.

## Rendering once is not inert

Handlers wired by the first `render()` stay live for the life of the element, through loops that
add and remove rows. A template rendered exactly once is fully interactive.

Later renders may omit the functions context: `render(newData)` keeps the previous one, and
`render(newData, null)` drops it deliberately.

## r-<event> handlers

The value must be a call expression: `r-click="save()"` binds, `r-click="save"` does not. The
function is looked up in the functions context, the second argument to `render()`, so a misspelled
function name only surfaces when the event fires.

Return `false` from the handler to `preventDefault()`. An `async` handler returns a promise and
can never do that, so take the event and cancel it before the first `await`:

```html
<form r-submit="save(event)">
```

Only real DOM events work. The name is checked against `on<event>`, so a component's own
`PageSelectedEvent` has no `onpageselected` and `r-pageselected` is rejected. Use
`addEventListener` for custom events. Binding to an element that never fires the event
(`r-submit` on a `<div>`) binds and stays silent.

Every attribute starting with `r-` is treated as an event binding and stripped from the output,
valid or not.

For a real form prefer `FormValidator` over `r-submit`. See the **relaxjs-forms** skill.

## html gives one instance per tagged literal

`html\`...\`` returns a bind function. Calling it produces the instance; calling `update()` on that
instance changes its values. Binding twice re-drives the first instance instead of adding a second,
so evaluate the tagged literal again per instance, or use `compileTemplate` with `loop`.

## Detail

- `node_modules/@relax.js/core/docs/html/template.md` for `compileTemplate`, loops, conditionals, attribute
  and boolean binding, and the full event syntax
- `node_modules/@relax.js/core/docs/html/html.md` for the tagged literal
- `node_modules/@relax.js/core/docs/Pipes.md` for the built-in pipes and custom registries
- `node_modules/@relax.js/core/docs/html/TableRenderer.md` for data tables
