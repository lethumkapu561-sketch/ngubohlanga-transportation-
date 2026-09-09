# Ngubohlanga Tourism & Executive Transport — website + booking backend

Everything the poster promises, turned into a working site with a backend that
alerts you the moment a booking arrives.

## What is in the box

| File | What it does | Think of it as |
|---|---|---|
| `public/index.html` | The public website | The shopfront window |
| `public/styles.css` | Gold-on-black styling from your poster | The paint and signage |
| `public/app.js` | Booking form, route map, fare estimate | The salesperson at the counter |
| `public/driver.html` | The in-cab navigator page | The dashboard in the vehicle |
| `public/driver.js` | Navigation links, live tracking, panic button | The radio back to base |
| `server.js` | Receives bookings, stores them, alerts you | The office that answers the phone |
| `package.json` | The list of parts Node must download | A parts order form |
| `.env.example` | Template for your passwords | A blank keyring |
| `railway.json` | Tells Railway how to build and run it | Delivery instructions |

---

## Part 1 — Get it running on your own laptop

**Step 1.** Install Node.js if you don't have it. Go to nodejs.org, download the
LTS version, run the installer, click Next until it finishes.

**Step 2.** Open a terminal in this folder and check Node arrived:

```bash
node --version
```

You should see something like `v20.11.0`. If you see "command not found", Node
did not install — restart the computer and try again.

**Step 3.** Download the parts the server needs:

```bash
npm install
```

This creates a `node_modules` folder. It is large. You never edit anything inside it.

**Step 4.** Make your settings file:

```bash
cp .env.example .env
```

On Windows PowerShell use `copy .env.example .env` instead.

**Step 5.** Start the server:

```bash
npm start
```

**Step 6.** Open `http://localhost:3000` in your browser. The site is live on your
own machine. Nobody else can see it yet — that is Part 3.

To stop the server, press `Ctrl + C` in the terminal.

---

## Part 2 — Switch on the alerts

Right now bookings are saved but the email alert prints to the terminal instead of
sending. Here is why: Gmail will not let a program log in with your normal
password. It needs a special 16-character "App password".

**Step 1.** Sign in to the `ngubohlanga.tourismtransport@gmail.com` account.

**Step 2.** Go to **myaccount.google.com → Security** and switch on
**2-Step Verification**. Google will not offer App passwords until you do.

**Step 3.** In that same Security page, search for **App passwords**. Create one,
name it "Ngubohlanga website". Google shows you 16 letters in four blocks.
Copy them.

**Step 4.** Open `.env` in a text editor and paste it in, with no spaces:

```
SMTP_USER=ngubohlanga.tourismtransport@gmail.com
SMTP_PASS=abcdefghijklmnop
ALERT_EMAIL=ngubohlanga.tourismtransport@gmail.com
```

**Step 5.** While you are in there, replace `ADMIN_KEY` with a long random string.
This is the password that protects your bookings list. If you leave it as the
default, the bookings list stays locked shut and you will not be able to open it —
that is deliberate.

**Step 6.** Restart the server (`Ctrl + C`, then `npm start`) and send yourself a
test booking through the form. The email should land within a minute.

**What you get on every booking:**

1. An email with the full booking and a reference number like `NGB-4821`
2. A WhatsApp window that opens on the customer's phone with the booking already
   typed out and addressed to your office number — so it reaches you even if
   email is slow
3. A Slack message, if you paste a Slack webhook URL into `SLACK_WEBHOOK_URL`
4. A permanent record in `data/bookings.json`

To read all bookings:

```bash
curl -H "x-admin-key: YOUR_ADMIN_KEY" http://localhost:3000/api/bookings
```

---

## Part 3 — Put it on the internet with Railway

**This part matters, so read it twice:** GitHub Pages cannot run this site.
GitHub Pages only serves files — it cannot run `server.js`, so no emails, no
bookings, no driver tracking. You need a host that runs Node. Railway does.

**Step 1.** Push this folder to a new GitHub repository. Check that `.env` is
**not** in the repo — `.gitignore` already blocks it, but look with your own eyes.
That file holds your Gmail app password.

**Step 2.** On railway.app click **New Project → Deploy from GitHub repo** and
pick the repo. Railway reads `railway.json` and `package.json` by itself, so
there is nothing to type for build or start commands.

