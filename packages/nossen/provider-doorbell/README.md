# @nossen/provider-doorbell

Bounded, parallel and fail-open provider preflight for LLM and workflow routing.

The doorbell answers one narrow question before an expensive request: **is a provider definitely unavailable right now?**

It does not replace retries, health checks, job queues or circuit breakers. It is deliberately conservative:

- `available`: a cheap probe returned a usable HTTP response;
- `unavailable`: the provider explicitly refused the lane (`401`, `402`, `403`, `404`, `409`, `423`, `429`);
- `unknown`: timeout, `5xx`, unsupported probe route or inconclusive network result.

`unknown` is kept in the candidate list. This prevents the preflight from becoming a new single point of failure.

## Usage

```js
const { ringProviders, filterProvidersByDoorbell } = require('@nossen/provider-doorbell');

const providers = [
  { provider: 'openai-compatible', baseURL: 'http://127.0.0.1:8080/v1', model: 'local-model' },
  { provider: 'cloud-a', baseURL: 'https://provider.example/v1', apiKey: process.env.PROVIDER_KEY },
];

const report = await ringProviders(providers, { timeoutMs: 1200 });
const candidates = filterProvidersByDoorbell(providers, report);
```

## Custom probes

A provider can provide its own cheap probe without changing the generic core:

```js
{
  provider: 'ollama',
  baseURL: 'http://127.0.0.1:11434',
  probe: async (provider, options) => {
    const response = await fetch(`${provider.baseURL}/api/tags`, {
      signal: AbortSignal.timeout(options.timeoutMs || 1200),
    });
    return response.ok
      ? { state: 'available', reason: `http_${response.status}` }
      : { state: 'unknown', reason: `http_${response.status}` };
  }
}
```

## Design rules

- Ring providers concurrently, never serially.
- Keep the probe cheaper and shorter than the real request.
- Never send a real generation request as a probe.
- Never log or return credentials.
- Only skip a provider on a definite negative signal.
- Keep long-running work asynchronous: accept the request, return a job identifier, then signal completion through the caller's workflow/event layer.

The package contains no Funesterie endpoint, credential, private topology or provider-specific policy. Those belong in private adapters.
