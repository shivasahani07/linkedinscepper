const STORAGE_KEY = "linkedinScraperResults";

const scrapeButton = document.querySelector("#scrape");
const copyButton = document.querySelector("#copy");
const downloadButton = document.querySelector("#download");
const clearButton = document.querySelector("#clear");
const statusEl = document.querySelector("#status");
const outputEl = document.querySelector("#output");
const countEl = document.querySelector("#count");
const pageTypeEl = document.querySelector("#pageType");

let results = [];

init();

async function init() {
  results = await getResults();
  render(results.at(-1));
}

scrapeButton.addEventListener("click", async () => {
  setBusy(true);
  setStatus("Reading the visible LinkedIn page...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !tab.url?.startsWith("https://www.linkedin.com/")) {
      throw new Error("Open a linkedin.com page before scraping.");
    }

    const response = await scrapeActiveTab(tab.id);

    if (!response?.ok) {
      throw new Error(response?.error || "The page could not be scraped.");
    }

    const record = response.data;
    results = await getResults();
    results.push(record);
    await chrome.storage.local.set({ [STORAGE_KEY]: results });

    render(record);
    setStatus(`Saved ${record.pageType} page from ${new URL(record.sourceUrl).pathname}.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
});

copyButton.addEventListener("click", async () => {
  const payload = JSON.stringify(results, null, 2);
  await navigator.clipboard.writeText(payload);
  setStatus(`Copied ${results.length} record${results.length === 1 ? "" : "s"} to clipboard.`);
});

downloadButton.addEventListener("click", () => {
  const payload = JSON.stringify(results, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const link = document.createElement("a");

  link.href = url;
  link.download = `linkedin-visible-scrape-${timestamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

clearButton.addEventListener("click", async () => {
  results = [];
  await chrome.storage.local.set({ [STORAGE_KEY]: results });
  render();
  setStatus("Cleared saved scrape results.");
});

async function getResults() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
}

async function scrapeActiveTab(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "SCRAPE_LINKEDIN_PAGE" });
  } catch (error) {
    if (!String(error.message || "").includes("Receiving end does not exist")) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });

    return chrome.tabs.sendMessage(tabId, { type: "SCRAPE_LINKEDIN_PAGE" });
  }
}

function render(latest) {
  countEl.textContent = String(results.length);
  pageTypeEl.textContent = latest?.pageType || "none";
  outputEl.textContent = JSON.stringify(latest || {}, null, 2);
  const hasResults = results.length > 0;
  copyButton.disabled = !hasResults;
  downloadButton.disabled = !hasResults;
  clearButton.disabled = !hasResults;
}

function setBusy(isBusy) {
  scrapeButton.disabled = isBusy;
  scrapeButton.textContent = isBusy ? "Scraping..." : "Scrape current page";
}

function setStatus(message) {
  statusEl.textContent = message;
}
