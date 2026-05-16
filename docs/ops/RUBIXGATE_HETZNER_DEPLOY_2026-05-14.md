# RubixGate Hetzner deploy - 2026-05-14

RubixGate worker is installed and running on the two Hetzner machines.

No bearer token, OAuth secret, or operator passphrase is stored in these services.
The daemon only scans capsules, keeps health state, expires activations, and writes audit events.
Decryption/activation requires a one-shot `RUBIXGATE_PASSPHRASE` provided by an operator at activation time.

## Servers

### alphaonze-rhdh-01

- SSH target: `root@178.105.86.89`
- Install path: `/opt/funesterie/rubixgate/bin/rubixgate_worker.py`
- Root: `/var/lib/funesterie/rubixgate`
- Audit: `/var/log/funesterie/rubixgate-audit.jsonl`
- Health: `http://127.0.0.1:8791/health`
- Autostart: `systemd` service `rubixgate.service`
- Verified: service active and enabled.

### a11-prod-finland-2

- SSH target: `deploy@62.238.43.32`
- Install path: `/home/deploy/rubixgate/bin/rubixgate_worker.py`
- Root: `/home/deploy/.local/share/funesterie/rubixgate`
- Audit: `/home/deploy/.local/state/funesterie/rubixgate-audit.jsonl`
- Health: `http://127.0.0.1:8791/health`
- Autostart: deploy user crontab `@reboot /home/deploy/rubixgate/rubixgate-start-user.sh`
- Verified: worker running and health OK.

## Operations

Health check:

```bash
curl -fsS http://127.0.0.1:8791/health
```

Manual scan:

```bash
python3 /opt/funesterie/rubixgate/bin/rubixgate_worker.py scan
```

or on `a11-prod-finland-2`:

```bash
python3 /home/deploy/rubixgate/bin/rubixgate_worker.py scan
```

Activation pattern:

```bash
RUBIXGATE_PASSPHRASE='operator-provided-at-runtime' \
  python3 /path/to/rubixgate_worker.py activate /path/to/capsule.capsule.json
```

Never persist the passphrase in `.env`, shell history, crontab, service files, logs, or shared folders.
