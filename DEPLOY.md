# Deploying the front end to Vercel

The site is static (Vite). It needs the Uri Watch API running somewhere public, because the API is
stateful (a live event stream, the replay session and saved crew state) and cannot run as Vercel
serverless functions. Host the API on any server, then:

1. In Vercel, set the environment variable `VITE_API` to the API's public URL (see `.env.example`).
2. On the API, allow the site's origin for CORS (the FastAPI app in `backend/uriwatch/api.py`
   allows `http://localhost:3000` today; add the Vercel URL).
3. Log in and deploy from this folder:

```bash
npx vercel login
npx vercel --prod -e VITE_API=https://your-api-host.example.com
```

`vercel.json` already sets the build (`npm run build`, output `dist`).

Without a reachable API the deployed site loads but shows no data.
