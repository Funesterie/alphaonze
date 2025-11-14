param(
  [string]$TargetPath = "C:\Users\cella\AppData\Roaming\GitHub Desktop\settings.json",
  [string]$NodeExePath = "node",
  [string]$ServerScriptPath = "D:\a11-mcp-server\index.js"
)

# Ensure directory exists
$dir = Split-Path -Path $TargetPath -Parent
if (-not (Test-Path -Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

# Backup existing file if present
if (Test-Path -Path $TargetPath) {
    $ts = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $bak = "$TargetPath.bak.$ts"
    Copy-Item -Path $TargetPath -Destination $bak -Force
    Write-Output "Backed up existing settings to: $bak"
}

# Default mcpServers block to merge
$newBlock = @{
    mcpServers = @{
        a11 = @{
            command = $NodeExePath
            args = @($ServerScriptPath)
        }
    }
}

# Read existing JSON or create base
if (Test-Path -Path $TargetPath) {
    try {
        $existingText = Get-Content -Raw -Path $TargetPath -ErrorAction Stop
        if ($existingText.Trim().Length -eq 0) {
            $existing = @{}
        } else {
            $existing = $existingText | ConvertFrom-Json -ErrorAction Stop
        }
    } catch {
        Write-Warning "Failed to parse existing settings.json — creating new one. Error: $_"
        $existing = @{}
    }
} else {
    $existing = @{}
}

# Ensure hashtables for merging
if (-not $existing.PSObject.Properties.Name -contains 'mcpServers') {
    $existing | Add-Member -MemberType NoteProperty -Name mcpServers -Value (@{})
}

# Merge/overwrite the a11 entry
$existing.mcpServers | Add-Member -MemberType NoteProperty -Name a11 -Value $newBlock.mcpServers.a11 -Force

# Serialize and write
try {
    $json = $existing | ConvertTo-Json -Depth 10
    Set-Content -Path $TargetPath -Value $json -Encoding UTF8
    Write-Output "Wrote settings to: $TargetPath"
} catch {
    Write-Error "Failed to write settings.json: $_"
    exit 1
}

Write-Output "Done. Restart GitHub Desktop / Copilot Desktop to pick up the new MCP server."
exit 0