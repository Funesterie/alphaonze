# @funeste/provider-doorbell-vivy

Private Funesterie adapter for `@nossen/provider-doorbell`.

It converts already-created Vivy LLM bundles into cheap authenticated availability probes without exporting provider credentials. Local Ollama is probed through `/api/tags`; OpenAI-compatible SDK clients use their authenticated `models.list` method when available; providers without a safe cheap metadata call remain `unknown` and stay eligible.

The adapter can emit the secret-free event `vivy.provider-doorbell.checked` through an injected HORN `scream` function/object.

It does not own BLOOP, ScentGate, retry policy or job persistence.
