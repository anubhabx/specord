# `specord serve`

`specord serve` starts a local documentation server for the generated OpenAPI document.

Use this when you want to view docs independently of the Nest app bootstrap. The preferred in-app integration is `setupSpecordDocs()` from `@specord/nestjs`.

## Command

```bash
specord serve [project-dir] [--host 127.0.0.1] [--port 4777] [--pretty] [--no-cache]
```

Repo-local form:

```bash
pnpm.cmd serve -- examples/nestjs-api --pretty
```

Routes:

| Route | Purpose |
| --- | --- |
| `/` | Redirects to `/api` |
| `/api` | Local API docs workspace |
| `/api/openapi.json` | OpenAPI 3.1 JSON |
| `/health` | Server health JSON |

## Override Routes

```bash
specord serve apps/api --docs-path /reference --json-path /reference/spec.json
```

## Caching

The OpenAPI document is cached after the first successful JSON request so repeated docs refreshes do not rebuild the TypeScript program. Use `--no-cache` when you want every request to re-read source during debugging:

```bash
specord serve apps/api --no-cache
```

## Local Binding

The server binds to `127.0.0.1` by default. Non-loopback hosts such as `0.0.0.0` are refused unless you pass `--allow-public-host` intentionally:

```bash
specord serve apps/api --host 0.0.0.0 --allow-public-host
```

## Start A Nest Dev Process Beside Docs

```bash
specord serve apps/api --app-command "pnpm start:dev" --app-url http://localhost:3000
```

`--app-command` is a convenience process runner. It does not change how the OpenAPI document is produced.

## Try It

The docs UI includes a browser-local Try it panel. Because `specord serve` is a standalone docs server and does not proxy API traffic, Try it needs a target API base URL from either `--app-url` or `document.servers[0].url`.

The panel does not persist credentials, proxy requests, or bypass browser CORS rules. Header fields are sent only when the OpenAPI operation exposes header parameters.
