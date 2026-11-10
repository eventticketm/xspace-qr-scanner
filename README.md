# XSpace QR Scanner

Standalone mobile camera scanner for XSpace event entry/exit. It uses the existing Google Apps Script project and Google Sheet as the authoritative backend. It does not create or change ticket records, payments, bookings, or sales data.

## Files
- `index.html`, `styles.css`, `app.js`: standalone HTTPS scanner website.
- `config.js`: existing Apps Script deployment URL.
- `Bridge.gs`: add this code as a new script file named **Bridge** in the existing Apps Script project.

## 1. Enable GitHub Pages
In this repository, open **Settings → Pages**.
Under **Build and deployment**, select **Deploy from a branch**.
Set branch to `main` and folder to `/ (root)`, then click **Save**.
Wait for the GitHub Pages URL to appear:
`https://eventticketm.github.io/xspace-qr-scanner/`

## 2. Add the backend bridge
Open the existing Apps Script project used by the XSpace admin website.
Click **+ → Script**, name the file `Bridge`, then paste the complete contents of `Bridge.gs`.
Save the project and deploy a **new web app version**. Keep the current deployment URL; the website is already configured for it.

The bridge exposes only three actions: login, logout and scan. It does not accept arbitrary function names. Staff role is read from the server-side session, not trusted from the browser. Only Entry and Exit staff are permitted to scan.

## 3. Test before event day
1. Open the GitHub Pages URL on a phone over HTTPS.
2. Sign in using an Entry staff account and test an unused ticket QR. It should change from Outside to Inside.
3. Scan the same QR again. It should be rejected as already inside.
4. Sign in using an Exit staff account and scan the same QR. It should change from Inside to Outside.
5. Scan it again at Exit. It should be rejected as already outside.
6. Check the existing Admin panel and confirm the scan history has recorded all tests.

## Camera
Camera access is requested only after the user presses **Enable camera & start scanner**. The site must be opened over HTTPS. If the browser has previously blocked camera access, enable it in the browser's site settings.

## Security
- The repository is public, so never place passwords, staff PINs, tokens, or admin credentials in source files.
- The Apps Script bridge uses POST through a hidden iframe; staff PINs are not placed in query strings.
- Each staff scan is authenticated and the backend derives the scan direction from the staff role stored in the server session.
- Ticket status is validated and updated by the existing Apps Script backend under its script lock.
- Use individual staff accounts and change any test PINs before the event.
