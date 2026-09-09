/* =============================================================================
   driver.js — the in-cab navigator
   Loads a trip, hands navigation over to Bolt / Google Maps / Waze,
   shares the driver's live position with the office, and sends panic alerts.
   ============================================================================= */

// Where the backend lives. Set in config.js, which loads before this file.
const API = window.NGUBO_API || "";

const $ = (id) => document.getElementById(id);

let trip = null;          // the loaded booking
let watchId = null;       // browser GPS watch
let sendTimer = null;     // how often we post the position
let lastFix = null;       // most recent {lat, lon}
let dmap, driverDot, pickupPin, dropoffPin;
let followMe = true;   // keep the map centred on the vehicle while driving

/* ---------- 1. Load the trip ---------------------------------------------- */

$("loadBtn").addEventListener("click", loadTrip);
$("refInput").addEventListener("keydown", (e) => { if (e.key === "Enter") loadTrip(); });

// Allow driver.html?ref=NGB-4821 straight from a WhatsApp link.
const refFromUrl = new URLSearchParams(location.search).get("ref");
if (refFromUrl) { $("refInput").value = refFromUrl; loadTrip(); }

async function loadTrip() {
  const ref = $("refInput").value.trim().toUpperCase();
  if (!ref) { say("driverStatus", "Type the reference the office sent you.", "bad"); return; }

  say("driverStatus", "Looking up " + ref + "\u2026");
  try {
    const res = await fetch(API + "/api/trips/" + encodeURIComponent(ref));
    if (res.status === 404) throw new Error("No trip with that reference. Check with the office.");
    if (!res.ok) throw new Error("Could not reach the server.");
    trip = await res.json();

    $("tPassenger").textContent = trip.name;
    $("tPhone").innerHTML = '<a href="tel:' + trip.phone + '">' + trip.phone + "</a>";
    $("tPickup").textContent = trip.pickup;
    $("tDropoff").textContent = trip.dropoff;
    $("tWhen").textContent = trip.date + " at " + trip.time;
    $("tSeats").textContent = trip.passengers;
    $("tNotes").textContent = trip.notes || "None";

    $("tripDetails").hidden = false;
    $("navCard").hidden = false;
    $("safetyCard").hidden = false;
    say("driverStatus", "Trip loaded.", "ok");

    buildNavLinks();
    drawMap();
  } catch (err) {
    say("driverStatus", err.message, "bad");
  }
}

