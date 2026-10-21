# ParkSense – AI Smart Parking (full stack)

Plain HTML/CSS/JS frontend + a zero-dependency Node.js backend (Node 18+). No `npm install` needed.

## Run
    node server.js          # then open http://localhost:3000

Environment variables: `PORT` (default 3000), `ADMIN_PASSWORD` (used the first time the database is created), `SIMULATE=0` (turn off fake traffic from other drivers).

Demo staff login: `admin@parksense.local` / `admin123` (change it with ADMIN_PASSWORD before first run, and delete `data/db.json` to re-seed).

## Features
- Accounts: register / sign in / sign out. Passwords hashed with scrypt, sessions in HttpOnly cookies, login rate limit.
- Roles: drivers see their own bookings; staff (admin) see all bookings, the gate panel and an admin overview with payments.
- Bookings: AI bay recommendation, dynamic pricing, 10-minute hold that expires if unpaid, pay -> check in -> check out, cancel with automatic refund record.
- Payments: card and UPI checkout in TEST MODE. Input is validated (Luhn, expiry, CVV, UPI format) and a payment record is saved, but no money moves and card numbers are never stored. Test card: 4242 4242 4242 4242; a card ending 0002 is declined.
- Gate (staff): plate entry/exit; walk-in fees are recorded.

## Going live with real payments
Edit the `charge()` function in `server.js` and call Razorpay or Stripe there (create an order, verify the payment signature server side, return `{ ref, detail }`). Keep secret keys in environment variables. Use HTTPS in production and add `Secure` to the session cookie.

## API (JSON, cookie session)
GET /api/me · GET /api/slots · POST /api/recommend · POST /api/register · POST /api/login · POST /api/logout
GET|POST /api/bookings · POST /api/bookings/:id/(pay|checkin|cancel|checkout)
POST /api/gate/entry · POST /api/gate/exit (staff) · GET /api/admin/stats (staff)

## Structure
    server.js        backend
    public/          index.html, style.css, app.js
    data/db.json     created on first run (JSON file database)
