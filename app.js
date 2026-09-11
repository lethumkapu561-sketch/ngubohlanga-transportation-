/* =============================================================================
   app.js — front-end logic for the public website
   Handles: the destination rail, the route map, the fare estimate,
   and sending the booking to the backend.
   ============================================================================= */

// Where the backend lives. Set in config.js, which loads before this file.
const API = window.NGUBO_API || "";

/* ---------- 1. Small helpers ---------------------------------------------- */

const $ = (id) => document.getElementById(id);

function setStatus(message, kind) {
  const box = $("formStatus");
  if (!box) return;
  box.textContent = message;
  box.className = "status" + (kind ? " " + kind : "");
}

/** South African mobile numbers: 0XX XXX XXXX or +27XXXXXXXXX */
function normalisePhone(value) {
  const digits = String(value).replace(/[^\d+]/g, "");
  if (/^0\d{9}$/.test(digits)) return "+27" + digits.slice(1);
  if (/^\+27\d{9}$/.test(digits)) return digits;
  if (/^27\d{9}$/.test(digits)) return "+" + digits;
  return null;
}

/* ---------- 2. Destination rail ------------------------------------------- */

const rail = $("routeRail");
if (rail) {
  rail.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const city = button.dataset.city;

    rail.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false"));

    if (city) {
      button.setAttribute("aria-pressed", "true");
      $("dropoff").value = city;
      updateRoute();
    }
    $("book").scrollIntoView({ behavior: "smooth", block: "start" });
    $("pickup").focus();
  });
}

/* ---------- 3. The route map ---------------------------------------------- */

let map, pickupMarker, dropoffMarker, routeLine, routeCasing;

function initMap() {
  const holder = $("quoteMap");
  if (!holder || typeof L === "undefined") return;

  map = L.map(holder, { scrollWheelZoom: false }).setView([-30.6, 24.0], 5); // all of SA

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
}

const goldPin = (label) =>
  L.divIcon({
    className: "",
    html:
      '<div style="background:#d9a526;color:#23180a;font:700 11px Archivo,sans-serif;' +
      'padding:4px 9px;border-radius:999px;white-space:nowrap;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.5)">' + label + "</div>",
    iconAnchor: [22, 12],
  });

/** Ask our own server to turn an address into coordinates. */
async function geocode(address) {
  if (!address || address.trim().length < 3) return null;
  try {
    const res = await fetch(API + "/api/geocode?q=" + encodeURIComponent(address));
    if (!res.ok) return null;
    const data = await res.json();
    return data.found ? data : null;
  } catch {
    return null;
  }
}

/** Straight-line distance in km between two points (haversine). */
function haversine(a, b) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let routeTimer;
function scheduleRouteUpdate() {
  clearTimeout(routeTimer);
  routeTimer = setTimeout(updateRoute, 900); // wait until they stop typing
}

async function updateRoute() {
  if (!map) return;
  const from = await geocode($("pickup").value);
  const to = await geocode($("dropoff").value);
  if (!from || !to) return;

  if (pickupMarker) map.removeLayer(pickupMarker);
  if (dropoffMarker) map.removeLayer(dropoffMarker);
  if (routeLine) map.removeLayer(routeLine);
  if (routeCasing) map.removeLayer(routeCasing);

  pickupMarker = L.marker([from.lat, from.lon], { icon: goldPin("Pick-up") }).addTo(map);
  dropoffMarker = L.marker([to.lat, to.lon], { icon: goldPin("Drop-off") }).addTo(map);

  // Ask the backend for the real driving route.
  let km, minutes, line;
  try {
    const res = await fetch(
      API + "/api/route?from=" + from.lat + "," + from.lon + "&to=" + to.lat + "," + to.lon
    );
    const route = await res.json();
    if (route.found) {
      km = route.distanceKm;
      minutes = route.durationMin;
      line = route.line;
    }
  } catch { /* fall through to the estimate below */ }

  if (!line) {
    // Routing unavailable. Straight line, and pad it for real roads.
    line = [[from.lat, from.lon], [to.lat, to.lon]];
    km = Math.round(haversine(from, to) * 1.25);
    minutes = Math.round((km / 85) * 60);
  }

  routeCasing = L.polyline(line, { color: "#05080d", weight: 8, opacity: .9 }).addTo(map);
  routeLine = L.polyline(line, { color: "#d9a526", weight: 4 }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [40, 40] });

  const fare = Math.max(350, Math.round((250 + km * 14) / 50) * 50);
  const hrs = Math.floor(minutes / 60);

  $("estDistance").textContent = km + " km";
  $("estDuration").textContent = hrs ? hrs + " hr " + (minutes % 60) + " min" : minutes + " min";
  $("estFare").textContent = "R" + fare.toLocaleString("en-ZA") + " approx.";
  $("estimate").hidden = false;
}

/* ---------- 4. Booking form ----------------------------------------------- */

const form = $("bookingForm");

if (form) {
  $("pickup").addEventListener("input", scheduleRouteUpdate);
  $("dropoff").addEventListener("input", scheduleRouteUpdate);

  // Stop people booking a trip in the past.
  const today = new Date().toISOString().split("T")[0];
  $("date").min = today;
  $("date").value = today;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("");

    const phone = normalisePhone($("phone").value);
    if (!phone) {
      $("phone").setAttribute("aria-invalid", "true");
      setStatus("That mobile number doesn't look right. Use 076 835 0887 or +27 76 835 0887.", "bad");
      $("phone").focus();
      return;
    }
    $("phone").removeAttribute("aria-invalid");

    if (!form.checkValidity()) {
      setStatus("Some fields are still empty. Fill them in and send again.", "bad");
      form.reportValidity();
      return;
    }

    const booking = {
      name: $("name").value.trim(),
      phone: phone,
      email: $("email").value.trim(),
      service: $("service").value,
      vehicle: $("vehicle").value,
      pickup: $("pickup").value.trim(),
      dropoff: $("dropoff").value.trim(),
      date: $("date").value,
      time: $("time").value,
      passengers: Number($("passengers").value),
      notes: $("notes").value.trim(),
    };

    const button = $("submitBtn");
    button.disabled = true;
    button.textContent = "Sending\u2026";
    setStatus("Sending your request\u2026");

    try {
      const res = await fetch(API + "/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(booking),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "The server refused the booking.");

      setStatus(
        "Booked. Your reference is " + data.reference +
        ". We've alerted the office and will confirm your quote shortly.",
        "ok"
      );
      form.reset();
      $("date").value = today;

      // Open WhatsApp with the booking already typed out, so the office
      // gets it twice: once by email, once on the phone in their pocket.
      if (data.whatsappUrl) window.open(data.whatsappUrl, "_blank", "noopener");
    } catch (error) {
      setStatus(
        "We couldn't send that. Call 076 835 0887 or WhatsApp us and we'll take the booking directly. (" +
          error.message + ")",
        "bad"
      );
    } finally {
      button.disabled = false;
      button.textContent = "Send booking request";
    }
  });
}

/* ---------- 5. Start ------------------------------------------------------- */

initMap();
