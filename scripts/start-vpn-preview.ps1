param([Parameter(Mandatory=$true)][string]$VpnIP,[string]$GroupCode='VLXEUROPE')
$env:HP_VPN_HOST=$VpnIP
$env:HP_PAIR_GROUP=$GroupCode
node "$PSScriptRoot/start-dev.cjs" --port 3000 --host 127.0.0.1
