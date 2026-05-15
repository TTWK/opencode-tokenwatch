param(
  [string]$Mode = "all",
  [int]$Limit = 30
)

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

function Max-Width($arr) {
  $max = 0
  foreach ($s in $arr) { if ($s.Length -gt $max) { $max = $s.Length } }
  return $max
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
  sum(json_extract(m.data, '$.tokens.cache.write')) as cache_write,
  sum(json_extract(m.data, '$.cost')) as total_cost
FROM message m JOIN session s ON s.id = m.session_id
WHERE json_extract(m.data, '$.tokens.total') > 0
  AND m.session_id = (SELECT id FROM session ORDER BY time_updated DESC LIMIT 1)
"@
  $r = opencode db $q --format json 2>$null | ConvertFrom-Json
  Write-Output "═══ Current Session ═══"
  if ($r -and $r.Count -gt 0) {
    $s = $r[0]
    $mName = $s.model; if ($mName.Length -gt 40) { $mName = $mName.Substring(0, 37) + "..." }
    $cacheInfo = "Read:$(Format-Tokens $s.cache_read)"
    if ($s.cache_write) { $cacheInfo += "  Write:$(Format-Tokens $s.cache_write)" }
    Write-Output "┌──────────┬────────────────────────────────────────┐"
    Write-Output ("│ {0,-8} │ {1,-38} │" -f "Model", $mName)
    Write-Output ("│ {0,-8} │ {1,-38} │" -f "Reqs", $s.requests)
    Write-Output ("│ {0,-8} │ {1,-38} │" -f "Tokens", "$(Format-Tokens $s.total_tokens) (In:$(Format-Tokens $s.input_tokens) Out:$(Format-Tokens $s.output_tokens))")
    Write-Output ("│ {0,-8} │ {1,-38} │" -f "Cache", $cacheInfo)
    Write-Output ("│ {0,-8} │ {1,-38} │" -f "Cost", (Format-Cost $s.total_cost))
    Write-Output "└──────────┴────────────────────────────────────────┘"
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
  $rows = opencode db $q --format json 2>$null | ConvertFrom-Json
  Write-Output "═══ Model Breakdown ═══"
  if (-not $rows -or $rows.Count -eq 0) { Write-Output "  (no data)"; Write-Output ""; return }

  # Pre-format all values for column-width calculation
  $items = foreach ($r in $rows) {
    $modelName = $r.model
    if ($modelName.Length -gt 24) { $modelName = $modelName.Substring(0, 21) + "..." }
    [PSCustomObject]@{
      Req     = "$($r.total_requests)"
      Ses     = "$($r.total_sessions)"
      Total   = Format-Tokens $r.total_tokens
      In      = Format-Tokens $r.input_tokens
      Out     = Format-Tokens $r.output_tokens
      Cache   = Format-Tokens $r.cache_read
      Cost    = Format-Cost $r.total_cost
      R_req   = $r.total_requests
      R_ses   = $r.total_sessions
      R_total = $r.total_tokens
      R_in    = $r.input_tokens
      R_out   = $r.output_tokens
      R_cache = $r.cache_read
      R_cost  = $r.total_cost
      Model   = $modelName
    }
  }

  # TOTAL row formatted values
  $tReq = 0; $tSes = 0; $tTok = 0; $tIn = 0; $tOut = 0; $tCache = 0; $tCost = 0.0
  foreach ($it in $items) {
    $tReq += $it.R_req; $tSes += $it.R_ses; $tTok += $it.R_total
    $tIn += $it.R_in; $tOut += $it.R_out; $tCache += $it.R_cache; $tCost += $it.R_cost
  }

  $sTReq   = "$tReq"
  $sTSes   = "$tSes"
  $sTTok   = Format-Tokens $tTok
  $sTIn    = Format-Tokens $tIn
  $sTOut   = Format-Tokens $tOut
  $sTInOut = "$sTIn/$sTOut"
  $sTCache = Format-Tokens $tCache
  $sTCost  = Format-Cost $tCost

  # Compute max column widths (minimums match header text length, and include TOTAL row)
  $wModel = [Math]::Max((Max-Width $items.Model), 5)
  $wReq   = [Math]::Max([Math]::Max((Max-Width $items.Req), 3), $sTReq.Length)
  $wSes   = [Math]::Max([Math]::Max((Max-Width $items.Ses), 3), $sTSes.Length)
  $wTotal = [Math]::Max([Math]::Max((Max-Width $items.Total), 5), $sTTok.Length)
  $wCache = [Math]::Max([Math]::Max((Max-Width $items.Cache), 5), $sTCache.Length)
  $wCost  = [Math]::Max([Math]::Max((Max-Width $items.Cost), 4), $sTCost.Length)

  # In/Out pair width
  $inoutStrs = foreach ($it in $items) { "$($it.In)/$($it.Out)" }
  $wInOut = [Math]::Max([Math]::Max((Max-Width $inoutStrs), 6), $sTInOut.Length)

  # Border components
  $top = "┌$('─' * ($wModel + 2))┬$('─' * ($wReq + 2))┬$('─' * ($wSes + 2))┬$('─' * ($wTotal + 2))┬$('─' * ($wInOut + 2))┬$('─' * ($wCache + 2))┬$('─' * ($wCost + 2))┐"
  $mid = "├$('─' * ($wModel + 2))┼$('─' * ($wReq + 2))┼$('─' * ($wSes + 2))┼$('─' * ($wTotal + 2))┼$('─' * ($wInOut + 2))┼$('─' * ($wCache + 2))┼$('─' * ($wCost + 2))┤"
  $bot = "└$('─' * ($wModel + 2))┴$('─' * ($wReq + 2))┴$('─' * ($wSes + 2))┴$('─' * ($wTotal + 2))┴$('─' * ($wInOut + 2))┴$('─' * ($wCache + 2))┴$('─' * ($wCost + 2))┘"
  $fmt = "│ {0,-$wModel} │ {1,$wReq} │ {2,$wSes} │ {3,$wTotal} │ {4,$wInOut} │ {5,$wCache} │ {6,$wCost} │"

  Write-Output $top
  Write-Output ($fmt -f "Model", "Req", "Ses", "Total", "In/Out", "Cache", "Cost")
  Write-Output $mid

  foreach ($it in $items) {
    Write-Output ($fmt -f $it.Model, $it.Req, $it.Ses, $it.Total, "$($it.In)/$($it.Out)", $it.Cache, $it.Cost)
  }

  Write-Output $mid
  Write-Output ($fmt -f "TOTAL", $sTReq, $sTSes, $sTTok, $sTInOut, $sTCache, $sTCost)
  Write-Output $bot
  Write-Output ""
}

function Show-DailyBreakdown {
  $q = @"
SELECT date(time_created / 1000, 'unixepoch') as day,
  count(*) as requests,
  sum(json_extract(data, '$.tokens.total')) as total_tokens,
  sum(json_extract(data, '$.tokens.input')) as input_tokens,
  sum(json_extract(data, '$.tokens.output')) as output_tokens,
  sum(json_extract(data, '$.tokens.cache.read')) as cache_read,
  sum(json_extract(data, '$.cost')) as total_cost
FROM message WHERE json_extract(data, '$.tokens.total') > 0
GROUP BY day ORDER BY day DESC LIMIT $Limit
"@
  $rows = opencode db $q --format json 2>$null | ConvertFrom-Json
  Write-Output "═══ Daily Breakdown ═══"
  if (-not $rows -or $rows.Count -eq 0) { Write-Output "  (no data)"; return }

  # Pre-format all values
  $items = foreach ($r in $rows) {
    [PSCustomObject]@{
      Day     = $r.day
      Req     = "$($r.requests)"
      Total   = Format-Tokens $r.total_tokens
      In      = Format-Tokens $r.input_tokens
      Out     = Format-Tokens $r.output_tokens
      Cache   = Format-Tokens $r.cache_read
      Cost    = Format-Cost $r.total_cost
      R_req   = $r.requests
      R_total = $r.total_tokens
      R_in    = $r.input_tokens
      R_out   = $r.output_tokens
      R_cache = $r.cache_read
      R_cost  = $r.total_cost
    }
  }

  # Column widths
  $wDay   = [Math]::Max((Max-Width $items.Day), 3)
  $wReq   = [Math]::Max((Max-Width $items.Req), 3)
  $wTotal = [Math]::Max((Max-Width $items.Total), 5)
  $wIn    = [Math]::Max((Max-Width $items.In), 2)
  $wOut   = [Math]::Max((Max-Width $items.Out), 3)
  $wCache = [Math]::Max((Max-Width $items.Cache), 5)
  $wCost  = [Math]::Max((Max-Width $items.Cost), 4)

  # TOTAL row accumulation
  $tReq = 0; $tTok = 0; $tIn = 0; $tOut = 0; $tCache = 0; $tCost = 0.0
  foreach ($it in $items) {
    $tReq += $it.R_req; $tTok += $it.R_total; $tIn += $it.R_in
    $tOut += $it.R_out; $tCache += $it.R_cache; $tCost += $it.R_cost
  }

  $sTReq   = "$tReq"
  $sTTok   = Format-Tokens $tTok
  $sTIn    = Format-Tokens $tIn
  $sTOut   = Format-Tokens $tOut
  $sTCache = Format-Tokens $tCache
  $sTCost  = Format-Cost $tCost

  # Column widths
  $wDay   = [Math]::Max((Max-Width $items.Day), 5)
  $wReq   = [Math]::Max([Math]::Max((Max-Width $items.Req), 3), $sTReq.Length)
  $wTotal = [Math]::Max([Math]::Max((Max-Width $items.Total), 5), $sTTok.Length)
  $wIn    = [Math]::Max([Math]::Max((Max-Width $items.In), 2), $sTIn.Length)
  $wOut   = [Math]::Max([Math]::Max((Max-Width $items.Out), 3), $sTOut.Length)
  $wCache = [Math]::Max([Math]::Max((Max-Width $items.Cache), 5), $sTCache.Length)
  $wCost  = [Math]::Max([Math]::Max((Max-Width $items.Cost), 4), $sTCost.Length)

  # Border components
  $top = "┌$('─' * ($wDay + 2))┬$('─' * ($wReq + 2))┬$('─' * ($wTotal + 2))┬$('─' * ($wIn + 2))┬$('─' * ($wOut + 2))┬$('─' * ($wCache + 2))┬$('─' * ($wCost + 2))┐"
  $mid = "├$('─' * ($wDay + 2))┼$('─' * ($wReq + 2))┼$('─' * ($wTotal + 2))┼$('─' * ($wIn + 2))┼$('─' * ($wOut + 2))┼$('─' * ($wCache + 2))┼$('─' * ($wCost + 2))┤"
  $bot = "└$('─' * ($wDay + 2))┴$('─' * ($wReq + 2))┴$('─' * ($wTotal + 2))┴$('─' * ($wIn + 2))┴$('─' * ($wOut + 2))┴$('─' * ($wCache + 2))┴$('─' * ($wCost + 2))┘"
  $fmt = "│ {0,-$wDay} │ {1,$wReq} │ {2,$wTotal} │ {3,$wIn} │ {4,$wOut} │ {5,$wCache} │ {6,$wCost} │"

  Write-Output $top
  Write-Output ($fmt -f "Day", "Req", "Total", "In", "Out", "Cache", "Cost")
  Write-Output $mid

  foreach ($it in $items) {
    Write-Output ($fmt -f $it.Day, $it.Req, $it.Total, $it.In, $it.Out, $it.Cache, $it.Cost)
  }

  Write-Output $mid
  Write-Output ($fmt -f "TOTAL", $sTReq, $sTTok, $sTIn, $sTOut, $sTCache, $sTCost)
  Write-Output $bot
}

# ─── Dispatch ───
switch ($Mode) {
  "current" { Show-CurrentSession }
  "model"   { Show-ModelBreakdown }
  "daily"   { Show-DailyBreakdown }
  default   { Show-CurrentSession; Show-ModelBreakdown; Show-DailyBreakdown }
}
