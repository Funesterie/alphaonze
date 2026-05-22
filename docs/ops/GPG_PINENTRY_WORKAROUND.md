# GPG Pinentry Timeout Workaround

## Context

This workstation signs Git commits by default through the global Git setting
`commit.gpgsign = true`. When GPG has no passphrase cache configured, non-interactive
commit flows from an IDE, hook, script, or background agent can hang while waiting for
pinentry.

Observed local state on 2026-05-22:

- GPG is installed at `C:\Program Files\GnuPG\bin\gpg.exe`.
- `commit.gpgsign = true` is enabled globally.
- `C:\Users\Djeff\AppData\Roaming\gnupg\common.conf` contains `use-keyboxd`.
- `gpg-agent.conf` and `gpg.conf` were not present before this workaround.

## Interactive Workstation Mode

Use a longer passphrase cache so Git signing only asks once per day:

```conf
default-cache-ttl 86400
max-cache-ttl 86400
```

Reload the agent after changing the file:

```powershell
gpgconf --reload gpg-agent
```

## Non-Interactive IDE Or Hook Mode

Some IDEs, scripts, hooks, and agent processes do not handle GUI pinentry reliably.
For those flows, loopback pinentry allows GPG to receive the passphrase through the
calling process instead of waiting on a separate pinentry window.

`gpg-agent.conf`:

```conf
allow-loopback-pinentry
```

`gpg.conf`:

```conf
pinentry-mode loopback
```

Reload the agent after changing either file:

```powershell
gpgconf --reload gpg-agent
```

## Notes

- These files contain no secrets.
- Do not commit private keys, passphrases, exported secret keys, or `*.gpg` secret
  material into the repository.
- If interactive commit signing becomes less convenient, remove `pinentry-mode
  loopback` from `gpg.conf` and keep only the TTL settings in `gpg-agent.conf`.
