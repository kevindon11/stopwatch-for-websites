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

async function load() {
  const settingsRes = await chrome.runtime.sendMessage({
    type: "GET_SETTINGS",
  });
  const timesRes = await chrome.runtime.sendMessage({
    type: "GET_TODAY_TIMES",
  });

  const trackedSites = settingsRes?.settings?.trackedSites || [];
  const overlayEnabled = !!settingsRes?.settings?.overlayEnabled;

  document.getElementById("overlayEnabled").checked = overlayEnabled;
  document.getElementById("trackedSites").value = trackedSites.join("\n");

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
    list.innerHTML = `<div class="muted">Add sites above, then Save.</div>`;
  }

  renderVersionInfo();
}

async function save() {
  const status = document.getElementById("status");
  status.textContent = "Saving...";

  const overlayEnabled = document.getElementById("overlayEnabled").checked;
  const raw = document.getElementById("trackedSites").value;

  const trackedSites = raw
    .split("\n")
    .map((site) => site.trim())
    .filter(Boolean);

  await chrome.runtime.sendMessage({
    type: "SET_SETTINGS",
    trackedSites,
    overlayEnabled,
  });
  status.textContent = "Saved";
  setTimeout(() => {
    status.textContent = "";
  }, 900);

  await load();
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

document.getElementById("save").addEventListener("click", save);
document.getElementById("reset").addEventListener("click", resetToday);

load();
