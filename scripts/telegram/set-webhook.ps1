# Registers the Telegram webhook on the bot so Kely's inbound messages reach the app.
# Reads TELEGRAM_BOT_TOKEN from .env.local. Points to the Vercel prod endpoint.
# Usage:  ! powershell -ExecutionPolicy Bypass -File ./scripts/telegram/set-webhook.ps1

$ErrorActionPreference = 'Stop'

$WEBHOOK_URL = 'https://sofia-ia-omega.vercel.app/api/telegram'

function Get-EnvValue($name) {
  $line = Get-Content '.env.local' | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
  if (-not $line) { throw "Missing $name in .env.local" }
  return ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
}

$token = Get-EnvValue 'TELEGRAM_BOT_TOKEN'

$body = @{
  url            = $WEBHOOK_URL
  allowed_updates = @('message', 'callback_query')
  drop_pending_updates = $true
} | ConvertTo-Json -Compress

Write-Host ("Setting webhook -> " + $WEBHOOK_URL)
$resp = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/setWebhook" `
  -ContentType 'application/json; charset=utf-8' `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($body))

if ($resp.ok) {
  Write-Host ("OK - " + $resp.description)
} else {
  Write-Host ("FAILED - " + ($resp | ConvertTo-Json -Compress))
}

Write-Host ""
Write-Host "=== verify ==="
$wh = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getWebhookInfo"
Write-Host ("Webhook URL now: " + $wh.result.url)
