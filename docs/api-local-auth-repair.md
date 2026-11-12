# Local API authentication repair

The API previously returned503 because API_TOKEN was absent. The bearer-token guard remains fail closed: missing configuration503; configured token but absent/wrong request token401; valid Bearer or X-API-Token permits authenticated routes.

The listener now defaults to127.0.0.1 and accepts only explicit loopback hosts (127.0.0.1, ::1, localhost). Do not enable a missing token while retaining a public0.0.0.0 listener. A new external client, proxy or public exposure is a separate configuration decision, not part of this repair. Existing metrics and signed-webhook route guards are unchanged; neither gains a new public route.

Operational order: verify existing consumers/routes; save previous config/source privately; switch API listener to loopback and restart only jarvis-api before applying token; verify503 remains closed and listener is local; then save generated API_TOKEN via the vault into private configuration and the API process environment; restart only API; verify local /api/salud200 with credentials and401 without/wrong credentials. Do not print tokens or include them in source, URLs or receipts. Preserve WhatsApp PID/Redis connections/flags. Do not call the model/chat endpoint as a health probe.

When applied, the token must be in the vault and a mode0600 server secret file, plus the API process environment and mode0600 PM2 persistence. Existing shared environment file need not distribute it to WhatsApp. No existing token is silently rotated. No dashboard, tunnel, external watchdog or third-party access is activated by this repair.
