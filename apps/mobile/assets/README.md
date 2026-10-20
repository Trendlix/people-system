# The App's Icons and Splash

The owner's logos (20 October 2026: "App Name: Trendlix People", with the logos for the icon; `../README.md`, Phase 5)
are kept here as they came, and every picture of the app is drawn from them by `generate.mjs`:

| Source | What it is |
|---|---|
| `source/trendlix-icon.jpg` | 1181 × 1181: a white "T" with a red dot on solid black. The icons, the notification icon and the splash. |
| `source/trendlix-wordmark.png` | 6064 × 1005, transparent: "TrendLIX." in black and red. The bundled pages (`www/`). |

## Regenerating

After changing a logo (keep its name, size and layout: the script reads the T as white, the dot as the red one in the
bottom right, and the black around them):

```sh
npm install                          # repo root, once: brings sharp (an exact devDependency of @trendlix/mobile)
npm run assets -w @trendlix/mobile   # = node assets/generate.mjs
npm run sync -w @trendlix/mobile     # copies www into the Android project
```

Then look at the pictures before committing (an image viewer shows the white ones on white: open them on a dark
background), and commit the PNGs and the two `www` pages. CI never runs the script: it builds what is committed.

## What It Writes

All under `android/app/src/main/res/`, for each density (`mdpi` 1×, `hdpi` 1.5×, `xhdpi` 2×, `xxhdpi` 3×, `xxxhdpi` 4×):

| File | What |
|---|---|
| `mipmap-*/ic_launcher_foreground.png` | The adaptive icon's front, 108 dp: the T and the dot on transparent, the JPG's square drawn as the 72 dp a mask shows, so the mark (52 dp tall) stays inside the 66 dp safe zone of every mask. Its background is the colour `@color/ic_launcher_background`, #000000. |
| `mipmap-*/ic_launcher_monochrome.png` | Android 13's themed icon: the same, one white silhouette (the launcher tints it). |
| `mipmap-*/ic_launcher.png`, `ic_launcher_round.png` | Android 7's icons (before adaptive ones): a rounded black square of 40 dp and a black circle of 44 dp, in 48 dp. |
| `drawable-*/ic_stat_notify.png` | The notification's small icon, 24 dp: the T and the dot as one white shape, 20 dp tall. |
| `drawable-*/splash_icon.png` | The splash's icon, 288 dp, the mark inside the middle 192 dp circle (as Android 12 draws it). |

And in `www/index.html` and `www/offline.html`, the wordmark (960 px wide, 64 colours) as the `src` of
`<img class="wordmark">`: a data address, because the offline page is served on the site's own address and can load
nothing from the network.

The XML that uses them is kept by hand: `mipmap-anydpi-v26/ic_launcher*.xml` (background, foreground, monochrome),
`values/colors.xml` (`trendlix_red` #E21D3B, the dot's red; `splash_background` #000000),
`values/ic_launcher_background.xml`, `drawable/splash.xml` (the splash before Android 12), `values/styles.xml` (the
launch theme), and the manifest's notification icon and colour.
