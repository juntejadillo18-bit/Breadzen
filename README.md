# PinoyCart Pro

Mobile-friendly polo-shirt store with server-persisted orders, an admin dashboard, COD order management, and a PayMongo-hosted GCash checkout integration scaffold. Includes the 16 product photos supplied by the shop owner.

## What's included

- Product catalogue and images served from the server
- Search, color filter, sort, cart and checkout form
- Orders persisted in SQLite (`data/pinoycart.sqlite`)
- Admin login at `/admin`
- Admin order list, customer details, COD order status, payment status and notes
- PayMongo hosted Checkout Session creation for GCash (secret key stays server-side)
- Webhook endpoint at `/api/paymongo/webhook`
- Basic security headers, rate limiting, HTTP-only session cookie, input validation

## Run locally

Requires Node.js 20 or newer.

1. Copy `.env.example` to `.env`.
2. Set a long random `SESSION_SECRET`, `ADMIN_USERNAME`, and unique `ADMIN_PASSWORD`.
3. Set `BASE_URL=http://localhost:3000` for local testing.
4. Install dependencies: `npm install`
5. Start: `npm start`
6. Open `http://localhost:3000`; admin: `http://localhost:3000/admin`.

## GCash / PayMongo setup

1. Create and verify a merchant account with PayMongo, and enable the payment methods you need.
2. Start with PayMongo **test** secret keys. Add the secret key to `.env` as `PAYMONGO_SECRET_KEY`; never place it in `public/` JavaScript.
3. Deploy the app to an HTTPS host with a stable public URL and set `BASE_URL` to that URL.
4. Register a PayMongo webhook pointing to `https://YOUR_DOMAIN/api/paymongo/webhook`. Store its signing secret as `PAYMONGO_WEBHOOK_SECRET`.
5. Test successful, cancelled, expired, duplicate, and delayed payment events. Confirm event names, signature format, checkout session attributes and webhook payload fields against the current PayMongo API documentation before production. Payment status must be based on a verified webhook, not the success redirect.
6. Only switch to live keys after merchant approval and full end-to-end testing.

**Important:** Payment APIs change and merchant accounts may have different capabilities. The PayMongo webhook handler is a starter implementation; verify the current webhook event and signature specifications and adjust the handler to match your account's actual event payload before accepting real payments. Never manually mark a GCash payment paid solely because a customer shows a screenshot.

## Production requirements before launch

- Use HTTPS and a stable production host.
- Configure `SESSION_SECRET`, strong unique admin password, `BASE_URL`, and production PayMongo keys through the hosting provider's secret/environment settings.
- Use a persistent disk or migrate SQLite to a managed database if the hosting provider has ephemeral filesystems or runs multiple instances.
- Replace the default in-memory Express session store with a persistent production session store.
- Add CSRF protection for admin state-changing requests, stricter validation, logging/monitoring, backups, privacy notice, retention policy and terms/returns/shipping policies.
- Add email/SMS order notifications and inventory controls if required.
- Never commit `.env`, API keys, webhook secrets, passwords or customer order data to a public repository.

## Publish using Android

The simplest route is to use a Node.js hosting provider that supports GitHub deployment or a cloud IDE from your mobile browser:

1. Create a private GitHub repository and upload the extracted project files (do not upload `.env` or the SQLite database).
2. In a Node.js hosting service, create a web service connected to that repository; use build command `npm install` and start command `npm start`.
3. Add environment variables in the host dashboard. Set `BASE_URL` to the HTTPS URL the host gives you.
4. Configure persistent storage for `data/` and a persistent session store; otherwise orders may disappear on redeploy/restart.
5. Set up PayMongo webhook URL and test keys, test orders, and only then configure live credentials.
6. Open the published HTTPS URL on your Android phone and test the customer and `/admin` flows.

A static host such as GitHub Pages alone cannot run this backend, securely keep payment keys, save orders, or process webhooks. This app needs a Node.js server.

## Current limits

This is a functional starter project, not a fully audited production commerce platform. It does not yet provide customer accounts, automated stock reservation, delivery/shipping API, email/SMS notifications, refund execution, tax invoices, or a managed database. Admin-created order status changes are saved; GCash payment state should be treated as reliable only after the webhook handler has been verified against current PayMongo docs and live test events.
