const STORAGE_KEY = "linkedinScraperResults";

const scrapeButton = document.querySelector("#scrape");
const copyButton = document.querySelector("#copy");
const downloadButton = document.querySelector("#download");
const clearButton = document.querySelector("#clear");
const statusEl = document.querySelector("#status");
const summaryEl = document.querySelector("#summary");
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
  renderSummary(latest);
  outputEl.textContent = JSON.stringify(latest || {}, null, 2);
  const hasResults = results.length > 0;
  copyButton.disabled = !hasResults;
  downloadButton.disabled = !hasResults;
  clearButton.disabled = !hasResults;
}

function renderSummary(record) {
  summaryEl.replaceChildren();
  summaryEl.hidden = !record;

  if (!record) return;

  if (record.pageType === "profile" && record.profile) {
    renderProfileSummary(record.profile);
    return;
  }

  renderGenericSummary(record);
}

function renderProfileSummary(profile) {
  const hero = element("div", "profile-hero");
  hero.append(createAvatar(profile.name, getProfilePhoto(profile)));

  const heroText = element("div", "profile-hero-text");
  heroText.append(
    element("h2", "profile-name", profile.name || "LinkedIn profile"),
    element("p", "profile-headline", profile.headline || "No headline captured")
  );

  if (profile.location) {
    heroText.append(element("p", "profile-location", profile.location));
  }

  hero.append(heroText);
  summaryEl.append(hero);

  const stats = element("div", "stat-grid");
  [
    ["Experience", asArray(profile.experience).length],
    ["Education", asArray(profile.education).length],
    ["Skills", asArray(profile.skills).length]
  ].forEach(([label, count]) => stats.append(createStat(label, count)));
  summaryEl.append(stats);

  if (profile.about) {
    const about = element("article", "summary-card");
    about.append(element("h3", "", "About"), element("p", "summary-text", clamp(profile.about, 260)));
    summaryEl.append(about);
  }

  appendProfileSection("Experience", asArray(profile.experience), formatExperienceItem);
  appendProfileSection("Education", asArray(profile.education), formatEducationItem);
  appendSkillsSection(asArray(profile.skills));
}

function renderGenericSummary(record) {
  const payload = record[record.pageType] || record.generic || {};
  const title = payload.name || payload.title || payload.heading || record.documentTitle || "Latest scrape";
  const subtitle = payload.headline || payload.tagline || payload.company || payload.location || record.sourceUrl || "";
  const card = element("article", "summary-card");

  card.append(element("h2", "profile-name", title));
  if (subtitle) card.append(element("p", "profile-headline", subtitle));
  card.append(element("p", "summary-text", `${record.pageType} page scraped at ${new Date(record.scrapedAt).toLocaleString()}.`));
  summaryEl.append(card);
}

function appendProfileSection(title, items, formatter) {
  if (!items.length) return;

  const section = element("article", "summary-card");
  section.append(createSectionHeading(title, items.length));
  const list = element("div", "summary-list");

  items.slice(0, 3).forEach((item) => {
    const formatted = formatter(item);
    const row = element("div", "summary-item");
    row.append(element("strong", "", formatted.title));
    if (formatted.meta) row.append(element("span", "summary-meta", formatted.meta));
    if (formatted.detail) row.append(element("p", "summary-text", clamp(formatted.detail, 160)));
    list.append(row);
  });

  section.append(list);
  summaryEl.append(section);
}

function appendSkillsSection(skills) {
  if (!skills.length) return;

  const section = element("article", "summary-card");
  section.append(createSectionHeading("Skills", skills.length));
  const chips = element("div", "chip-list");

  skills.slice(0, 12).forEach((skill) => {
    const name = typeof skill === "string" ? skill : skill.name;
    if (name) chips.append(element("span", "chip", name));
  });

  section.append(chips);
  summaryEl.append(section);
}

function formatExperienceItem(item) {
  if (typeof item === "string") {
    return { title: item, meta: "", detail: "" };
  }

  return {
    title: item.title || item.company || "Experience",
    meta: [item.company, item.employmentType, item.dateRange, item.location].filter(Boolean).join(" · "),
    detail: item.description || ""
  };
}

function formatEducationItem(item) {
  if (typeof item === "string") {
    return { title: item, meta: "", detail: "" };
  }

  return {
    title: item.school || item.degree || "Education",
    meta: [item.degree, item.fieldOfStudy, item.dateRange].filter(Boolean).join(" · "),
    detail: item.description || ""
  };
}

function createAvatar(name, imageUrl) {
  const avatar = element("div", "avatar");

  if (isHttpUrl(imageUrl)) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = name ? `${name} profile photo` : "Profile photo";
    image.addEventListener("error", () => {
      image.remove();
      avatar.classList.add("avatar-fallback");
      avatar.textContent = initials(name);
    }, { once: true });
    avatar.append(image);
  } else {
    avatar.classList.add("avatar-fallback");
    avatar.textContent = initials(name);
  }

  return avatar;
}

function createStat(label, count) {
  const stat = element("div", "stat");
  stat.append(element("strong", "", String(count)), element("span", "", label));
  return stat;
}

function createSectionHeading(title, count) {
  const heading = element("div", "section-heading");
  heading.append(element("h3", "", title), element("span", "", String(count)));
  return heading;
}

function getProfilePhoto(profile) {
  return profile.profilePicture?.url || profile.profileImage || "";
}

function element(tag, className = "", textContent = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent) node.textContent = textContent;
  return node;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, length) {
  const text = String(value || "");
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function initials(value) {
  const parts = String(value || "LinkedIn")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return parts.map((part) => part[0]?.toUpperCase()).join("") || "LI";
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function setBusy(isBusy) {
  scrapeButton.disabled = isBusy;
  scrapeButton.textContent = isBusy ? "Scraping..." : "Scrape current page";
}

function setStatus(message) {
  statusEl.textContent = message;
}
