# Shared by the WIA scripts of the TrendLIX Scan Helper (internal/wia).
#
# The helper runs a script with Windows PowerShell, built into Windows:
#   powershell.exe -NoLogo -NoProfile -NonInteractive -Command <script>
# with what it asks for in TLX_WIA_* environment variables, so nothing it is
# given is ever read as code. Before it is run, whole-line comments like this
# one are taken out. The rest keeps to rules that tests check (wia_test.go):
#   - no double quotes and no backticks, so the command line can't be misread;
#   - every line ends with ; or { so the script means the same if Windows ever
#     joined its lines;
#   - functions are named Tlx..., so no alias of PowerShell can stand in for one.
# Everything the helper reads is a line of plain ASCII; free text (names,
# messages, the device id) goes as base64 of its UTF-8, and empty text as -
# so that every field of a line is there.
$ErrorActionPreference = 'Stop';
$ProgressPreference = 'SilentlyContinue';
function TlxSay([string]$s) {
  [Console]::Out.WriteLine($s);
};
function TlxB64($s) {
  $t = [string]$s;
  if ($t.Length -eq 0) { return '-'; };
  return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t));
};
# The HRESULT of an error and of each error inside it, as 8 hex digits.
function TlxCodes($err) {
  $list = @();
  $x = $err.Exception;
  while ($null -ne $x) {
    $list += ('{0:X8}' -f $x.HResult);
    $x = $x.InnerException;
  };
  return ($list -join ',');
};
function TlxMessage($err) {
  $x = $err.Exception;
  while ($null -ne $x.InnerException) {
    $x = $x.InnerException;
  };
  return $x.Message;
};
function TlxFail($err) {
  TlxSay ('ERR ' + (TlxCodes $err) + ' ' + (TlxB64 (TlxMessage $err)));
};
function TlxWarn([string]$s) {
  TlxSay ('WARN ' + (TlxB64 $s));
};
# A property of a WIA device or item by its number, or $null.
function TlxProp($props, [int]$id) {
  foreach ($p in $props) {
    if ($p.PropertyID -eq $id) { return $p; };
  };
  return $null;
};
function TlxValue($props, [int]$id) {
  $p = TlxProp $props $id;
  if ($null -eq $p) { return $null; };
  try { return $p.Value; } catch { return $null; };
};
# Sets a property; a value it doesn't take becomes the nearest one it does.
# $false when there is no such property, or it can't be set.
function TlxSet($props, [int]$id, [int]$v) {
  $p = TlxProp $props $id;
  if ($null -eq $p) { return $false; };
  try { $p.Value = $v; return $true; } catch { };
  try {
    if ($p.SubType -eq 1) {
      $p.Value = [Math]::Max([int]$p.SubTypeMin, [Math]::Min([int]$p.SubTypeMax, $v));
      return $true;
    };
    if ($p.SubType -eq 2) {
      $best = $null;
      foreach ($x in $p.SubTypeValues) {
        if ($null -eq $best -or [Math]::Abs([int]$x - $v) -lt [Math]::Abs($best - $v)) { $best = [int]$x; };
      };
      if ($null -ne $best) { $p.Value = $best; return $true; };
    };
  } catch { };
  TlxWarn ('Property ' + $id + ' could not be set to ' + $v);
  return $false;
};
