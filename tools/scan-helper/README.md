# TrendLIX Scan Helper

TrendLIX Scan Helper is a small program that lets the **People System** and **Prime ERP** scan documents straight from the office scanners. Web browsers can't talk to scanners on their own, so this helper runs quietly on your computer and does the scanning for them. You scan from the People System or Prime ERP as usual, check the preview, and confirm.

It works with:

- **Network printers and scanners** that support **AirScan** (also called **eSCL**, **AirPrint scanning** or **Mopria scanning**). Most office multifunction printers from the last ten years do. The scanner must be switched on and connected to the same network as your computer (not a guest Wi-Fi network).
- **On Windows, scanners connected to the computer by USB**, and any other scanner installed in Windows, once the scanner's driver is installed (see [USB scanners on Windows](#usb-scanners-on-windows)).

The helper only accepts requests from the People System and Prime ERP on your own computer. Nothing else on the network can use it.

---

## On a Mac

### First run

1. Download **TrendLIX-Scan-Helper-mac.zip** and double-click it to unzip it.
2. The program isn't notarized by Apple, so macOS asks you to confirm it the first time:
   - **Control-click** (or right-click) **TrendLIX-Scan-Helper**, choose **Open**, then click **Open** again.
   - If there is no Open button (macOS 15 and later): double-click the file once and close the warning, then go to **System Settings → Privacy & Security**, scroll down to the message about TrendLIX-Scan-Helper, click **Open Anyway** and enter your password.
3. A Terminal window opens and says **TrendLIX Scan Helper is running**. Keep it open while you scan.
4. If macOS asks whether the program (or Terminal) may **find devices on your local network**, click **Allow**. Without this it can't see the scanners.

### Start it automatically when you log in

In the Terminal window from step 3, type **Y** and press **Return**. The helper installs itself and keeps running in the background; you can close the window. From now on it starts by itself every time you log in.

macOS may show a notice that a background item was added; that's the helper. It may also ask again about **finding devices on your local network**: click **Allow**. If you missed that question, go to **System Settings → Privacy & Security → Local Network** and turn on **TrendLIX Scan Helper**.

(You can also do this from Terminal: drag the TrendLIX-Scan-Helper file into a Terminal window, type a space and `install`, and press Return.)

---

## On Windows

### First run

1. Download **TrendLIX-Scan-Helper-windows.zip**, right-click it and choose **Extract All**.
2. Double-click **TrendLIX-Scan-Helper.exe**. (The **-ARM64** file is only for PCs with an ARM processor, such as some Surface and Snapdragon laptops. The normal one works on those too.)
3. Windows may say **Windows protected your PC**. Click **More info**, then **Run anyway**.
4. A black window opens and says **TrendLIX Scan Helper is running**. Keep it open while you scan.
5. If Windows asks whether to allow the program on networks, tick **Private networks** and click **Allow**.

### Start it automatically when you log in

In the black window from step 4, type **Y** and press **Enter**. The helper installs itself and keeps running in the background; the window can be closed. From now on it starts by itself every time you log in (a black window may flash for a moment at login).

(You can also do this from a Command Prompt: open the folder with the file, click the address bar, type `cmd` and press Enter, then type `TrendLIX-Scan-Helper.exe install` and press Enter.)

---

## USB scanners on Windows

A scanner plugged into the computer by USB is used through Windows' own scanning (Windows Image Acquisition), so Windows has to know the scanner first:

1. Plug the scanner in and switch it on.
2. Install its driver from the maker's website if Windows doesn't find one by itself (look for the "WIA" or "TWAIN/WIA" driver; most scanner drivers include it).
3. Check that Windows sees it: **Settings → Bluetooth & devices → Printers & scanners** (Windows 11) or **Settings → Devices → Printers & scanners** (Windows 10) lists the scanner.
4. Open **http://127.0.0.1:47815** and click **Search again**. The scanner is listed as **installed in Windows on this computer**.

A network scanner that was also added in Windows may be listed twice: once as a network scanner and once as installed in Windows. Either one scans.

On a Mac, the helper scans from network scanners only.

