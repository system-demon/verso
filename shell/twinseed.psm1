# Twinseed shell chrome + completion (PowerShell)
#
#   Import-Module .\shell\twinseed.psm1 -DisableNameChecking
#   Use-TwinseedSeed exemplar/templates/practice.skel.yml
#   Set-TwinseedProfile audience=admin
#
# Shared status:     node shell/status.js [--line|--color|--stamp]
# Shared completion: node shell/complete.js --kind … [--word PREFIX]

$script:TwinseedShellDir = $PSScriptRoot

function Get-TwinseedStatusJson {
  node (Join-Path $script:TwinseedShellDir 'status.js')
}

function Get-TwinseedStatusLine {
  param([switch]$Color)
  $args = @('--line')
  if ($Color) { $args = @('--color') }
  node (Join-Path $script:TwinseedShellDir 'status.js') @args
}

function Get-TwinseedCompletions {
  <#
  .SYNOPSIS
    Twinseed-aware candidates from the shared complete.js emitter.
  #>
  param(
    [Parameter(Mandatory = $true)]
    [string]$Kind,
    [string]$Word = '',
    [string[]]$Have = @(),
    [string[]]$Tokens = @()
  )
  $invoke = @(
    (Join-Path $script:TwinseedShellDir 'complete.js'),
    '--kind', $Kind,
    '--word', $Word
  )
  if ($Have.Count -gt 0) {
    $invoke += @('--have', ($Have -join ','))
  }
  if ($Tokens.Count -gt 0) {
    # Force an array even for a single token (ConvertTo-Json unwraps @('x')).
    $invoke += @('--tokens', (ConvertTo-Json -Compress -InputObject @($Tokens)))
  }
  $lines = @(node @invoke 2>$null)
  foreach ($line in $lines) {
    if ($line) { $line }
  }
}

function Use-TwinseedSeed {
  <#
  .SYNOPSIS
    Set the active genome (YAML seed) and default baseDir for this shell session.
  .EXAMPLE
    Use-TwinseedSeed exemplar/templates/practice.skel.yml
  #>
  param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path
  )
  $resolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
  if (-not (Test-Path -LiteralPath $resolved)) {
    Write-Error "twinseed: seed not found: $Path"
    return
  }
  $env:TWINSEED_SEED = $resolved
  $env:TWINSEED_BASEDIR = Split-Path -Parent $resolved
  $env:TWINSEED_LAST_RENDER = $null
  $env:TWINSEED_RENDER_AT = $null
}

function Set-TwinseedBaseDir {
  param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path
  )
  $resolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
  if (-not (Test-Path -LiteralPath $resolved)) {
    Write-Error "twinseed: baseDir not found: $Path"
    return
  }
  $env:TWINSEED_BASEDIR = $resolved
}

function Set-TwinseedProfile {
  <#
  .SYNOPSIS
    Set presentation profile pairs (e.g. audience=admin platform=web).
  #>
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Pairs
  )
  if (-not $Pairs -or $Pairs.Count -eq 0) {
    Remove-Item Env:TWINSEED_PROFILE -ErrorAction SilentlyContinue
    return
  }
  $env:TWINSEED_PROFILE = ($Pairs -join ' ')
}

function Set-TwinseedStrict {
  param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet('on', 'off', '1', '0')]
    [string]$Mode
  )
  if ($Mode -in @('on', '1')) {
    $env:TWINSEED_STRICT = '1'
  } else {
    Remove-Item Env:TWINSEED_STRICT -ErrorAction SilentlyContinue
  }
}

function Clear-TwinseedSession {
  foreach ($name in @(
      'TWINSEED_SEED',
      'TWINSEED_BASEDIR',
      'TWINSEED_PROFILE',
      'TWINSEED_STRICT',
      'TWINSEED_LAST_RENDER',
      'TWINSEED_RENDER_AT'
    )) {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }
}

function Mark-TwinseedRender {
  <#
  .SYNOPSIS
    Record last render outcome. Marks genome clean when -Ok and seed exists.
  #>
  param(
    [Parameter(Mandatory = $true, ParameterSetName = 'Ok')]
    [switch]$Ok,
    [Parameter(Mandatory = $true, ParameterSetName = 'Fail')]
    [switch]$Fail
  )
  if ($Fail) {
    $env:TWINSEED_LAST_RENDER = 'fail'
    return
  }
  $env:TWINSEED_LAST_RENDER = 'ok'
  if ($env:TWINSEED_SEED) {
    $stamp = node (Join-Path $script:TwinseedShellDir 'status.js') --stamp 2>$null
    if ($stamp) { $env:TWINSEED_RENDER_AT = [string]$stamp }
  }
}

