# READ ONLY. Requires owner-approved Policy Troubleshooter access; no IAM/resource/data changes.
param(
  [Parameter(Mandatory=$true)][string]$PrincipalEmail,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [switch]$AllowStagingDelete,
  [switch]$WritePermissionsOnly
)
$ErrorActionPreference = 'Stop'
if ($PrincipalEmail -notmatch '^[a-z][a-z0-9-]{5,29}@morris-client-dash-zagime\.iam\.gserviceaccount\.com$') { throw 'Owner-verified staging service account required' }
$projectId = 'morris-client-dash-zagime'
$permissions = @('datastore.databases.get','datastore.databases.getMetadata','datastore.entities.get','datastore.entities.list','datastore.entities.create','datastore.entities.update','datastore.entities.delete')
$checks = @()
if ($WritePermissionsOnly) { $permissions = @('datastore.entities.create','datastore.entities.update','datastore.entities.delete') }
foreach ($databaseId in @('mi-client-staging','(default)')) {
  $resourceName = "projects/$projectId/databases/$databaseId"
  foreach ($permission in $permissions) {
    $result = & gcloud policy-troubleshoot iam "//firestore.googleapis.com/$resourceName" --principal-email=$PrincipalEmail --permission=$permission --resource-name=$resourceName --resource-service=firestore.googleapis.com --resource-type=firestore.googleapis.com/Database --project=$projectId --format=json --quiet
    if ($LASTEXITCODE -ne 0) { throw 'IAM inspection failed; isolation is unverified' }
    $parsed = ($result -join "`n") | ConvertFrom-Json
    $state = $parsed.access
    if (!$state -and $parsed.overallAccessState -eq 'CAN_ACCESS') { $state = 'GRANTED' }
    if (!$state -and $parsed.overallAccessState -eq 'CANNOT_ACCESS') { $state = 'NOT_GRANTED' }
    $expected = 'NOT_GRANTED'
    if ($databaseId -eq 'mi-client-staging' -and ($permission -ne 'datastore.entities.delete' -or $AllowStagingDelete)) { $expected = 'GRANTED' }
    if ($state -ne $expected) { throw "IAM boundary unproven: $databaseId $permission. Unknown/incomplete evidence is not a denial." }
    $checks += @{databaseId=$databaseId;permission=$permission;state=$state}
  }
}
$evidence = @{projectId=$projectId;databaseId='mi-client-staging';principal=$PrincipalEmail;at=[DateTime]::UtcNow.ToString('o');allowStagingDelete=[bool]$AllowStagingDelete;scope=$(if ($WritePermissionsOnly) {'data-write-permissions'} else {'full-database-permissions'});checks=$checks}
if (Test-Path -LiteralPath $OutputPath) { throw 'Refusing to overwrite an evidence file; use a new protected path' }
$evidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Output 'Requested IAM matrix passed. Protect this evidence. This does not validate attachment or activate the API.'
