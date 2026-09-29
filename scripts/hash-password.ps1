$nodeCandidates = @(@(
  $env:MARKETING_OS_NODE,
  'C:\Program Files\nodejs\node.exe',
  "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
  'C:\Users\fabio\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) })

if ($nodeCandidates.Count -eq 0) {
  Write-Error 'Node.js não foi encontrado. Instale a versão LTS em https://nodejs.org e reinicie o Cursor.'
  exit 1
}

& $nodeCandidates[0] (Join-Path $PSScriptRoot 'hash-password.mjs')
exit $LASTEXITCODE