function Invoke-TwinseedRender {
  <#
  .SYNOPSIS
    Render the active seed (or a path as first arg) via the Twinseed CLI; stamps ok/fail.
  .EXAMPLE
    Invoke-TwinseedRender --json
    Invoke-TwinseedRender exemplar/templates/card.skel.yml --doc
  #>
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$AllArgs
  )
  $seed = $env:TWINSEED_SEED
  $cliArgs = @()
  if ($AllArgs -and $AllArgs.Count -gt 0) {
    $first = $AllArgs[0]
    if ($first -notlike '-*' -and (Test-Path -LiteralPath $first)) {
      $seed = (Resolve-Path -LiteralPath $first).Path
      if ($AllArgs.Count -gt 1) { $cliArgs = $AllArgs[1..($AllArgs.Count - 1)] }
    } else {
      $cliArgs = $AllArgs
    }
  }
  if (-not $seed) {
    Write-Error 'twinseed: no seed — Use-TwinseedSeed <seed.yml> or pass a path'
    return
  }
  $cli = Join-Path (Split-Path -Parent $script:TwinseedShellDir) 'src\cli.js'
  & node $cli $seed @cliArgs
  if ($LASTEXITCODE -eq 0) {
    $env:TWINSEED_SEED = $seed
    Mark-TwinseedRender -Ok
  } else {
    Mark-TwinseedRender -Fail
  }
}

function Enable-TwinseedPrompt {
  <#
  .SYNOPSIS
    Install a Twinseed status line above the PowerShell prompt.
  #>
  $script:TwinseedPriorPrompt = $function:prompt
  function global:prompt {
    $line = Get-TwinseedStatusLine -Color
    if ($line) {
      Write-Host $line
    }
    if ($script:TwinseedPriorPrompt) {
      & $script:TwinseedPriorPrompt
    } else {
      "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
    }
  }
  $env:TWINSEED_PROMPT = '1'
}

function Disable-TwinseedPrompt {
  if ($script:TwinseedPriorPrompt) {
    Set-Item Function:prompt $script:TwinseedPriorPrompt
    Remove-Variable -Scope Script -Name TwinseedPriorPrompt -ErrorAction SilentlyContinue
  }
  Remove-Item Env:TWINSEED_PROMPT -ErrorAction SilentlyContinue
}

function Register-TwinseedCompleters {
  <#
  .SYNOPSIS
    Register sparse Twinseed argument completers (Register-ArgumentCompleter).
  #>

  $completeSeed = {
    param($commandName, $parameterName, $wordToComplete, $commandAst, $fakeBoundParameters)
    Get-TwinseedCompletions -Kind seeds -Word $wordToComplete | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
  }
  Register-ArgumentCompleter -CommandName Use-TwinseedSeed -ParameterName Path -ScriptBlock $completeSeed

  $completeBase = {
    param($commandName, $parameterName, $wordToComplete, $commandAst, $fakeBoundParameters)
    Get-TwinseedCompletions -Kind basedirs -Word $wordToComplete | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
  }
  Register-ArgumentCompleter -CommandName Set-TwinseedBaseDir -ParameterName Path -ScriptBlock $completeBase

  $completeProfile = {
    param($commandName, $parameterName, $wordToComplete, $commandAst, $fakeBoundParameters)
    Get-TwinseedCompletions -Kind profile -Word $wordToComplete | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
  }
  Register-ArgumentCompleter -CommandName Set-TwinseedProfile -ParameterName Pairs -ScriptBlock $completeProfile

  $completeStrict = {
    param($commandName, $parameterName, $wordToComplete, $commandAst, $fakeBoundParameters)
    Get-TwinseedCompletions -Kind strict -Word $wordToComplete | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
  }
  Register-ArgumentCompleter -CommandName Set-TwinseedStrict -ParameterName Mode -ScriptBlock $completeStrict

  # Native completer: remaining args for render (seeds, flags, --emit, --profile).
  Register-ArgumentCompleter -CommandName Invoke-TwinseedRender -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $tokens = @()
    if ($commandAst -and $commandAst.CommandElements) {
      $tokens = @($commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.ToString() })
      if ($tokens.Count -gt 0 -and $wordToComplete) {
        $last = $tokens[-1]
        if ($last -eq $wordToComplete -or $last.StartsWith($wordToComplete)) {
          $tokens = $tokens[0..([Math]::Max(0, $tokens.Count - 2))]
          if ($tokens.Count -eq 1 -and $tokens[0] -eq $null) { $tokens = @() }
          if ($tokens.Count -eq 0) { $tokens = @() }
        }
      }
    }
    Get-TwinseedCompletions -Kind cli -Word $wordToComplete -Tokens $tokens | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
  }
}

# Completers register on import — quiet, no prompt change.
Register-TwinseedCompleters

Export-ModuleMember -Function @(
  'Get-TwinseedStatusJson',
  'Get-TwinseedStatusLine',
  'Get-TwinseedCompletions',
  'Use-TwinseedSeed',
  'Set-TwinseedBaseDir',
  'Set-TwinseedProfile',
  'Set-TwinseedStrict',
  'Clear-TwinseedSession',
  'Mark-TwinseedRender',
  'Invoke-TwinseedRender',
  'Enable-TwinseedPrompt',
  'Disable-TwinseedPrompt',
  'Register-TwinseedCompleters'
)