## Check that it's working

Open **http://127.0.0.1:47815** in your browser. You should see the TrendLIX Scan Helper page with the version and the scanners it found. Click **Search again** if you just switched a scanner on or plugged one in.

## The first scan in the People System or Prime ERP

The first time you scan, your browser asks whether the site (**people.trendlix.com** for the People System, **erp.ppmeg.com** for Prime ERP) may **access devices on your local network** (in some browsers: "apps and services on this device"). Click **Allow**. The browser remembers this, for each site.

If you clicked Block by mistake: click the icon at the left of the address bar on the People System or Prime ERP page, open **Site settings**, set **Local network access** (or similar) to **Allow**, and reload the page.

Chrome and Microsoft Edge are recommended.

## If your scanner isn't found

Usually the helper finds scanners by itself within a few seconds. A USB scanner: see [USB scanners on Windows](#usb-scanners-on-windows). A network scanner that isn't listed:

1. Check that the scanner is switched on and on the same network as your computer.
2. Find the scanner's **IP address**: it's usually on the scanner's screen under **Network**, **Wi-Fi** or **Settings → Network status** (it looks like `192.168.1.50`). Many printers can also print a network configuration page that shows it.
3. Open **http://127.0.0.1:47815**, type the IP address under **Add a scanner by its IP address**, and click **Add scanner**.

Scanners you add this way are remembered. You can remove them from the same page.

## Messages you might see

| Message | What to do |
|---|---|
| The scanner is busy. Try again in a moment. | Someone else is scanning or copying. Wait and try again. |
| The scanner is busy, perhaps with another program on this computer… | A USB scanner is open in another program (for example Windows Scan or the maker's scanning program). Close that program and try again. |
| The scanner is warming up. Try again in a moment. | Wait a few seconds and scan again. |
| The document feeder is empty… | Put the pages in the feeder (top tray), or choose to scan from the glass. |
| The scanner didn't answer… | Check that the scanner is on and on the same network (or, for a USB scanner, that its cable is plugged into this computer), then try again. |
| The scan took more than 2 minutes… | Look at the scanner for a paper jam, an open cover or a message on its screen. |
| The scanner reported an error: … | Read the scanner's screen; restarting the scanner often helps. For a USB scanner, unplugging it and plugging it in again often helps too. |
| Windows' scanning (Windows Image Acquisition) isn't working on this computer… | Restart the computer. If it keeps happening, the scanner's driver may need installing again. |

## Updating

When the scan window says a newer version is out, download it again and open it as on the first run. It replaces the older copy by itself and keeps starting at login. If the older copy is open in a window, close that window first.

## Stopping or uninstalling

- **Stop it for now:** if it runs in a window, close that window. If it runs in the background: on a Mac, uninstall it (below); on Windows, open **Task Manager → Details**, select **TrendLIX-Scan-Helper.exe** and click **End task**.
- **Uninstall on a Mac:** open Terminal, drag the TrendLIX-Scan-Helper file into the window, type a space and `uninstall`, and press Return.
- **Uninstall on Windows:** open the folder with the file, click the address bar, type `cmd` and press Enter, then type `TrendLIX-Scan-Helper.exe uninstall` and press Enter. (Or turn it off under **Task Manager → Startup apps**.)

Uninstalling stops the helper, stops it starting at login and removes the installed copy. Your settings and the log file stay in the folder below; you can delete it.

## Where things are kept

| | Mac | Windows |
|---|---|---|
| Settings (`config.json`) and log (`helper.log`) | `~/Library/Application Support/trendlix-scan-helper/` | `%AppData%\trendlix-scan-helper\` |
| Installed copy (after "start at login") | `~/Library/Application Support/trendlix-scan-helper/TrendLIX Scan Helper.app` | `%LocalAppData%\Programs\TrendLIX Scan Helper\` |

---

## For developers

A single Go binary (Go 1.26, no cgo). It serves an HTTP API on **127.0.0.1:47815** only, finds eSCL scanners with mDNS (`_uscan._tcp`, `_uscans._tcp`) and scans with eSCL over HTTP(S). On Windows it also lists and scans with the scanners installed in Windows, through WIA (below).

### Commands

```
TrendLIX-Scan-Helper              run the helper (in a window)
TrendLIX-Scan-Helper install      copy to a per-user folder and start at login (and now)
TrendLIX-Scan-Helper uninstall    undo install
TrendLIX-Scan-Helper version      print the version
```

`install` uses a LaunchAgent (`~/Library/LaunchAgents/com.trendlix.scan-helper.plist`, loaded with `launchctl`) on macOS, inside a minimal app bundle so that macOS's Local Network prompt can name it, and the `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value on Windows. The login copy runs with `--background`: on Windows it drops its console window, and if another copy already holds the port it waits and takes over when that copy exits. A copy started by hand exits 0 if a helper of the same or a newer version is already running; if an older one is running and installed, it updates it (installs itself in its place); if an older one runs in a window, it asks for that window to be closed first. It exits 1 with a message if another program has the port.

### API

| Method and path | Answer |
|---|---|
| `GET /v1/status` | `{ "app": "trendlix-scan-helper", "version": "1.1.0" }` |
| `GET /v1/scanners[?refresh=1]` | `[{ id, name, url, secure, sources, duplex, colorModes, resolutions, formats, manual, kind }]`, within about 3 s (on Windows up to about 11 s, while Windows lists its scanners) |
| `POST /v1/scanners` `{ "url" }` | Adds a scanner by URL, host or IP (tries `http://host/eSCL` and `https://host/eSCL`) and answers it. 400 for bad input, 502 if no eSCL scanner answers. |
| `DELETE /v1/scanners/{id}` | Removes a manually added scanner: `{ "ok": true }`. 400 for a discovered one or one installed in Windows, 404 if unknown. |
| `POST /v1/scan` `{ scannerId, source, duplex, colorMode, resolution, output }` | 200 `application/pdf` with `X-Scan-Pages` and `Content-Disposition: attachment; filename="scan-YYYYMMDD-HHMMSS.pdf"`. With `"output": "images"`, 200 `application/json` `{ "pages": [{ "contentType": "image/jpeg", "width", "height", "dpi", "data": "<base64 JPEG>" }], "warning"? }` with `X-Scan-Pages` (10 pages at most, the rest dropped with a warning). Errors: 409 busy or warming up, 422 feeder empty, 504 timeout, 502 scanner error or unreachable, 400/404 bad request. |
| `GET /` | Status page |

Errors are always `{ "error": "<message for the person scanning>" }`.

In a scanner, `kind` is `"escl"` for a network scanner, or `"wia"` for one installed in Windows on this computer (USB, or a network scanner added in Windows); the latter's `url` is `wia://this-computer`, `formats` is `["image/jpeg"]` and `secure` and `manual` are false. Until a scanner says what it can do, it is shown with the glass, colour, greyscale and black and white, and 300 dpi. `source` is `platen` (the glass, the default) or `feeder`; `colorMode` `color` (the default), `grayscale` or `bw`; `resolution` 50 to 2400 (default 300), the closest the scanner offers being used. `output` is `pdf` (the default) or `images`: pages as JPEG pictures, for a page that works on the picture itself (an ID card); a scanner that sends PDFs only can't give them (400).

**Security.** CORS allows the People System (`https://people.trendlix.com`, `http://localhost:3000`) and Prime ERP (`https://erp.ppmeg.com`, `http://localhost:5173`), any `allowedOrigins` in `config.json`, and the helper's own status page. A request from any other `Origin` gets 403, and so does any request other than GET/HEAD without an `Origin`. Responses carry `Access-Control-Allow-Private-Network: true` and expose `X-Scan-Pages`, `Content-Disposition` and `X-Scan-Warning`. The `Host` header must be `127.0.0.1` or `localhost`, which blocks DNS rebinding.

**Scanning.** The helper asks for JPEG pages when the scanner offers them and builds the PDF itself (`internal/pdf`, a small writer with no dependencies that embeds each JPEG with DCTDecode, one page per image, sized from the pixel size and resolution). A scanner that only offers PDF has its PDF passed through; if it sends several PDFs, the first one is returned and `X-Scan-Warning` says so. The scan area is A4, reduced to the scanner's maximum. A resolution or colour mode the source can't do is replaced by the closest one it can. The 2-minute timeout counts time without progress: it restarts with each page, so long feeder batches aren't cut off. On any error the job is cancelled (`DELETE {job}`). HTTPS scanners with self-signed certificates are accepted only when the connection really goes to a private, link-local or loopback address (`internal/escl/client.go`). When a scanner advertises both HTTP and HTTPS it is listed once, using HTTPS unless HTTPS fails.

### config.json

```json
{
  "allowedOrigins": ["https://staging.people.trendlix.com"],
  "scanners": [{ "url": "http://192.168.1.50/eSCL", "name": "Canon imageCLASS MF264dw" }]
}
```

`allowedOrigins` is read at start-up; restart the helper after changing it.

### Scanners installed in Windows (WIA)

On Windows the helper also uses the scanners Windows knows: USB scanners with their driver installed, and network scanners added in Windows. It drives Windows Image Acquisition (WIA, part of Windows; most scanner drivers, TWAIN ones included, install a WIA driver) through WIA's own COM automation (`WIA.DeviceManager`), from a short script run by Windows PowerShell, which is built into Windows: `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe -NoLogo -NoProfile -NonInteractive -Command <script>`, without a window. Nothing is installed and no library is added. The scripts are `internal/wia/list.ps1` and `scan.ps1` (with `common.ps1`), built into the program; what they are asked comes in `TLX_WIA_*` environment variables, never in the script, and they answer in lines of plain ASCII, free text in base64 (`internal/wia/wia.go` reads them; `wia_test.go` checks the scripts' rules and reads made-up answers).

- **Listing** runs with each search for scanners (at start, every 2 minutes, and with `?refresh=1`). What a scanner can do (glass, feeder, both sides, colour modes, resolutions, the size of the glass and the feeder) is read by connecting to it, so it is read again only after an hour (ten minutes when it couldn't be read).
- **Scanning** asks the scanner for the source (WIA "Document Handling Select"), the colour (intent, or data type and bits a pixel), the resolution and the area (A4, or less when the glass or feeder is smaller), and transfers page after page (the feeder until it is empty, 300 pages at most). Each page is asked for as JPEG; one the driver gives as BMP is made a JPEG by Windows (`WIA.ImageProcess`), else a PNG. Pages are written to `%TEMP%\trendlix-scan-helper\scan-*`, read and deleted at once; the folder goes with the scan, and folders left by a scan cut short are deleted when the helper starts. The 2-minute timeout restarts with each page, and stops PowerShell.
- **Errors** come from WIA's codes: busy or locked → busy; warming up; feeder empty; offline, no device or a communication error → "didn't answer"; paper jam, more than one page at once, cover open, lamp off and others → "The scanner reported an error: …"; WIA's scripting library missing or its service off → "Windows' scanning … isn't working".

### Build and test

```
go vet ./...
go test ./...          # includes a fake eSCL scanner (internal/escltest)
./build.sh             # dist/TrendLIX-Scan-Helper-mac.zip and -windows.zip; VERSION=1.1.0 ./build.sh
```

The macOS build is universal (arm64 + amd64 with `lipo`) and signed ad hoc, not notarized. Windows builds are amd64 and arm64.

Layout: `main.go` (commands and start-up), `internal/server` (HTTP API, CORS, scanner registry, status page), `internal/escl` (capabilities, scan jobs, scanner HTTP client), `internal/wia` (scanners installed in Windows), `internal/pdf`, `internal/discovery` (mDNS), `internal/config`, `internal/install`.

Dependency: `github.com/hashicorp/mdns` v1.0.7 for mDNS (it brings `github.com/miekg/dns` and `golang.org/x/net`); `golang.org/x/sys` for the Windows registry and for starting PowerShell without a window. WIA needs nothing more: it and PowerShell are part of Windows.
