package server

import (
	"html/template"
	"net/http"
	"runtime"
	"strings"
)

type pageData struct {
	Version    string
	Scanners   []pageScanner
	Problem    string
	Background bool
	Mac        bool
	Windows    bool
	LogPath    string
	ConfigPath string
}

type pageScanner struct {
	Scanner
	Features string
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		writeError(w, http.StatusNotFound, "Not found.")
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w)
		return
	}
	refresh := r.URL.Query().Get("refresh") == "1"
	data := pageData{
		Version:    s.opts.Version,
		Problem:    s.opts.Registry.DiscoveryProblem(),
		Background: s.opts.Background,
		Mac:        runtime.GOOS == "darwin",
		Windows:    runtime.GOOS == "windows",
		LogPath:    s.opts.LogPath,
		ConfigPath: s.opts.Config.Path(),
	}
	for _, sc := range s.opts.Registry.List(r.Context(), refresh) {
		var f []string
		for _, src := range sc.Sources {
			f = append(f, map[string]string{"platen": "glass", "feeder": "document feeder"}[src])
		}
		if sc.Duplex {
			f = append(f, "two-sided")
		}
		if sc.Secure {
			f = append(f, "encrypted")
		}
		data.Scanners = append(data.Scanners, pageScanner{Scanner: sc, Features: strings.Join(f, " · ")})
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'")
	w.Header().Set("X-Frame-Options", "DENY")
	_ = pageTemplate.Execute(w, data)
}

var pageTemplate = template.Must(template.New("page").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TrendLIX Scan Helper</title>
<style>
:root { --bg:#f6f7f9; --card:#fff; --text:#1d2330; --muted:#5d6675; --line:#e2e5ea; --accent:#2457d6; --ok:#1a7f45; --bad:#b42318; }
@media (prefers-color-scheme: dark) { :root { --bg:#14171c; --card:#1d2128; --text:#e8eaee; --muted:#a2a9b5; --line:#2e333c; --accent:#7ea2ff; --ok:#4cc38a; --bad:#ff8a80; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
main { max-width:720px; margin:0 auto; padding:32px 16px 48px; }
h1 { font-size:26px; margin:0 0 4px; }
h2 { font-size:18px; margin:0 0 12px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; margin-top:16px; }
.status { color:var(--ok); font-weight:600; margin:0; }
.muted { color:var(--muted); }
ul { list-style:none; padding:0; margin:0; }
li { display:flex; gap:12px; align-items:center; justify-content:space-between; padding:12px 0; border-top:1px solid var(--line); }
li:first-child { border-top:0; padding-top:0; }
.name { font-weight:600; }
.small { font-size:14px; }
.url { font-size:13px; color:var(--muted); word-break:break-all; }
form { display:flex; gap:8px; flex-wrap:wrap; }
input { flex:1 1 220px; min-width:0; font:inherit; padding:9px 12px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--text); }
button { font:inherit; padding:9px 16px; border-radius:8px; border:0; background:var(--accent); color:#fff; cursor:pointer; }
button.link { background:none; color:var(--accent); padding:4px 0; }
button:disabled { opacity:.6; cursor:default; }
#msg { margin:10px 0 0; min-height:1.5em; }
#msg.bad { color:var(--bad); }
a { color:var(--accent); }
code { font-size:14px; background:var(--bg); padding:1px 5px; border-radius:4px; word-break:break-all; }
</style>
</head>
<body>
<main>
<h1>TrendLIX Scan Helper</h1>
<p class="status">&#9679; Running &middot; version {{.Version}}</p>
<p class="muted">The People System uses this helper to scan documents from the office scanners. Keep it running while you scan.</p>

<section class="card">
<h2>Scanners found</h2>
{{if .Scanners}}<ul>
{{range .Scanners}}<li><div><div class="name">{{.Name}}</div><div class="small muted">{{.Features}}</div><div class="url">{{.URL}}</div></div>{{if .Manual}}<button class="link" type="button" data-remove="{{.ID}}">Remove</button>{{end}}</li>
{{end}}</ul>{{else}}<p class="muted">No scanners found yet. Check that the scanner is switched on and on the same network as this computer, or add it by its IP address below.</p>{{end}}
{{if .Problem}}<p class="small muted">Automatic search problem: {{.Problem}}</p>{{end}}
<p class="small"><a href="/?refresh=1">Search again</a></p>
</section>

<section class="card">
<h2>Add a scanner by its IP address</h2>
<p class="small muted">If your scanner isn't listed, find its IP address on the scanner's screen (often under Network or Wi-Fi settings) and type it here.</p>
<form id="add"><input id="addr" name="url" placeholder="192.168.1.50" autocomplete="off" required><button id="addbtn" type="submit">Add scanner</button></form>
<p id="msg" role="status"></p>
</section>

<section class="card">
<h2>How to stop the helper</h2>
{{if .Background}}<p>The helper starts by itself when you log in and runs in the background.</p>
{{if .Mac}}<p>To stop it for good, open Terminal and run the helper with <code>uninstall</code> (see the README). To stop it only until you log in again, run <code>launchctl bootout gui/$(id -u)/com.trendlix.scan-helper</code> in Terminal.</p>{{end}}
{{if .Windows}}<p>To stop it now, open Task Manager, find <b>TrendLIX-Scan-Helper.exe</b> under Details and choose End task. To stop it starting at login, turn it off under Task Manager &rarr; Startup apps, or run the helper with <code>uninstall</code>.</p>{{end}}
{{else}}<p>Close the window the helper is running in, or press Ctrl+C in it.</p>{{end}}
<p class="small muted">Log file: <code>{{.LogPath}}</code><br>Settings: <code>{{.ConfigPath}}</code></p>
</section>
</main>
<script>
(function () {
  var form = document.getElementById('add'), msg = document.getElementById('msg'), btn = document.getElementById('addbtn');
  function show(text, bad) { msg.textContent = text; msg.className = bad ? 'bad' : ''; }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    btn.disabled = true; show('Looking for a scanner there…');
    fetch('/v1/scanners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: document.getElementById('addr').value }) })
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (res.ok) { show('Added ' + res.body.name + '.'); location.reload(); }
        else { show(res.body.error || 'That didn’t work.', true); btn.disabled = false; }
      })
      .catch(function () { show('The helper didn’t answer. Is it still running?', true); btn.disabled = false; });
  });
  document.querySelectorAll('[data-remove]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!confirm('Remove this scanner from the list?')) return;
      fetch('/v1/scanners/' + encodeURIComponent(b.getAttribute('data-remove')), { method: 'DELETE' })
        .then(function (r) { return r.json(); })
        .then(function (body) { if (body.error) { show(body.error, true); } else { location.reload(); } });
    });
  });
})();
</script>
</body>
</html>
`))
