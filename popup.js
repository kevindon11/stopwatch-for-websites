function fmt(ms) {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0",
  )}:${String(seconds).padStart(2, "0")}`;
}

function normalizeHost(hostname) {
  return (hostname || "").toLowerCase().replace(/^www\./, "");
}

function normalizePath(pathname) {
  if (!pathname || pathname === "/") return "";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "/" ? "" : trimmed;
}

function normalizeTrackedEntry(entry) {
  const raw = entry?.trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  const host = normalizeHost(url.hostname);
  if (!host) return "";
  const path = normalizePath(url.pathname);
  return `${host}${path}`;
}

function renderVersionInfo() {
  const manifest = chrome.runtime.getManifest();
  const version = manifest?.version || "unknown";
  const versionName = manifest?.version_name || "unknown";
  const versionEl = document.getElementById("version");
  const buildEl = document.getElementById("buildTime");
  if (versionEl) versionEl.textContent = `Version: ${version}`;
  if (buildEl) buildEl.textContent = `Built: ${versionName}`;
}

const OVERLAY_SCALE_RANGE = {
  min: 0.6,
  max: 2,
  step: 0.05,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseOverlayScale(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function load() {
  const settingsRes = await chrome.runtime.sendMessage({
    type: "GET_SETTINGS",
  });
  const timesRes = await chrome.runtime.sendMessage({
    type: "GET_TODAY_TIMES",
  });

  const trackedSites = settingsRes?.settings?.trackedSites || [];
  const overlayEnabled = !!settingsRes?.settings?.overlayEnabled;
  const overlayScale = Number.isFinite(settingsRes?.settings?.overlayScale)
    ? settingsRes.settings.overlayScale
    : 1;

  document.getElementById("overlayEnabled").checked = overlayEnabled;
  document.getElementById("trackedSites").value = trackedSites.join("\n");
  const overlaySizeSlider = document.getElementById("overlaySizeSlider");
  const overlaySizeInput = document.getElementById("overlaySizeInput");
  if (overlaySizeSlider && overlaySizeInput) {
    const clamped = clamp(
      overlayScale,
      OVERLAY_SCALE_RANGE.min,
      OVERLAY_SCALE_RANGE.max,
    );
    overlaySizeSlider.value = String(clamped);
    overlaySizeInput.value = String(overlayScale);
  }

  const key = timesRes?.key || "";
  document.getElementById("dateKey").textContent = key
    ? `Totals for ${key}`
    : "Totals for today";

  const times = timesRes?.times || {};
  const list = document.getElementById("list");
  list.innerHTML = "";

  trackedSites
    .map(normalizeTrackedEntry)
    .filter(Boolean)
    .forEach((site) => {
      const row = document.createElement("div");
      row.className = "site";
      const left = document.createElement("div");
      left.textContent = site;
      const right = document.createElement("div");
      right.textContent = fmt(times[site] || 0);
      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    });

  if (!trackedSites.length) {
    list.innerHTML = `<div class="muted">Add sites above to start tracking.</div>`;
  }

  renderVersionInfo();
}

let saveTimer = null;

function setStatus(message) {
  const status = document.getElementById("status");
  status.textContent = message;
}

async function saveSettings() {
  setStatus("Saving...");

  const overlayEnabled = document.getElementById("overlayEnabled").checked;
  const raw = document.getElementById("trackedSites").value;
  const overlaySizeSlider = document.getElementById("overlaySizeSlider");
  const overlaySizeInput = document.getElementById("overlaySizeInput");
  const overlayScale = parseOverlayScale(
    overlaySizeInput?.value,
    parseOverlayScale(overlaySizeSlider?.value, 1),
  );

  const trackedSites = raw
    .split("\n")
    .map((site) => site.trim())
    .filter(Boolean);

  await chrome.runtime.sendMessage({
    type: "SET_SETTINGS",
    trackedSites,
    overlayEnabled,
    overlayScale,
  });
  setStatus("Saved");
  setTimeout(() => {
    setStatus("");
  }, 900);

  await load();
}

function scheduleSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveSettings();
  }, 300);
}


async function resetToday() {
  const status = document.getElementById("status");
  status.textContent = "Resetting...";
  await chrome.runtime.sendMessage({ type: "RESET_TODAY" });
  status.textContent = "Reset";
  setTimeout(() => {
    status.textContent = "";
  }, 900);
  await load();
}

document.getElementById("reset").addEventListener("click", resetToday);

const overlaySizeSlider = document.getElementById("overlaySizeSlider");
const overlaySizeInput = document.getElementById("overlaySizeInput");
const overlayEnabled = document.getElementById("overlayEnabled");
const trackedSitesInput = document.getElementById("trackedSites");
if (overlaySizeSlider && overlaySizeInput) {
  overlaySizeSlider.min = String(OVERLAY_SCALE_RANGE.min);
  overlaySizeSlider.max = String(OVERLAY_SCALE_RANGE.max);
  overlaySizeSlider.step = String(OVERLAY_SCALE_RANGE.step);

  overlaySizeSlider.addEventListener("input", () => {
    const value = parseOverlayScale(overlaySizeSlider.value, 1);
    overlaySizeInput.value = String(value);
    scheduleSave();
  });

  overlaySizeInput.addEventListener("input", () => {
    const value = parseOverlayScale(overlaySizeInput.value, NaN);
    if (!Number.isFinite(value)) return;
    const clamped = clamp(
      value,
      OVERLAY_SCALE_RANGE.min,
      OVERLAY_SCALE_RANGE.max,
    );
    overlaySizeSlider.value = String(clamped);
    scheduleSave();
  });
}

if (overlayEnabled) {
  overlayEnabled.addEventListener("change", () => {
    scheduleSave();
  });
}

if (trackedSitesInput) {
  trackedSitesInput.addEventListener("input", () => {
    scheduleSave();
  });
}

load();
