# Publishing Relit

Relit is a static site (Vite). With no server reachable it plays a recorded run of the demo outages from
`public/demo/uri.json`, labeled "Recorded demo", and keeps crews and assignments in the browser. With the
API reachable it uses live data. Add `?demo=1` to the address to force the recorded demo.

## GitHub Pages (what teammates look at)

The built site lives on the `gh-pages` branch. Turn it on once, as a repo admin:
Settings, Pages, Source "Deploy from a branch", branch `gh-pages`, folder `/ (root)`.
The address is https://sshradd.github.io/IBMZ-Datathon-2026/

To publish a new build from this folder:

```bash
npm install && npm run build
rm -rf /tmp/gh && mkdir /tmp/gh && cp -R dist/. /tmp/gh && touch /tmp/gh/.nojekyll
cd /tmp/gh && git init -q && git checkout -q -b gh-pages && git add -A && git commit -qm "Publish build"
git push -f https://github.com/sshradd/IBMZ-Datathon-2026.git gh-pages
```

## Re-recording the demo

With the backend running (`cd backend && ../.venv/bin/uvicorn uriwatch.api:app --port 8010`):

```bash
node scripts/record-demo.mjs     # writes public/demo/uri.json, takes a few minutes
```

Record again whenever the model or API changes, so the Pages demo shows the new scores.

## With a live API

Set `VITE_API` to the API's public URL (see `.env.example`) and allow the site's origin in the API's CORS
list. The site then uses live data and falls back to the recorded demo only when the API cannot be reached.
