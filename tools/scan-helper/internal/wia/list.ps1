# Lists the scanners installed in Windows (WIA devices of the scanner type)
# and reads what each can do, but for those whose ids are in TLX_WIA_KNOWN
# (joined with |), which the helper read lately. It says, a line each:
#   DEV <id> <name> <manufacturer> <description> <port>      (base64 each)
#   CAPS <id> src=platen,feeder dup=0|1 res=<r> types=<r> bed=WxH feed=WxH
#   CAPSERR <id> <codes> <message>
#   ERR <codes> <message>       (WIA itself can't be used)
#   END
# <r> is range:min:max:step, list:a,b,c or value:v; sizes in 1/1000 inch.
# Device properties: 3 manufacturer, 4 description, 6 port, 7 name, 3074 and
# 3075 the glass, 3076 and 3077 the feeder, 3086 document handling
# capabilities (1 feeder, 2 glass, 4 both sides). Item properties: 4103 data
# type (0 black and white, 2 greyscale, 3 colour), 6147 resolution.
function TlxRange($p) {
  if ($null -eq $p) { return ''; };
  try {
    if ($p.SubType -eq 1) { return ('range:' + [int]$p.SubTypeMin + ':' + [int]$p.SubTypeMax + ':' + [int]$p.SubTypeStep); };
    if ($p.SubType -eq 2) {
      $v = @();
      foreach ($x in $p.SubTypeValues) { $v += [string][int]$x; };
      return ('list:' + ($v -join ','));
    };
    return ('value:' + [int]$p.Value);
  } catch { return ''; };
};
function TlxSize($props, [int]$w, [int]$h) {
  $a = TlxValue $props $w;
  $b = TlxValue $props $h;
  if ($null -eq $a -or $null -eq $b) { return '0x0'; };
  return ([string][int]$a + 'x' + [string][int]$b);
};
function TlxList {
  $known = @();
  if ($env:TLX_WIA_KNOWN) { $known = $env:TLX_WIA_KNOWN.Split('|'); };
  $dm = New-Object -ComObject WIA.DeviceManager;
  $infos = @();
  foreach ($i in $dm.DeviceInfos) {
    if ([int]$i.Type -eq 1) { $infos += $i; };
  };
  foreach ($i in $infos) {
    $p = $i.Properties;
    TlxSay ('DEV ' + (TlxB64 $i.DeviceID) + ' ' + (TlxB64 (TlxValue $p 7)) + ' ' + (TlxB64 (TlxValue $p 3)) + ' ' + (TlxB64 (TlxValue $p 4)) + ' ' + (TlxB64 (TlxValue $p 6)));
  };
  foreach ($i in $infos) {
    if ($known -contains $i.DeviceID) { continue; };
    try {
      $d = $i.Connect();
      $dp = $d.Properties;
      $hc = TlxValue $dp 3086;
      $src = @();
      $dup = 0;
      if ($null -eq $hc) {
        $src = @('platen');
      } else {
        if (([int]$hc -band 2) -ne 0) { $src += 'platen'; };
        if (([int]$hc -band 1) -ne 0) { $src += 'feeder'; };
        if (([int]$hc -band 4) -ne 0) { $dup = 1; };
        if ($src.Count -eq 0) { $src = @('platen'); };
      };
      $item = $d.Items.Item(1);
      $ip = $item.Properties;
      TlxSay ('CAPS ' + (TlxB64 $i.DeviceID) + ' src=' + ($src -join ',') + ' dup=' + $dup + ' res=' + (TlxRange (TlxProp $ip 6147)) + ' types=' + (TlxRange (TlxProp $ip 4103)) + ' bed=' + (TlxSize $dp 3074 3075) + ' feed=' + (TlxSize $dp 3076 3077));
    } catch {
      TlxSay ('CAPSERR ' + (TlxB64 $i.DeviceID) + ' ' + (TlxCodes $_) + ' ' + (TlxB64 (TlxMessage $_)));
    };
  };
};
try { $null = TlxList; } catch { TlxFail $_; };
TlxSay 'END';
