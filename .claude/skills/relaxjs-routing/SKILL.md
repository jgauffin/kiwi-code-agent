---
name: relaxjs-routing
description: Client-side routing with @relax.js/core - defineRoutes, startRouting, navigate, <r-route-target>, <r-link>, route parameters, guards and layouts. Use when adding or changing routes, passing parameters into a page component, rendering into a sidebar or modal target, wiring back/forward navigation, or when a route renders a blank page, no route matches a URL, or route data is undefined in a component.
---
<!-- @relax.js/core 1.8.0 -->

# Relaxjs routing

The router matches URLs and dispatches a navigation event. It does not render. `<r-route-target>`
listens and renders. Both halves have to be present.

```typescript
defineRoutes(routes);   // always first
startRouting();         // last thing in bootstrap
```

`startRouting()` before `defineRoutes()` renders a blank page.

The route's component must already be registered with `customElements.define`, or navigation
fails with `RouteError: CustomElement has not been registered`.

## Path parameters

`:name` is a string segment, `;name` is a number segment that must be all digits and arrives as a
`number`. Query string values are merged into route parameters. The fragment is not, because it
has no name: read it from `NavigateRouteEvent.fragment`, and note that the router rewrites the
address bar once routing settles, so a reload will not see it again.

## Receiving parameters

`loadRoute(data)` runs before the element is added to the DOM, so it is the place for async
loading. If the route carries no parameters there is nothing to pass, and the router warns and
passes `{ r_error: '...' }` instead. Either give the route parameters or drop `loadRoute()` and
use `connectedCallback()`.

`routeData` is assigned after construction, so it is undefined in the constructor and available in
`connectedCallback`. Both can be combined: `loadRoute()` runs first.

## Nothing rendered

A navigation aimed at a target that is not connected is parked and replayed when a matching target
appears, so a slow target still works. One that never appears is reported as an error naming the
target asked for and the targets that exist.

For a route that matched nothing, `window.relaxDebug = { routing: true }` lists every route tried
with its segment count next to the URL's, which separates "wrong number of segments" from "wrong
value". `printRoutes()` dumps the table at any time.

## Targets

Routes without a `target` render in the unnamed `<r-route-target>`. A named target takes routes
with a matching `target`, or `navigate(name, { target })`.

`<r-route-target name="modal" dialog>` renders into a native `<dialog>`, which brings focus
trapping, a backdrop and Escape-to-close.

Each target owns its own back/forward history, keyed by name and restored when a target with that
name reconnects. `navigateBack('modal')` steps that target alone.

## index.html holds only the target

Page components are created by the router after `startRouting()`, which is what keeps them from
constructing before services and translations are ready. Writing a page component tag directly
into `index.html` breaks that. See the **relaxjs-setup** skill.

## Detail

- `node_modules/@relax.js/core/docs/routing/Routing.md` for routes, navigation, guards, events and matching
- `node_modules/@relax.js/core/docs/routing/RoutingTarget.md` for targets, dialogs and view transitions
- `node_modules/@relax.js/core/docs/routing/RouteLink.md` for `<r-link>` and its parameter attributes
- `node_modules/@relax.js/core/docs/routing/layouts.md` for multiple HTML shells
