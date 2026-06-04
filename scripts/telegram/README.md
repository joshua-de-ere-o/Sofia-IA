# Telegram maintenance scripts

Small scripts for checking or repairing Sofía's Telegram connection.

## What to use

| Script | What it does | Risk |
|--------|--------------|------|
| `diag.ps1` | Shows which Telegram bot is configured and whether the webhook is registered. | Safe: read-only. |
| `set-webhook.ps1` | Registers the production webhook: `https://sofia-ia-omega.vercel.app/api/telegram`. | Careful: modifies the real Telegram bot webhook. |

## Before running

1. Confirm `.env.local` has the intended `TELEGRAM_BOT_TOKEN`.
2. Run `diag.ps1` first.
3. Run `set-webhook.ps1` only when the webhook is missing or pointing to the wrong URL.

## Commands

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/telegram/diag.ps1
powershell -ExecutionPolicy Bypass -File ./scripts/telegram/set-webhook.ps1
```

Never commit local Telegram credentials. Keep them in `.env.local` or another ignored local-only file.
