---
name: relaxjs-services
description: Services and network access with @relax.js/core - the DI container (@ContainerService, @Inject, serviceCollection) and the HTTP, WebSocket and SSE clients. Use when adding a service, injecting one into a component, calling a REST API, streaming server events, or when an injected field is undefined, a service fails to resolve, or a failed request does not throw.
---
<!-- @relax.js/core 1.8.0 -->

# Relaxjs services

## Dependency injection

Dependencies are declared explicitly. There is no metadata reflection, so the `inject` list is the
wiring, and its order is the constructor's parameter order.

```typescript
@ContainerService({ inject: [ConfigService] })
class ApiClient {
    constructor(private config: ConfigService) {}
}
```

**Never put `@ContainerService` on a web component.** The browser constructs custom elements with
zero arguments. Components use property injection instead, and the field is resolved by the time
`connectedCallback` runs:

```typescript
class UserPanel extends HTMLElement {
    @Inject(UserService)
    private userService!: UserService;
}
```

An injected field that is `undefined` means the component was constructed before the service was
registered. Services register as a side effect of being imported, so in `main.ts` service imports
come before component imports. See the **relaxjs-setup** skill.

Use `serviceCollection.register()` for things you cannot decorate, such as a config object or a
third-party client, and register those before anything else runs.

Resolution failures go through `onError` and carry the requested name plus every registered class
and key, which is normally enough to spot the missing import.

## HTTP

`get`, `post`, `put`, `del` and `request` are standalone functions returning `HttpResponse`. The
delete function is `del`, because `delete` is reserved.

**A failed request does not throw.** Check `response.success` yourself:

```typescript
const response = await put(`/users/${id}`, JSON.stringify(profile));
if (!response.success) {
    this.validator.addErrorToSummary('Save', response.statusReason);
}
```

`response.as<T>()` casts the parsed body and throws on an error response, so calling it without
checking `success` first turns a handled 400 into an exception. A 204 gives a `null` body.

`configure({ baseUrl, timeout, bearerTokenName })` runs once at startup. The bearer token is read
from `localStorage` unless disabled. `setFetch()` replaces fetch in tests.

## Streaming

`WebSocketClient` for bidirectional messaging: it reconnects with backoff and queues sends while
disconnected, so a send does not fail just because the socket is down. `receive()` rejects when
the connection closes.

`SSEClient` for server push, and for sending a request and streaming the answer back with `method`
and `body`. It dispatches SSE events as DOM events on `document` by default, so you listen with
`addEventListener`, not with a callback per message. `onClose` reports why a stream ended, which
is how you tell a finished result from a truncated one.

## Detail

- `node_modules/@relax.js/core/docs/DependencyInjection.md` for scopes, property injection and error context
- `node_modules/@relax.js/core/docs/http/HttpClient.md` for requests, timeouts, JWT and the WebSocket client
- `node_modules/@relax.js/core/docs/http/ServerSentEvents.md` for SSE, terminal events and close reasons
