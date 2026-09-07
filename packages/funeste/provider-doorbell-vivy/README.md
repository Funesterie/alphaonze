# @funeste/provider-doorbell-vivy

Private Funesterie adapter for `@nossen/provider-doorbell`.

It converts already-created Vivy LLM bundles into cheap authenticated availability probes without exporting provider credentials. Local Ollama is probed through `/api/tags`; authenticated SDK clients use `models.countTokens` when available (including Vertex/Gemini clients), then fall back to authenticated `models.list` metadata probes. Providers without a safe cheap authenticated probe remain `unknown` and stay eligible.

The Vertex/Gemini path deliberately does not perform an anonymous HTTP GET against the publisher-model endpoint and does not generate completion output during preflight. The caller owns creation of the authenticated SDK client through its existing credential mechanism.

The adapter can emit the secret-free event `vivy.provider-doorbell.checked` through an injected HORN `scream` function/object.

It does not own BLOOP, ScentGate, retry policy, Google Cloud credential provisioning, billing decisions or job persistence.
