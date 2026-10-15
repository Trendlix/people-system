# TrendLIX Scan Helper

TrendLIX Scan Helper is a small program that lets the **People System** scan documents straight from the office scanners. Web browsers can't talk to scanners on their own, so this helper runs quietly on your computer and does the scanning for the People System. You scan from the People System as usual, check the preview, and confirm.

It works with network printers and scanners that support **AirScan** (also called **eSCL**, **AirPrint scanning** or **Mopria scanning**). Most office multifunction printers from the last ten years do. The scanner must be switched on and connected to the same network as your computer (not a guest Wi-Fi network).

The helper only accepts requests from the People System on your own computer. Nothing else on the network can use it.

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

## Check that it's working

Open **http://127.0.0.1:47815** in your browser. You should see the TrendLIX Scan Helper page with the version and the scanners it found. Click **Search again** if you just switched a scanner on.

## The first scan in the People System

The first time you scan, your browser asks whether **people.trendlix.com** may **access devices on your local network** (in some browsers: "apps and services on this device"). Click **Allow**. The browser remembers this.

If you clicked Block by mistake: click the icon at the left of the address bar on the People System page, open **Site settings**, set **Local network access** (or similar) to **Allow**, and reload the page.

Chrome and Microsoft Edge are recommended.

## If your scanner isn't found

Usually the helper finds scanners by itself within a few seconds. If yours isn't listed:

1. Check that the scanner is switched on and on the same network as your computer.
2. Find the scanner's **IP address**: it's usually on the scanner's screen under **Network**, **Wi-Fi** or **Settings → Network status** (it looks like `192.168.1.50`). Many printers can also print a network configuration page that shows it.
3. Open **http://127.0.0.1:47815**, type the IP address under **Add a scanner by its IP address**, and click **Add scanner**.

Scanners you add this way are remembered. You can remove them from the same page.

## Messages you might see

| Message | What to do |
|---|---|
| The scanner is busy. Try again in a moment. | Someone else is scanning or copying. Wait and try again. |
| The document feeder is empty… | Put the pages in the feeder (top tray), or choose to scan from the glass. |
| The scanner didn't answer… | Check that the scanner is on and on the same network, then try again. |
| The scan took more than 2 minutes… | Look at the scanner for a paper jam, an open cover or a message on its screen. |
| The scanner reported an error: … | Read the scanner's screen; restarting the scanner often helps. |

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

A single Go binary (Go 1.26, no cgo). It serves an HTTP API on **127.0.0.1:47815** only, finds eSCL scanners with mDNS (`_uscan._tcp`, `_uscans._tcp`) and scans with eSCL over HTTP(S).

### Commands

```
TrendLIX-Scan-Helper              run the helper (in a window)
TrendLIX-Scan-Helper install      copy to a per-user folder and start at login (and now)
TrendLIX-Scan-Helper uninstall    undo install
TrendLIX-Scan-Helper version      print the version
```

`install` uses a LaunchAgent (`~/Library/LaunchAgents/com.trendlix.scan-helper.plist`, loaded with `launchctl`) on macOS, inside a minimal app bundle so that macOS's Local Network prompt can name it, and the `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` value on Windows. The login copy runs with `--background`: on Windows it drops its console window, and if another copy already holds the port it waits and takes over when that copy exits. A copy started by hand exits 0 if a helper is already running, and 1 with a message if another program has the port.

### API

| Method and path | Answer |
|---|---|
| `GET /v1/status` | `{ "app": "trendlix-scan-helper", "version": "1.0.0" }` |
| `GET /v1/scanners[?refresh=1]` | `[{ id, name, url, secure, sources, duplex, colorModes, resolutions, formats, manual }]`, within about 3 s |
| `POST /v1/scanners` `{ "url" }` | Adds a scanner by URL, host or IP (tries `http://host/eSCL` and `https://host/eSCL`) and answers it. 400 for bad input, 502 if no eSCL scanner answers. |
| `DELETE /v1/scanners/{id}` | Removes a manually added scanner: `{ "ok": true }`. 400 for a discovered one, 404 if unknown. |
| `POST /v1/scan` `{ scannerId, source, duplex, colorMode, resolution }` | 200 `application/pdf` with `X-Scan-Pages` and `Content-Disposition: attachment; filename="scan-YYYYMMDD-HHMMSS.pdf"`. Errors: 409 busy, 422 feeder empty, 504 timeout, 502 scanner error or unreachable, 400/404 bad request. |
| `GET /` | Status page for HR |

Errors are always `{ "error": "<message for HR>" }`.

**Security.** CORS allows `https://people.trendlix.com`, `http://localhost:3000`, any `allowedOrigins` in `config.json`, and the helper's own status page. A request from any other `Origin` gets 403, and so does any request other than GET/HEAD without an `Origin`. Responses carry `Access-Control-Allow-Private-Network: true` and expose `X-Scan-Pages`, `Content-Disposition` and `X-Scan-Warning`. The `Host` header must be `127.0.0.1` or `localhost`, which blocks DNS rebinding.

**Scanning.** The helper asks for JPEG pages when the scanner offers them and builds the PDF itself (`internal/pdf`, a small writer with no dependencies that embeds each JPEG with DCTDecode, one page per image, sized from the pixel size and resolution). A scanner that only offers PDF has its PDF passed through; if it sends several PDFs, the first one is returned and `X-Scan-Warning` says so. The scan area is A4, reduced to the scanner's maximum. A resolution or colour mode the source can't do is replaced by the closest one it can. The 2-minute timeout counts time without progress: it restarts with each page, so long feeder batches aren't cut off. On any error the job is cancelled (`DELETE {job}`). HTTPS scanners with self-signed certificates are accepted only when the connection really goes to a private, link-local or loopback address (`internal/escl/client.go`). When a scanner advertises both HTTP and HTTPS it is listed once, using HTTPS unless HTTPS fails.

### config.json

```json
{
  "allowedOrigins": ["https://staging.people.trendlix.com"],
  "scanners": [{ "url": "http://192.168.1.50/eSCL", "name": "Canon imageCLASS MF264dw" }]
}
```

`allowedOrigins` is read at start-up; restart the helper after changing it.

### Build and test

```
go vet ./...
go test ./...          # includes a fake eSCL scanner (internal/escltest)
./build.sh             # dist/TrendLIX-Scan-Helper-mac.zip and -windows.zip; VERSION=1.0.1 ./build.sh
```

The macOS build is universal (arm64 + amd64 with `lipo`) and signed ad hoc, not notarized. Windows builds are amd64 and arm64.

Layout: `main.go` (commands and start-up), `internal/server` (HTTP API, CORS, scanner registry, status page), `internal/escl` (capabilities, scan jobs, scanner HTTP client), `internal/pdf`, `internal/discovery` (mDNS), `internal/config`, `internal/install`.

Dependency: `github.com/hashicorp/mdns` v1.0.7 for mDNS (it brings `github.com/miekg/dns` and `golang.org/x/net`); `golang.org/x/sys` for the Windows registry.
