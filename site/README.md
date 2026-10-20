# Nimmari website

Fully static English project website, deployed from `site/` to
https://nimmari.joakimachren.com on Vercel. Set the Vercel project root to `site`,
select Other as the framework, and leave the build command unset; serve this
directory as-is. The repository root Vercel configuration belongs to the app.

Preview from the repository root:

```sh
python3 -m http.server 8080 -d site
```

Open http://localhost:8080. No build, JavaScript, external fonts, or CDN assets
are required. `style.css` supports light and dark system preferences.
`vercel.json` supplies clean URLs, security headers, and a 30-day image cache;
Python's preview server does not apply those Vercel settings. When replacing an
image, use a new filename to avoid stale cached copies and update the HTML
(including Open Graph metadata when applicable).

Screenshots are losslessly optimized copies of `docs/screenshots/`. Keep the agent-first workflow prominent: humans hand over material and sign; agents install, prepare/prefill, deliver chat links, track signing, and retrieve signed PDFs. Only signatures are mandatory by default; the owner UI and manual setup are secondary. Keep page
claims aligned with the root README, changelog, installation and Render guides,
security policy, and license. The Render alternative uses the README's deploy
URL with a local HTML button so no external image request is required.
