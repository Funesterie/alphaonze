def resolve_bind_host(env=None, default="127.0.0.1"):
    source = env or {}

    tts_host = str(source.get("TTS_HOST", "") or "").strip()
    if tts_host:
        return tts_host

    generic_host = str(source.get("HOST", "") or "").strip()
    if generic_host:
        return generic_host

    return default
