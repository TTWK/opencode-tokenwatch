param(
  [string]$Mode = "all",
  [int]$Limit = 30,
  [string]$Format = "table"
)

Write-Output "DEBUG: `$Mode is '$Mode'"
Write-Output "DEBUG: `$args is '$args'"

function Format-Tokens($n) {
  if ($n -ge 1000000) { return "{0:N1}M" -f ($n / 1000000) }
  if ($n -ge 1000)    { return "{0:N1}K" -f ($n / 1000) }
  return "$n"
}

function Format-Cost($n) {
  if ($n -eq 0) { return "`$0.00" }
  if ($n -lt 0.01) { return "`$$([math]::Round($n, 4))" }
  return "`$$([math]::Round($n, 2))"
}

function Show-CurrentSession {
  $q = @"
SELECT s.title, json_extract(s.model, '$.id') as model,
  count(*) as requests,
  sum(json_extract(m.data, '$.tokens.total')) as total_tokens,
  sum(json_extract(m.data, '$.tokens.input')) as input_tokens,
  sum(json_extract(m.data, '$.tokens.output')) as output_tokens,
  sum(json_extract(m.data, '$.tokens.reasoning')) as reasoning_tokens,
  sum(json_extract(m.data, '$.tokens.cache.read')) as cache_read,
  sum(json_extract(m.data, '$.cost')) as total_cost
FROM message m JOIN session s ON s.id = m.session_id
WHERE json_extract(m.data, '$.tokens.total') > 0
  AND m.session_id = (SELECT id FROM session ORDER BY time_updated DESC LIMIT 1)
"@
  $r = opencode db $q --format json 2>$null | ConvertFrom-Json
  Write-Output "═══ Current Session ═══"
  if ($r -and $r.Count -gt 0) {
    $s = $r[0]
    Write-Output "  Model:    $($s.model)"
    Write-Output "  Requests: $($s.requests)"
    Write-Output "  Tokens:   $(Format-Tokens $s.total_tokens)  (in:$(Format-Tokens $s.input_tokens)  out:$(Format-Tokens $s.output_tokens)  reasoning:$(Format-Tokens $s.reasoning_tokens)  cache:$(Format-Tokens $s.cache_read))"
    Write-Output "  Cost:     $(Format-Cost $s.total_cost)"
  } else {
    Write-Output "  (no token data)"
  }
  Write-Output ""
}

function Show-ModelBreakdown {
  $q = @"
SELECT count(*) as total_requests, count(distinct session_id) as total_sessions,
  json_extract(data, '$.modelID') as model,
  sum(json_extract(data, '$.tokens.total')) as total_tokens,
  sum(json_extract(data, '$.tokens.input')) as input_tokens,
  sum(json_extract(data, '$.tokens.output')) as output_tokens,
  sum(json_extract(data, '$.tokens.cache.read')) as cache_read,
  sum(json_extract(data, '$.cost')) as total_cost
FROM message WHERE json_extract(data, '$.tokens.total') > 0
GROUP BY model ORDER BY total_tokens DESC
"@
  $r = opencode db $q --format json 2>$null | ConvertFrom-Json
  Write-Output "═══ Model Breakdown ═══"
  if ($r -and $r.Count -gt 0) {
    $totalReq = 0; $totalSes = 0; $totalTok = 0; $totalIn = 0; $totalOut = 0; $totalCache = 0; $totalCost = 0
    foreach ($m in $r) {
      $totalReq += $m.total_requests; $totalSes += $m.total_sessions
      $totalTok += $m.total_tokens; $totalIn += $m.input_tokens; $totalOut += $m.output_tokens; $totalCache += $m.cache_read
      $totalCost += $m.total_cost
      Write-Output ("  {0,-30} {1,4} req  {2,3} ses  tot:{3,7}  in:{4,7}  out:{5,7}  cache:{6,7}  {7}" -f $m.model, $m.total_requests, $m.total_sessions, (Format-Tokens $m.total_tokens), (Format-Tokens $m.input_tokens), (Format-Tokens $m.output_tokens), (Format-Tokens $m.cache_read), (Format-Cost $m.total_cost))
    }
    Write-Output ("  {0,-30} {1,4} req  {2,3} ses  tot:{3,7}  in:{4,7}  out:{5,7}  cache:{6,7}  {7}" -f "─── TOTAL ───", $totalReq, $totalSes, (Format-Tokens $totalTok), (Format-Tokens $totalIn), (Format-Tokens $totalOut), (Format-Tokens $totalCache), (Format-Cost $totalCost))
  }
  Write-Output ""
}

function Show-DailyBreakdown {
  $q = @"
SELECT date(time_created / 1000, 'unixepoch') as day,
  count(*) as requests, sum(json_extract(data, '$.tokens.total')) as total_tokens,
  sum(json_extract(data, '$.tokens.input')) as input_tokens,
  sum(json_extract(data, '$.tokens.output')) as output_tokens,
  sum(json_extract(data, '$.tokens.reasoning')) as reasoning_tokens,
  sum(json_extract(data, '$.tokens.cache.read')) as cache_read,
  sum(json_extract(data, '$.cost')) as total_cost
FROM message WHERE json_extract(data, '$.tokens.total') > 0
GROUP BY day ORDER BY day DESC LIMIT $Limit
"@
  $r = opencode db $q --format json 2>$null | ConvertFrom-Json
  Write-Output "═══ Daily Breakdown ═══"
  if ($r -and $r.Count -gt 0) {
    $totalReq = 0; $totalTok = 0; $totalIn = 0; $totalOut = 0; $totalCache = 0; $totalCost = 0
    foreach ($d in $r) {
      $totalReq += $d.requests; $totalTok += $d.total_tokens; $totalIn += $d.input_tokens; $totalOut += $d.output_tokens; $totalCache += $d.cache_read
      $totalCost += $d.total_cost
      Write-Output ("  {0,-12} {1,4} req  tot:{2,7}  in:{3,7}  out:{4,7}  cache:{5,7}  {6}" -f $d.day, $d.requests, (Format-Tokens $d.total_tokens), (Format-Tokens $d.input_tokens), (Format-Tokens $d.output_tokens), (Format-Tokens $d.cache_read), (Format-Cost $d.total_cost))
    }
    Write-Output ("  {0,-12} {1,4} req  tot:{2,7}  in:{3,7}  out:{4,7}  cache:{5,7}  {6}" -f "─── TOTAL ───", $totalReq, (Format-Tokens $totalTok), (Format-Tokens $totalIn), (Format-Tokens $totalOut), (Format-Tokens $totalCache), (Format-Cost $totalCost))
  }
}

# ─── Dispatch ───
switch ($Mode) {
  "current" { Show-CurrentSession }
  "model"   { Show-ModelBreakdown }
  "daily"   { Show-DailyBreakdown }
  default   { Show-CurrentSession; Show-ModelBreakdown; Show-DailyBreakdown }
}
