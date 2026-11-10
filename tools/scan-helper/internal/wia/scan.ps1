# Scans with one scanner installed in Windows, as the helper asks:
#   TLX_WIA_DEVICE    the WIA device id
#   TLX_WIA_SOURCE    platen (the glass) or feeder
#   TLX_WIA_DUPLEX    1 for both sides (feeder only)
#   TLX_WIA_INTENT    1 colour, 2 greyscale, 4 black and white (text)
#   TLX_WIA_DATATYPE  3, 2 or 0, and TLX_WIA_DEPTH 24, 8 or 1, for drivers
#                     that don't take an intent
#   TLX_WIA_DPI       resolution
#   TLX_WIA_WIDTH     scan area in pixels at that resolution,
#   TLX_WIA_HEIGHT    from the top left corner
#   TLX_WIA_MAXPAGES  stop after this many pages
#   TLX_WIA_OUT       the folder to write the pages to
# Each page is written as page-001.jpg (or .png or .bmp when the driver's
# image can't be made a JPEG) and said at once, so the helper reads it and
# knows the scan is moving. It says, a line each:
#   PAGE <file>
#   WARN <message>
#   DONE <pages>
#   ERR NOTFOUND | ERR NOFEEDER | ERR NOFLATBED | ERR <codes> <message>
#   END
# Device properties: 3086 document handling capabilities (1 feeder, 2 glass),
# 3087 its status (1 feeder ready), 3088 its choice (1 feeder, 2 glass, 4 both
# sides), 3096 pages. Item properties: 4098 name, 4103 data type, 4104 bits a
# pixel, 6146 intent, 6147 and 6148 resolution, 6149 and 6150 the top left
# corner, 6151 and 6152 width and height.
# WIA errors (0x8021...) that a second try in another format wouldn't change:
# 2 paper jam, 3 feeder empty, 4 paper problem, 5 offline, 6 busy, 7 warming
# up, 8 needs attention, A communication, D locked, F bad answer from the
# driver, 15 no device, 16 cover open, 17 lamp off, 20 several pages at once.
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
  $null = TlxSet $ip 6149 0;
  $null = TlxSet $ip 6150 0;
  $null = TlxSet $ip 6151 ([int]$env:TLX_WIA_WIDTH);
  $null = TlxSet $ip 6152 ([int]$env:TLX_WIA_HEIGHT);
  $fmt = $jpeg;
  $n = 0;
  while ($n -lt $max) {
    if ($feeder -and $n -gt 0) {
      $st = TlxValue $d.Properties 3087;
      if ($null -ne $st -and ([int]$st -band 1) -eq 0) { break; };
    };
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
