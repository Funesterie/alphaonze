# verify-gamedev-mcp.ps1 - check Unity/Unreal "AI Game Developer" MCP servers are live with tools.
# Run AFTER editors restarted (or AI Game Developer panel -> Start) and Codex restarted.
$targets = [ordered]@{ "Unreal (FUNESTERIE)" = 28105; "Unity (My project)" = 28106 }
function Parse-SseJson($content, $id) {
  foreach ($blk in ($content -split "`r`n`r`n")) {
    $dl = ($blk -split "`r?`n" | Where-Object { $_ -like 'data:*' }) -replace '^data:\s*',''
    if ($dl) { try { $j = $dl | ConvertFrom-Json; if ($j.id -eq $id) { return $j } } catch {} }
  }
  return $null
}
function Post-Mcp($url, $obj, $sid) {
  $body = $obj | ConvertTo-Json -Compress
  $h = @{ Accept = 'application/json, text/event-stream' }
  if ($sid) { $h['Mcp-Session-Id'] = $sid }
  Invoke-WebRequest -Uri $url -Method Post -Body $body -ContentType 'application/json' -Headers $h -TimeoutSec 25 -UseBasicParsing
}
foreach ($name in $targets.Keys) {
  $port = $targets[$name]
  $url  = "http://127.0.0.1:$port/mcp"
  Write-Host ""
  Write-Host "===== $name  ->  $url =====" -ForegroundColor Cyan
  $listen = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listen) { Write-Host "  FAIL: no listener on :$port (editor not started or panel not Started)" -ForegroundColor Red; continue }
  $proc = Get-Process -Id $listen.OwningProcess -ErrorAction SilentlyContinue
  try {
    $r1 = Post-Mcp $url @{ jsonrpc='2.0'; id=1; method='initialize'; params=@{ protocolVersion='2024-11-05'; capabilities=@{}; clientInfo=@{ name='verify'; version='1.0' } } } $null
  } catch { Write-Host "  FAIL: initialize HTTP error: $($_.Exception.Message)" -ForegroundColor Red; continue }
  $sid = $r1.Headers['Mcp-Session-Id']
  $ij = Parse-SseJson $r1.Content 1
  if (-not $ij) { Write-Host "  FAIL: no initialize result (HTTP $($r1.StatusCode)). Raw: $($r1.Content.Substring(0,[Math]::Min(160,$r1.Content.Length)))" -ForegroundColor Red; continue }
  try { Post-Mcp $url @{ jsonrpc='2.0'; method='notifications/initialized' } $sid | Out-Null } catch {}
  try {
    $r2 = Post-Mcp $url @{ jsonrpc='2.0'; id=2; method='tools/list'; params=@{} } $sid
  } catch { Write-Host "  FAIL: tools/list HTTP error: $($_.Exception.Message)" -ForegroundColor Red; continue }
  $tj = Parse-SseJson $r2.Content 2
  $tools = if ($tj -and $tj.result.tools) { @($tj.result.tools) } else { @() }
  Write-Host ("  listener :{0}  PID={1} ({2})" -f $port, $listen.OwningProcess, $proc.ProcessName) -ForegroundColor Green
  Write-Host ("  server   : {0} {1}   session: {2}" -f $ij.result.serverInfo.name, $ij.result.serverInfo.version, $sid)
  if ($tools.Count -gt 0) {
    Write-Host ("  tools    : {0}" -f $tools.Count) -ForegroundColor Green
    $tools | Select-Object -First 20 | ForEach-Object { Write-Host "    - $($_.name)" }
  } else {
    Write-Host "  tools    : 0  (bridge not connected -> open AI Game Developer panel, set Host=http://localhost:$port Transport=HTTP Mode=Custom, click Start)" -ForegroundColor Yellow
  }
}