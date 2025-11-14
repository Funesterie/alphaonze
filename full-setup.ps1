# Full setup script for A11 MCP Server
# This script installs settings, installs dependencies, and starts the server

param(
  [string]$TargetPath = "C:\Users\cella\AppData\Roaming\GitHub Desktop\settings.json",
  [string]$NodeExePath = "node",
  [string]$ServerScriptPath = "$PSScriptRoot\index.js"
)

# Step 1: Run the install-settings script
Write-Output "Step 1: Installing MCP server in settings.json..."
& "$PSScriptRoot\install-settings.ps1" -TargetPath $TargetPath -NodeExePath $NodeExePath -ServerScriptPath $ServerScriptPath

if ($LASTEXITCODE -ne 0) {
  Write-Error "Failed to install settings. Aborting."
  exit 1
}

# Step 2: Install npm dependencies
Write-Output "Step 2: Installing npm dependencies..."
& npm install
if ($LASTEXITCODE -ne 0) {
  Write-Error "npm install failed. Aborting."
  exit 1
}

# Step 3: Start the MCP server
Write-Output "Step 3: Starting A11 MCP server..."
& npm start
if ($LASTEXITCODE -ne 0) {
  Write-Error "Failed to start server."
  exit 1
}

Write-Output "A11 MCP server is running. Restart GitHub Desktop / Copilot Desktop to use it."