**Step 3.** Open the **Variables** tab. Add every line from your `.env` file as a
separate variable: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`ALERT_EMAIL`, `OFFICE_WHATSAPP`, `ADMIN_KEY`.

Do **not** add `PORT` — Railway sets that itself, and overriding it stops the
site from loading.

**Step 4 — the one everybody skips.** Railway rebuilds the whole machine on every
deploy, and anything written to disk is thrown away. Without this step, every
booking you have received disappears the next time you push a code change.

- In your service, go to **Settings → Volumes → Add Volume**
- Set the mount path to `/data`
- Back in **Variables**, add `DATA_DIR` with the value `/data`

Now bookings live on the volume and survive deploys. If you forget, the server
prints a warning in the Railway logs telling you so.

**Step 5.** Go to **Settings → Networking → Generate Domain**. Railway gives you
a URL like `ngubohlanga-production.up.railway.app`. Open it. The site is live.

**Step 6.** To use the real domain, click **Custom Domain**, type
`www.ngubohlanga-tourism-transport.co.za`, and Railway shows you a CNAME value.
Add that CNAME at your domain registrar. It usually goes live within an hour,
sometimes up to 24.

**Cost:** the Hobby plan is about $5 a month of usage credit. A booking site with
a handful of visitors a day sits well inside that. Unlike some free hosts,
Railway does not put the site to sleep, so your first customer of the morning
does not wait 30 seconds for the page.

**When you change the code:** push to GitHub and Railway redeploys on its own.
Watch the **Deployments** tab — if a deploy goes red, click it and read the log.
It usually tells you the missing variable by name.

---

## Part 4 — The driver navigator

Open `yoursite.co.za/driver.html` on the driver's phone. The driver types the
reference number from the booking (or you WhatsApp them a link like
`/driver.html?ref=NGB-4821` and it loads by itself).

What the driver gets:

- The full trip: passenger name, tappable phone number, both addresses, notes
- A map with pick-up and drop-off pinned
- Three navigation buttons that hand the route to a real navigation app
- **Share my live position** — sends GPS to your office every 20 seconds
- **Send emergency alert** — one tap, and you get an email with a Google Maps
  link to their exact position
- **Mark trip complete** — stops the tracking

### About the Bolt button — read this

Bolt does not publish a navigation SDK that a website can control. Nobody can
build "Bolt navigation inside a web page", including Bolt's own partners. So the
Bolt button tries to open the Bolt app on the phone, and falls back to Bolt's
website if the app isn't installed.

For actual turn-by-turn driving, **Google Maps and Waze are the reliable
buttons**, and both are already wired up and tested. That is the honest position,
and it is the safer one anyway: the driver navigates in a proper navigation app
with voice guidance, not by looking at your website while moving.

### Legal note

Live location tracking is personal information under POPIA. Before you switch it
on, tell your drivers in writing what is being collected, why, and for how long
you keep it, and get their agreement. Tracking someone without telling them is
an offence. The trip data lives in `data/bookings.json` — delete completed trips
periodically rather than keeping GPS trails forever.

---

## Things to change before you launch

- [ ] Swap the emoji service icons in `index.html` for your gold icons from the poster
- [ ] Add real photos of your fleet — the Mercedes, Fortuner, Corolla and Quantum
- [ ] Check the fare formula in `app.js` (currently R250 base + R14/km) against
      what you actually charge, or remove the estimate entirely if you would
      rather quote every trip by hand
- [ ] Register the domain and point it at your host
- [ ] Add your company registration number to the footer

---

## When something breaks

**"Cannot find module 'express'"** — you skipped `npm install`. Run it.

**"EADDRINUSE"** — the server is already running in another terminal window.
Close that one, or change `PORT` in `.env` to `3001`.

**Emails don't arrive** — you used your Gmail password instead of an App
password. Redo Part 2. Also check the Spam folder once.

**The map is blank** — the address wasn't recognised. Add the city and province,
for example "Gateway Mall, Umhlanga, KwaZulu-Natal" instead of "Gateway".

**Booking form says "we couldn't send that"** — the server isn't running, or the
site is on GitHub Pages where there is no server. See Part 3.

**Bookings vanished after a Railway deploy** — the volume is missing. Redo Step 4
of Part 3. The bookings that were already lost cannot be recovered, which is why
that step is worth doing before you take a single real booking.

**Railway deploy goes red** — open the failed deployment and read the last few
lines of the log. Nine times out of ten it names the variable you forgot to add.
