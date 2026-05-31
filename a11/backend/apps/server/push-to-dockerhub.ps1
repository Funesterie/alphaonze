#!/usr/bin/env pwsh
# Build and optionally push the A11 backend image to Docker Hub.
# Default namespace is lowercase docker.io/nossen to avoid the payment-gated
# uppercase NOSSEN organization.

param(
    [string]$DockerHubUser = "",
    [string]$ImageName = "a11-backend",
    [string]$Version = "v1.0.0",
    [switch]$BuildOnly,
    [switch]$VersionOnly,
    [switch]$AllowPaidNossenOrg
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host $Message -ForegroundColor Cyan
}

function Require-Success([string]$Message) {
    if ($LASTEXITCODE -ne 0) {
        throw $Message
    }
}

$namespace = $DockerHubUser
if ([string]::IsNullOrWhiteSpace($namespace)) { $namespace = $env:NOSSEN_DOCKER_NAMESPACE }
if ([string]::IsNullOrWhiteSpace($namespace)) { $namespace = $env:DOCKERHUB_USERNAME }
if ([string]::IsNullOrWhiteSpace($namespace)) { $namespace = "nossen" }

if ($namespace -ceq "NOSSEN" -and -not $AllowPaidNossenOrg) {
    throw "Docker Hub org 'NOSSEN' is payment-gated right now. Use lowercase 'nossen' or pass -AllowPaidNossenOrg intentionally."
}

$repository = "$namespace/$ImageName"
$dateTag = Get-Date -Format "yyyy-MM-dd"

Write-Host "A11 backend Docker build/push"
Write-Host "Target: docker.io/$repository"
if ($BuildOnly) {
    Write-Host "BuildOnly: enabled; no push will be performed." -ForegroundColor Yellow
}
if ($VersionOnly) {
    Write-Host "VersionOnly: enabled; latest/date tags will not be pushed." -ForegroundColor Yellow
}

Write-Step "Checking Docker"
docker version --format "{{.Client.Version}}" | Out-Host
Require-Success "Docker is not available."

if (-not (Test-Path -LiteralPath "Dockerfile")) {
    throw "Dockerfile not found. Run this script from a11/backend/apps/server."
}

Write-Step "Building local image"
docker build -t "$ImageName`:latest" .
Require-Success "Docker build failed."

Write-Host "Build OK: $ImageName`:latest" -ForegroundColor Green

if ($BuildOnly) {
    Write-Host "Stopped before tag/push because BuildOnly is set." -ForegroundColor Green
    return
}

Write-Step "Tagging image"
docker tag "$ImageName`:latest" "$repository`:$Version"
Require-Success "Failed to tag version."
if (-not $VersionOnly) {
    docker tag "$ImageName`:latest" "$repository`:latest"
    Require-Success "Failed to tag latest."
    docker tag "$ImageName`:latest" "$repository`:$dateTag"
    Require-Success "Failed to tag date."
}

Write-Step "Pushing image"
docker push "$repository`:$Version"
Require-Success "Failed to push version."
if (-not $VersionOnly) {
    docker push "$repository`:latest"
    Require-Success "Failed to push latest."
    docker push "$repository`:$dateTag"
    Require-Success "Failed to push date tag."
}

Write-Step "Local images"
$imagePattern = ([regex]::Escape($ImageName) + "|" + [regex]::Escape($repository))
docker images | Select-String -Pattern $imagePattern | ForEach-Object {
    Write-Host "  $_"
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Repository: docker.io/$repository"
if ($VersionOnly) {
    Write-Host "Tags: $Version"
} else {
    Write-Host "Tags: latest, $Version, $dateTag"
}
