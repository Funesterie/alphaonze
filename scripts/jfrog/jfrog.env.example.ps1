# Copy this file to jfrog.env.ps1 and fill values locally.
# Do not commit jfrog.env.ps1.

$env:JFROG_NPM_REGISTRY = "https://<tenant>.jfrog.io/artifactory/api/npm/funesterie-npm/"
$env:JFROG_NPM_SCOPE = "@funeste38"
$env:JFROG_NPM_AUTH_TOKEN = "<jfrog-access-token-or-identity-token>"

# Optional: used by Configure-JFrogCli.ps1.
$env:JFROG_ACCESS_TOKEN = "<jfrog-access-token-or-identity-token>"
