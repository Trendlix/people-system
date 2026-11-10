# Scans with one scanner installed in Windows, as the helper asks:
#   TLX_WIA_DEVICE    the WIA device id
#   TLX_WIA_SOURCE    platen (the glass) or feeder
#   TLX_WIA_DUPLEX    1 for both sides (feeder only)
#   TLX_WIA_INTENT    1 colour, 2 greyscale, 4 black and white (text)
#   TLX_WIA_DATATYPE  3, 2 or 0, and TLX_WIA_DEPTH 24, 8 or 1, for drivers
#                     that don't take an intent
#   TLX_WIA_DPI       resolution
#   TLX_WIA_WIDTH     scan area in pixels at that resolution, from the top
#   TLX_WIA_HEIGHT    left corner; made smaller when the driver takes less,
#                     and worked out again if it took another resolution
#   TLX_WIA_PAGE      the feeder's page size (0 A4, 1 Letter, 2 the width and
#                     height below, 11 A5), or empty to leave it as it is
#   TLX_WIA_PAGEWIDTH, TLX_WIA_PAGEHEIGHT  that page in 1/1000 inch, for 2
#   TLX_WIA_MAXPAGES  stop after this many pages
#   TLX_WIA_OUT       the folder to write the pages to
# Each page is written as page-001.jpg (or .png or .bmp when the driver's
# image can't be made a JPEG) and said at once, so the helper reads it and
# knows the scan is moving. It says, a line each:
#   PAGESIZE 1|0      the feeder's page size was set, or couldn't be (when asked)
#   AREA <w> <h>      the area taken, in pixels; -1 for a side that couldn't be set
#   SCANNING <n>      page n is being scanned
#   PAGE <file>
#   WARN <message>
#   DONE <pages>
#   ERR NOTFOUND | ERR NOFEEDER | ERR NOFLATBED | ERR <codes> <message>
#   END
# Device properties: 3086 document handling capabilities (1 feeder, 2 glass),
# 3087 its status (1 feeder ready), 3088 its choice (1 feeder, 2 glass, 4 both
# sides), 3096 pages, 3097 page size, 3098 and 3099 the page's width and
# height. Item properties: 4098 name, 4103 data type, 4104 bits a pixel, 6146
# intent, 6147 and 6148 resolution, 6149 and 6150 the top left corner, 6151
# and 6152 width and height.
# WIA errors (0x8021...) that a second try in another format wouldn't change:
# 2 paper jam, 3 feeder empty, 4 paper problem, 5 offline, 6 busy, 7 warming
# up, 8 needs attention, A communication, D locked, F bad answer from the
# driver, 15 no device, 16 cover open, 17 lamp off, 20 several pages at once.
# Sets a property to exactly v, never a value near it (a page size is a code,
# not an amount); $false when it can't be.
function TlxSetIf($props, [int]$id, [int]$v) {
  $p = TlxProp $props $id;
  if ($null -eq $p) { return $false; };
  try { $p.Value = $v; return $true; } catch { return $false; };
};
# An area in pixels at dpi, worked out again for the resolution the driver
# took instead, if it took another.
function TlxRescale([int]$v, $res, [int]$dpi) {
  if ($null -eq $res -or $dpi -le 0) { return $v; };
  $r = 0;
  try { $r = [int]$res; } catch { return $v; };
  if ($r -le 0 -or $r -eq $dpi) { return $v; };
  return [int][Math]::Floor([double]$v * $r / $dpi);
};
# Sets a side of the area, made no larger than the most the driver says it
# takes (the glass or the page at this resolution), and gives what it then
# is, or -1 when it can't be set.
function TlxExtent($props, [int]$id, [int]$v) {
  $p = TlxProp $props $id;
  if ($null -eq $p) { return -1; };
  try {
    if ($p.SubType -eq 1 -and [int]$p.SubTypeMax -gt 0 -and $v -gt [int]$p.SubTypeMax) { $v = [int]$p.SubTypeMax; };
  } catch { };
  if (-not (TlxSet $props $id $v)) { return -1; };
  $got = TlxValue $props $id;
  if ($null -eq $got) { return $v; };
  try { return [int]$got; } catch { return $v; };
};
function TlxScan {
  $id = $env:TLX_WIA_DEVICE;
  $out = $env:TLX_WIA_OUT;
  $feeder = ($env:TLX_WIA_SOURCE -eq 'feeder');
  $duplex = ($env:TLX_WIA_DUPLEX -eq '1');
  $dpi = [int]$env:TLX_WIA_DPI;
  $max = [int]$env:TLX_WIA_MAXPAGES;
  if ($max -lt 1) { $max = 1; };
  $jpeg = '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}';
  $bmp = '{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}';
  $png = '{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}';
  $dm = New-Object -ComObject WIA.DeviceManager;
  $info = $null;
  foreach ($i in $dm.DeviceInfos) {
    if ($i.DeviceID -eq $id) { $info = $i; };
  };
  if ($null -eq $info) { TlxSay 'ERR NOTFOUND'; return; };
  $d = $info.Connect();
  $dp = $d.Properties;
  $hc = TlxValue $dp 3086;
  if ($feeder) {
    if ($null -eq $hc -or ([int]$hc -band 1) -eq 0) { TlxSay 'ERR NOFEEDER'; return; };
    $sel = 1;
    if ($duplex) { $sel = 5; };
    $null = TlxSet $dp 3088 $sel;
    $page = $env:TLX_WIA_PAGE;
    if ($page) {
      $ps = 0;
      if (TlxSetIf $dp 3097 ([int]$page)) {
        $ps = 1;
        if ([int]$page -eq 2) {
          $null = TlxSet $dp 3098 ([int]$env:TLX_WIA_PAGEWIDTH);
          $null = TlxSet $dp 3099 ([int]$env:TLX_WIA_PAGEHEIGHT);
        };
      };
      TlxSay ('PAGESIZE ' + $ps);
    };
  } else {
    if ($null -ne $hc -and ([int]$hc -band 2) -eq 0) { TlxSay 'ERR NOFLATBED'; return; };
    $null = TlxSet $dp 3088 2;
  };
  $null = TlxSet $dp 3096 1;
  $item = $d.Items.Item(1);
  if ($d.Items.Count -gt 1) {
    foreach ($it in $d.Items) {
      $nm = [string](TlxValue $it.Properties 4098);
      if ($feeder -and $nm -match 'feeder') { $item = $it; };
      if ((-not $feeder) -and $nm -match 'flatbed') { $item = $it; };
    };
  };
  $ip = $item.Properties;
  if (-not (TlxSet $ip 6146 ([int]$env:TLX_WIA_INTENT))) {
    $null = TlxSet $ip 4103 ([int]$env:TLX_WIA_DATATYPE);
    $null = TlxSet $ip 4104 ([int]$env:TLX_WIA_DEPTH);
  };
  $null = TlxSet $ip 6147 $dpi;
  $null = TlxSet $ip 6148 $dpi;
  $ip = $item.Properties;
  $w = TlxRescale ([int]$env:TLX_WIA_WIDTH) (TlxValue $ip 6147) $dpi;
  $h = TlxRescale ([int]$env:TLX_WIA_HEIGHT) (TlxValue $ip 6148) $dpi;
  $null = TlxSet $ip 6149 0;
  $null = TlxSet $ip 6150 0;
  $aw = TlxExtent $ip 6151 $w;
  $ah = TlxExtent $ip 6152 $h;
  TlxSay ('AREA ' + $aw + ' ' + $ah);
  $fmt = $jpeg;
  $n = 0;
  while ($n -lt $max) {
    if ($feeder -and $n -gt 0) {
      $st = TlxValue $d.Properties 3087;
      if ($null -ne $st -and ([int]$st -band 1) -eq 0) { break; };
    };
    TlxSay ('SCANNING ' + ($n + 1));
    $img = $null;
    try {
      $img = $item.Transfer($fmt);
    } catch {
      $c = TlxCodes $_;
      if ($feeder -and $n -gt 0 -and $c -match '80210003') { break; };
      if ($fmt -ne $jpeg -or $c -match '8021000[2-8ADF]|8021001[5-7]|80210020') { throw; };
      TlxWarn ('The driver did not give a JPEG (' + $c + '): asking for BMP');
      $fmt = $bmp;
      $img = $item.Transfer($fmt);
    };
    $n = $n + 1;
    foreach ($f in @($jpeg, $png)) {
      if ($img.FormatID -eq $jpeg -or $img.FormatID -eq $png) { break; };
      try {
        $proc = New-Object -ComObject WIA.ImageProcess;
        $proc.Filters.Add($proc.FilterInfos.Item('Convert').FilterID);
        $proc.Filters.Item(1).Properties.Item('FormatID').Value = $f;
        if ($f -eq $jpeg) { $proc.Filters.Item(1).Properties.Item('Quality').Value = 90; };
        $img = $proc.Apply($img);
      } catch {
        TlxWarn ('Converting the page failed: ' + (TlxMessage $_));
      };
    };
    $name = 'page-' + ('{0:D3}' -f $n) + '.' + $img.FileExtension;
    $img.SaveFile((Join-Path $out $name));
    TlxSay ('PAGE ' + $name);
    if (-not $feeder) { break; };
  };
  TlxSay ('DONE ' + $n);
};
try { $null = TlxScan; } catch { TlxFail $_; };
TlxSay 'END';