function say(id, text, kind) {
  const el = $(id);
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

/* ---------- 2. Hand navigation to a real navigation app -------------------- */

function buildNavLinks() {
  const pickup = encodeURIComponent(trip.pickup);
  const dropoff = encodeURIComponent(trip.dropoff);

  // Google Maps: full route, pick-up as origin, drop-off as destination.
  $("navGoogle").href =
    "https://www.google.com/maps/dir/?api=1&origin=" + pickup +
    "&destination=" + dropoff + "&travelmode=driving";

  // Waze takes one destination at a time, so send the pick-up first.
  $("navWaze").href = "https://waze.com/ul?q=" + pickup + "&navigate=yes";

  // Bolt. If the Bolt app is installed the custom scheme opens it; if not,
  // the browser falls back to Bolt's website. See README for the caveat.
  const bolt = $("navBolt");
  bolt.href = "https://bolt.eu/";
  bolt.addEventListener("click", (event) => {
    event.preventDefault();
    const deepLink = "bolt://action/setPickup?address=" + pickup + "&dropoff=" + dropoff;
    const openedAt = Date.now();
    location.href = deepLink;
    setTimeout(() => {
      // Still here after 1.2s? The app never opened, so use the web page.
      if (Date.now() - openedAt < 2500 && !document.hidden) {
        window.open("https://bolt.eu/en-za/", "_blank", "noopener");
      }
    }, 1200);
  });
}

/* ---------- 3. Map and turn-by-turn route ---------------------------------- */

let routeSteps = [];

async function drawMap() {
  if (typeof L === "undefined") return;

  if (!dmap) {
    dmap = L.map("driverMap").setView([-33.92, 18.42], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(dmap);
  }

  const from = await geocode(trip.pickup);
  const to = await geocode(trip.dropoff);

  const pin = (label, colour) =>
    L.divIcon({
      className: "",
      html:
        '<div style="background:' + colour + ';color:#23180a;font:700 11px Archivo,sans-serif;' +
        'padding:4px 9px;border-radius:999px;white-space:nowrap">' + label + "</div>",
      iconAnchor: [22, 12],
    });

  if (from) pickupPin = L.marker([from.lat, from.lon], { icon: pin("Pick-up", "#f3da92") }).addTo(dmap);
  if (to) dropoffPin = L.marker([to.lat, to.lon], { icon: pin("Drop-off", "#d9a526") }).addTo(dmap);

  if (!from || !to) {
    document.getElementById("routeSummary").textContent =
      "One of the addresses wasn't recognised. Use the navigation buttons below.";
    return;
  }

  // Ask the backend for the actual driving route along real roads.
  const res = await fetch(
    API + "/api/route?from=" + from.lat + "," + from.lon + "&to=" + to.lat + "," + to.lon
  );
  const route = await res.json();

  if (!route.found) {
    document.getElementById("routeSummary").textContent =
      "Route unavailable right now. Use the navigation buttons below.";
    L.polyline([[from.lat, from.lon], [to.lat, to.lon]], {
      color: "#d9a526", weight: 3, dashArray: "6 8",
    }).addTo(dmap);
    return;
  }

  // The road-following line, drawn twice: a dark casing under a gold line,
  // so it stays readable over both light and dark map areas.
  L.polyline(route.line, { color: "#05080d", weight: 9, opacity: .9 }).addTo(dmap);
  routeLine = L.polyline(route.line, { color: "#d9a526", weight: 5 }).addTo(dmap);
  dmap.fitBounds(routeLine.getBounds(), { padding: [40, 40] });

  const hrs = Math.floor(route.durationMin / 60);
  const mins = route.durationMin % 60;
  document.getElementById("routeSummary").textContent =
    route.distanceKm + " km \u2022 about " + (hrs ? hrs + " hr " : "") + mins + " min driving";

  routeSteps = route.steps;
  renderSteps();
}

function renderSteps() {
  const list = document.getElementById("stepList");
  list.innerHTML = "";
  routeSteps.forEach((step) => {
    const li = document.createElement("li");
    const distance =
      step.distance >= 1000
        ? (step.distance / 1000).toFixed(1) + " km"
        : step.distance + " m";
    li.innerHTML = '<span class="step-text"></span><span class="step-dist"></span>';
    li.querySelector(".step-text").textContent = step.text;
    li.querySelector(".step-dist").textContent = distance;
    list.appendChild(li);
  });
  document.getElementById("stepsWrap").hidden = routeSteps.length === 0;
}

async function geocode(address) {
  try {
    const res = await fetch(API + "/api/geocode?q=" + encodeURIComponent(address));
    const data = await res.json();
    return data.found ? data : null;
  } catch { return null; }
}

/* ---------- 4. Live position sharing --------------------------------------- */

$("followMe").addEventListener("change", (e) => { followMe = e.target.checked; });

$("shareBtn").addEventListener("click", () => (watchId === null ? startSharing() : stopSharing()));

function startSharing() {
  if (!navigator.geolocation) {
    say("panicStatus", "This phone won't give the browser its location. Use Chrome or Safari.", "bad");
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      lastFix = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        speed: position.coords.speed,
        accuracy: position.coords.accuracy,
      };
      showDriverDot();
    },
    (error) => {
      say("panicStatus", "Location is off: " + error.message + ". Turn on GPS and allow this page.", "bad");
      stopSharing();
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
  );

  sendTimer = setInterval(pushPosition, 20000);
  pushPosition();

  $("shareBtn").textContent = "Stop";
  $("liveBadge").textContent = "Sharing live";
  $("liveBadge").className = "pill live";
}

function stopSharing() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  clearInterval(sendTimer);
  watchId = null;
  sendTimer = null;
  $("shareBtn").textContent = "Start";
  $("liveBadge").textContent = "Not sharing";
  $("liveBadge").className = "pill";
}

async function pushPosition() {
  if (!trip || !lastFix) return;
  try {
    await fetch(API + "/api/trips/" + trip.reference + "/location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lastFix),
    });
    $("lastPing").textContent = new Date().toLocaleTimeString("en-ZA");
  } catch {
    $("lastPing").textContent = "Failed \u2014 check signal";
  }
}

function showDriverDot() {
  if (!dmap || !lastFix) return;
  const here = [lastFix.lat, lastFix.lon];
  if (driverDot) driverDot.setLatLng(here);
  else {
    driverDot = L.circleMarker(here, {
      radius: 9, color: "#05080d", weight: 3, fillColor: "#4da3ff", fillOpacity: 1,
    }).addTo(dmap).bindTooltip("You");
  }
  if (followMe) dmap.setView(here, Math.max(dmap.getZoom(), 15));
}

/* ---------- 5. Emergency alert --------------------------------------------- */

$("panicBtn").addEventListener("click", async () => {
  if (!confirm("Send an emergency alert to the office now?")) return;

  say("panicStatus", "Sending alert\u2026");
  try {
    const res = await fetch(API + "/api/trips/" + trip.reference + "/panic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position: lastFix, at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error("Alert failed to send.");
    say("panicStatus", "Alert sent. The office has your position. Phone 10111 if you are in danger.", "ok");
  } catch (err) {
    say("panicStatus", err.message + " Phone the office on 076 835 0887 now.", "bad");
  }
});

/* ---------- 6. Finish the trip --------------------------------------------- */

$("arrivedBtn").addEventListener("click", async () => {
  stopSharing();
  await fetch(API + "/api/trips/" + trip.reference + "/complete", { method: "POST" });
  say("panicStatus", "Trip closed. Sharing has stopped.", "ok");
});
