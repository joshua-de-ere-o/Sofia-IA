# Read-only diagnostic for the Telegram bot. Does NOT modify anything.
# Reads TELEGRAM_BOT_TOKEN from .env.local and calls getMe + getWebhookInfo.
# Usage:  ! powershell -ExecutionPolicy Bypass -File ./scripts/telegram/diag.ps1

$ErrorActionPreference = 'Stop'

function Get-EnvValue($name) {
  $line = Get-Content '.env.local' | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
  if (-not $line) { throw "Missing $name in .env.local" }
  return ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
}

$token  = Get-EnvValue 'TELEGRAM_BOT_TOKEN'
$chatId = Get-EnvValue 'TELEGRAM_CHAT_ID'

Write-Host "=== getMe (which bot) ==="
$me = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getMe"
Write-Host ("Bot: @" + $me.result.username + "  (" + $me.result.first_name + ")  id=" + $me.result.id)

Write-Host ""
Write-Host "=== getWebhookInfo (inbound Kely -> Sofia) ==="
$wh = Invoke-RestMethod -Uri "https://api.telegram.org/bot$token/getWebhookInfo"
$url = $wh.result.url
if ([string]::IsNullOrEmpty($url)) {
  Write-Host "WEBHOOK NOT REGISTERED - inbound from Kely does NOT work. Need setWebhook."
} else {
  Write-Host ("Webhook URL: " + $url)
  Write-Host ("Pending updates: " + $wh.result.pending_update_count)
  if ($wh.result.last_error_message) {
    Write-Host ("Last error: " + $wh.result.last_error_date + " -> " + $wh.result.last_error_message)
  }
}

Write-Host ""
Write-Host "=== configured chat_id ==="
Write-Host ("TELEGRAM_CHAT_ID = " + $chatId)
