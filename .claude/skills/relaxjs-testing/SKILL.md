---
name: relaxjs-testing
description: Testing and debugging components built on @relax.js/core - mount(), flush() and captureRelaxErrors() from @relax.js/core/testing, the onError channel and the window.relaxDebug traces. Use when writing a test for a Relaxjs component or template, when a test sees an empty element or an element that never initialised, or when diagnosing a page that renders nothing without reporting an error.
---
<!-- @relax.js/core 1.8.0 -->

# Testing and debugging Relaxjs

Import the helpers from `@relax.js/core/testing`. They exist because the failures that matter here
are asynchronous or quiet. Nothing from this module belongs in application code.

## An element must be mounted to live

`document.createElement` alone never runs `connectedCallback`, so a component tested that way
looks inert for reasons that have nothing to do with the component.

```typescript
const { element, unmount } = mount<UserProfile>('user-profile');
await flush();
```

`flush()` waits for pending microtasks and the next macrotask. Lifecycle callbacks are
synchronous, but anything they `await` is not, so asserting straight after `mount()` sees the
element before its data arrived. `unmount()` is how you test `disconnectedCallback`.

## Capture the errors or the test proves nothing

Template failures are reported, not thrown. `{{user.naem}}` renders an empty string, so a test
that only checks the DOM sees a blank element and no reason for it.

```typescript
const captured = captureRelaxErrors();
try {
    render({ user: { name: 'Alice' } });
    expect(captured.messages()).toEqual([]);
} finally {
    captured.restore();
}
```

Errors are suppressed while the capture is installed, so rendering continues and the assertion is
reached. `restore()` puts the previous handler back, so call it in a `finally` or an `afterEach`.
Assert on `captured.messages()` even in tests that are about something else: it is what turns a
typo into a failure instead of a mystery.

Reset module-level state in `beforeEach`.

## Debugging a running app

Traces are off by default, turned on per area, and shipped in the production build on purpose,
because routing and template problems surface in deployed apps.

```javascript
window.relaxDebug = { routing: true };
```

`routing` covers registration, layout resolution, every navigation, targets connecting and
disconnecting, and navigations that could not be delivered. `templates` covers expressions that
could not be resolved. `errors` prints the whole error channel. Turn on one area at a time.

Every reported error collects in `window.relaxErrors` whether a handler is registered or not, and
the first unhandled one prints a single line naming that array. Read it after a failure instead of
reproducing the failure with a flag on.

Traces are not the error channel. If something failed, start with the error context. Reach for
traces when nothing failed and nothing happened either.

## Detail

- `node_modules/@relax.js/core/docs/testing.md` for the helpers
- `node_modules/@relax.js/core/docs/Debugging.md` for which flag answers which symptom
- `node_modules/@relax.js/core/docs/Errors.md` for `onError()` and `RelaxError` in application code
