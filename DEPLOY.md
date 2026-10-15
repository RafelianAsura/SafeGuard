# SafeGuard deployment checklist

## A. Push the project to a new GitHub repository

1. Create a new **empty** repository on GitHub. Do not add a README, license, or `.gitignore` there.
2. From the SafeGuard project folder in PowerShell, check that the important private/local files are ignored:

   ```powershell
   git check-ignore safeguard.db safeguard.db-shm safeguard.db-wal .env node_modules firmware/safeguard_esp32/config.h
   ```

   Each path should be listed. `.gitignore` excludes SQLite files, `.env` files, `node_modules`, and the real firmware `config.h`; it allows `.env.example` and `config.h.example`.

3. This workspace already has Git history and an `origin` remote. Keep it unchanged and add the new GitHub repository under a separate remote name:

   ```powershell
   git remote add safeguard-github https://github.com/USERNAME/REPOSITORY.git
   git add .
   git status --short
   git commit -m "Prepare SafeGuard for deployment"
   git push -u safeguard-github HEAD:main
   ```

   Replace `USERNAME/REPOSITORY`. Before committing, inspect `git status` and make sure no actual credentials, `safeguard.db*`, or firmware `config.h` are staged. If `safeguard-github` already exists, inspect it with `git remote -v` and use the existing remote instead of adding it again.

## B. Create a Turso database

Install and authenticate the Turso CLI, then run:

```powershell
turso auth login
turso db create safeguard-production
turso db show --url safeguard-production
turso db tokens create safeguard-production
```

Copy the URL from `turso db show --url` as `TURSO_DATABASE_URL` and the token output as `TURSO_AUTH_TOKEN`. Keep the token private. Alternatively, create a database in the Turso dashboard, then copy its database URL and create a database auth token in its settings.

## C. Import and deploy on Vercel

1. In Vercel, choose **Add New → Project**, select the GitHub repository, and import it.
2. In **Project Settings → Environment Variables**, add the following for **Production** (add Preview too if needed):

   | Name | Value |
   |---|---|
   | `TURSO_DATABASE_URL` | Turso database URL, usually beginning with `libsql://` |
   | `TURSO_AUTH_TOKEN` | Turso database auth token |
   | `SAFEGUARD_API_KEY` | A long random secret shared with authorized devices |

   Generate a key locally with:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Do not add a public frontend prefix to these variables.

3. Deploy. The project uses `npm run build`, publishes `public/`, and serves API routes through `api/[...path].js`. Redeploy after changing environment variables.

## D. Test the live API

In PowerShell, set the deployed origin and the same key configured in Vercel:

```powershell
$url = "https://YOUR-PROJECT.vercel.app"
$key = "YOUR_SAFEGUARD_API_KEY"
$json = '{"room":"Deployment Test","vibration":0.02,"smoke":100,"temperature":25.5,"gas":100}'
```

Health check (expected HTTP 200 with `{ "ok": true, ... }` if the database is ready):

```powershell
curl.exe -i "$url/api/health"
```

POST without the key (expected HTTP 401):

```powershell
curl.exe -i -X POST "$url/api/readings" -H "Content-Type: application/json" --data $json
```

POST with the key (expected HTTP 201 and the stored reading):

```powershell
curl.exe -i -X POST "$url/api/readings" -H "Content-Type: application/json" -H "x-api-key: $key" --data $json
```

Dashboard (expected HTTP 200 JSON containing status, rooms, settings, alerts, and `alertCount`):

```powershell
curl.exe -i "$url/api/dashboard"
```

## E. Troubleshoot “Backend belum terhubung”

- Check that the deployment finished successfully and that the correct deployment URL is open.
- In Vercel **Project Settings → Environment Variables**, check that all three required names are present, have no extra spaces, and are enabled for the deployed environment. Redeploy after changes.
- Check Vercel function logs. Database initialization or authentication failures prevent health/API requests from succeeding.
- Run `curl.exe -i "$url/api/health"`. HTTP 503 means the database is not ready; check the function logs and Turso URL/token.
- Check `curl.exe -i "$url/api/dashboard"` for a function error. The dashboard uses same-origin `/api/...` calls; it does not need a frontend API URL variable.
- Confirm the ESP32 or simulator sends HTTPS to `/api/readings` and includes `x-api-key`. A POST without a key should return HTTP 401.
- If the page shows old values after recovery, use the refresh button or wait for its 10-second polling cycle. A later successful poll clears the connection warning.
