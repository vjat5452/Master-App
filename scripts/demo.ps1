# End-to-end walkthrough against a running API (after: infra:up, db:migrate, db:seed, dev:api).
# Customer searches, quotes, places an order (twice with the same Idempotency-Key), then pays.
$ErrorActionPreference = 'Stop'
$base = 'http://localhost:5000/api/v1'
$password = 'localstock-dev-password'

function Post($path, $body, $headers = @{}) {
  Invoke-RestMethod -Method Post -Uri "$base$path" -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10)
}

Write-Host '1. Log in as the seeded customer'
$login = Post '/auth/login' @{ email = 'customer@localstock.dev'; password = $password }
$auth = @{ Authorization = "Bearer $($login.accessToken)" }

Write-Host '2. Search "whole wheat bread" near India Gate (28.6129, 77.2295)'
$search = Invoke-RestMethod "$base/catalog/search?q=whole%20wheat%20bread&lat=28.6129&lng=77.2295&radiusKm=20"
$search.items | ForEach-Object { "   $($_.brand) $($_.name) $($_.attributes | ConvertTo-Json -Compress): $($_.offers.Count) offer(s)" }
$variant = $search.items | Where-Object { $_.attributes.weight -eq '400 g' } | Select-Object -First 1

$cart = @{
  location = @{ lat = 28.6129; lng = 77.2295 }
  items = @(@{ variantId = $variant.variantId; quantity = 4 })
  preferences = @{ sort = 'best_value' }
}

Write-Host '3. Advisory quote (reserves nothing)'
$quote = Post '/checkout/quote' $cart $auth
"   status=$($quote.status) strategy=$($quote.best.strategy) shipments=$($quote.best.shipmentCount) total=$($quote.best.totalLandedCostMinor) paise eta=$($quote.best.maxEtaMinutes) min"

Write-Host '4. Place the order twice with one Idempotency-Key: one order, one reservation'
$key = "demo-$([guid]::NewGuid())"
$order = Post '/orders' $cart ($auth + @{ 'Idempotency-Key' = $key })
$again = Post '/orders' $cart ($auth + @{ 'Idempotency-Key' = $key })
"   order=$($order.id) status=$($order.status) replaySameOrder=$($order.id -eq $again.id)"

Write-Host '5. Pay via the sandbox (signed webhook path)'
$pay = Post "/payments/sandbox/$($order.payment.providerPaymentId)/simulate" @{ status = 'SUCCEEDED' } $auth
"   outcome=$($pay.result.outcome)"

$final = Invoke-RestMethod -Uri "$base/orders/$($order.id)" -Headers $auth
"   final order status=$($final.status) payment=$($final.payment.status)"
$final.shipments | ForEach-Object { "   shipment from $($_.warehouseName) via $($_.provider.name) eta=$($_.etaMinutes) min" }
