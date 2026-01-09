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

const OVERLAY_OPACITY_RANGE = {
  min: 0,
  max: 1,
  step: 0.05,
};

const MENU_TEXT_SCALE_RANGE = {
  min: 0.85,
  max: 1.4,
  step: 0.05,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseOverlayScale(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

let currentTrackedSites = [];

function applyMenuTextScale(scale) {
  const safeScale = Number.isFinite(scale) ? scale : 1;
  document.body.style.fontSize = `${safeScale}em`;
}

function renderTimes(trackedSites, times, key) {
  const dateKey = document.getElementById("dateKey");
  if (dateKey) {
    dateKey.textContent = key ? `Totals for ${key}` : "Totals for today";
  }

  const list = document.getElementById("list");
  if (!list) return;
  list.innerHTML = "";

  trackedSites
    .map(normalizeTrackedEntry)
    .filter(Boolean)
    .map((site) => ({
      site,
      time: times[site] || 0,
    }))
    .sort((a, b) => b.time - a.time)
    .forEach((site) => {
      const { site: siteKey, time } = site;
      const row = document.createElement("div");
      row.className = "site";
      const left = document.createElement("div");
      left.textContent = siteKey;
      const right = document.createElement("div");
      right.textContent = fmt(time);
      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    });

  if (!trackedSites.length) {
    list.innerHTML = `<div class="muted">Add sites above to start tracking.</div>`;
  }
}

function renderCurrentSiteTotal(data) {
  const currentSite = document.getElementById("currentSiteTotal");
  if (!currentSite) return;
  currentSite.innerHTML = "";
  if (!data?.tracked) {
    currentSite.innerHTML = `<span class="muted">Not tracked</span>`;
    return;
  }
  const left = document.createElement("div");
  left.textContent = data.siteKey || "Current site";
  const right = document.createElement("div");
  right.textContent = fmt(data.totalMs || 0);
  currentSite.appendChild(left);
  currentSite.appendChild(right);
}

async function load() {
  chrome.runtime.sendMessage({ type: "POPUP_OPEN" }).catch(() => {});
  const settingsRes = await chrome.runtime.sendMessage({
    type: "GET_SETTINGS",
  });
  const timesRes = await chrome.runtime.sendMessage({
    type: "GET_TODAY_TIMES",
  });
  const currentSiteRes = await chrome.runtime.sendMessage({
    type: "GET_ACTIVE_SITE_TOTAL",
  });

  const trackedSites = settingsRes?.settings?.trackedSites || [];
  const overlayEnabled = !!settingsRes?.settings?.overlayEnabled;
  const overlayScale = Number.isFinite(settingsRes?.settings?.overlayScale)
    ? settingsRes.settings.overlayScale
    : 1;
  const overlayBackgroundColor =
    settingsRes?.settings?.overlayBackgroundColor || "#7a7a7a";
  const overlayTextColor =
    settingsRes?.settings?.overlayTextColor || "#f7f7f7";
  const overlayBackgroundOpacity = Number.isFinite(
    settingsRes?.settings?.overlayBackgroundOpacity,
  )
    ? settingsRes.settings.overlayBackgroundOpacity
    : 0.85;
  const menuTextScale = Number.isFinite(settingsRes?.settings?.menuTextScale)
    ? settingsRes.settings.menuTextScale
    : 1;
  document.getElementById("overlayEnabled").checked = overlayEnabled;
  document.getElementById("trackedSites").value = trackedSites.join("\n");
  currentTrackedSites = trackedSites;
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
  const overlayBackgroundColorInput = document.getElementById(
    "overlayBackgroundColor",
  );
  const overlayTextColorInput = document.getElementById("overlayTextColor");
  const overlayOpacitySlider = document.getElementById("overlayOpacitySlider");
  const overlayOpacityInput = document.getElementById("overlayOpacityInput");
  const menuTextScaleSlider = document.getElementById("menuTextScaleSlider");
  const menuTextScaleInput = document.getElementById("menuTextScaleInput");
  if (overlayBackgroundColorInput) {
    overlayBackgroundColorInput.value = overlayBackgroundColor;
  }
  if (overlayTextColorInput) {
    overlayTextColorInput.value = overlayTextColor;
  }
  if (overlayOpacitySlider && overlayOpacityInput) {
    const clampedOpacity = clamp(
      overlayBackgroundOpacity,
      OVERLAY_OPACITY_RANGE.min,
      OVERLAY_OPACITY_RANGE.max,
    );
    overlayOpacitySlider.value = String(clampedOpacity);
    overlayOpacityInput.value = String(overlayBackgroundOpacity);
  }
  if (menuTextScaleSlider && menuTextScaleInput) {
    const clampedScale = clamp(
      menuTextScale,
      MENU_TEXT_SCALE_RANGE.min,
      MENU_TEXT_SCALE_RANGE.max,
    );
    menuTextScaleSlider.value = String(clampedScale);
    menuTextScaleInput.value = String(menuTextScale);
  }
  const key = timesRes?.key || "";
  const times = timesRes?.times || {};
  renderTimes(trackedSites, times, key);
  renderCurrentSiteTotal(currentSiteRes?.ok ? currentSiteRes : { tracked: false });
  applyMenuTextScale(menuTextScale);

  renderVersionInfo();
}

let saveTimer = null;
let refreshTimer = null;

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
  const overlayBackgroundColorInput = document.getElementById(
    "overlayBackgroundColor",
  );
  const overlayTextColorInput = document.getElementById("overlayTextColor");
  const overlayOpacitySlider = document.getElementById("overlayOpacitySlider");
  const overlayOpacityInput = document.getElementById("overlayOpacityInput");
  const menuTextScaleSlider = document.getElementById("menuTextScaleSlider");
  const menuTextScaleInput = document.getElementById("menuTextScaleInput");
  const overlayScale = parseOverlayScale(
    overlaySizeInput?.value,
    parseOverlayScale(overlaySizeSlider?.value, 1),
  );
  const overlayBackgroundColor = overlayBackgroundColorInput?.value;
  const overlayTextColor = overlayTextColorInput?.value;
  const overlayBackgroundOpacity = parseOverlayScale(
    overlayOpacityInput?.value,
    parseOverlayScale(overlayOpacitySlider?.value, 0.85),
  );
  const menuTextScale = parseOverlayScale(
    menuTextScaleInput?.value,
    parseOverlayScale(menuTextScaleSlider?.value, 1),
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
    overlayBackgroundColor,
    overlayTextColor,
    overlayBackgroundOpacity,
    menuTextScale,
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

async function refreshTimes() {
  const timesRes = await chrome.runtime.sendMessage({
    type: "GET_TODAY_TIMES",
  });
  if (!timesRes?.ok) return;
  renderTimes(currentTrackedSites, timesRes.times || {}, timesRes.key || "");
  const currentSiteRes = await chrome.runtime.sendMessage({
    type: "GET_ACTIVE_SITE_TOTAL",
  });
  if (currentSiteRes?.ok) {
    renderCurrentSiteTotal(currentSiteRes);
  }
}

document.getElementById("reset").addEventListener("click", resetToday);

const overlaySizeSlider = document.getElementById("overlaySizeSlider");
const overlaySizeInput = document.getElementById("overlaySizeInput");
const overlayEnabled = document.getElementById("overlayEnabled");
const trackedSitesInput = document.getElementById("trackedSites");
const overlayBackgroundColorInput =
  document.getElementById("overlayBackgroundColor");
const overlayTextColorInput = document.getElementById("overlayTextColor");
const overlayOpacitySlider = document.getElementById("overlayOpacitySlider");
const overlayOpacityInput = document.getElementById("overlayOpacityInput");
const menuTextScaleSlider = document.getElementById("menuTextScaleSlider");
const menuTextScaleInput = document.getElementById("menuTextScaleInput");
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

if (overlayBackgroundColorInput) {
  overlayBackgroundColorInput.addEventListener("input", () => {
    scheduleSave();
  });
}

if (overlayTextColorInput) {
  overlayTextColorInput.addEventListener("input", () => {
    scheduleSave();
  });
}

if (overlayOpacitySlider && overlayOpacityInput) {
  overlayOpacitySlider.min = String(OVERLAY_OPACITY_RANGE.min);
  overlayOpacitySlider.max = String(OVERLAY_OPACITY_RANGE.max);
  overlayOpacitySlider.step = String(OVERLAY_OPACITY_RANGE.step);

  overlayOpacitySlider.addEventListener("input", () => {
    const value = parseOverlayScale(overlayOpacitySlider.value, 0.85);
    overlayOpacityInput.value = String(value);
    scheduleSave();
  });

  overlayOpacityInput.addEventListener("input", () => {
    const value = parseOverlayScale(overlayOpacityInput.value, NaN);
    if (!Number.isFinite(value)) return;
    const clamped = clamp(
      value,
      OVERLAY_OPACITY_RANGE.min,
      OVERLAY_OPACITY_RANGE.max,
    );
    overlayOpacitySlider.value = String(clamped);
    scheduleSave();
  });
}

if (overlayEnabled) {
  overlayEnabled.addEventListener("change", () => {
    scheduleSave();
  });
}

if (menuTextScaleSlider && menuTextScaleInput) {
  menuTextScaleSlider.min = String(MENU_TEXT_SCALE_RANGE.min);
  menuTextScaleSlider.max = String(MENU_TEXT_SCALE_RANGE.max);
  menuTextScaleSlider.step = String(MENU_TEXT_SCALE_RANGE.step);

  menuTextScaleSlider.addEventListener("input", () => {
    const value = parseOverlayScale(menuTextScaleSlider.value, 1);
    menuTextScaleInput.value = String(value);
    applyMenuTextScale(value);
    scheduleSave();
  });

  menuTextScaleInput.addEventListener("input", () => {
    const value = parseOverlayScale(menuTextScaleInput.value, NaN);
    if (!Number.isFinite(value)) return;
    const clamped = clamp(
      value,
      MENU_TEXT_SCALE_RANGE.min,
      MENU_TEXT_SCALE_RANGE.max,
    );
    menuTextScaleSlider.value = String(clamped);
    applyMenuTextScale(clamped);
    scheduleSave();
  });
}


if (trackedSitesInput) {
  trackedSitesInput.addEventListener("input", () => {
    scheduleSave();
  });
}

load().then(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshTimes, 1000);
});

window.addEventListener("unload", () => {
  chrome.runtime.sendMessage({ type: "POPUP_CLOSED" }).catch(() => {});
});
