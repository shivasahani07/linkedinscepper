chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SCRAPE_LINKEDIN_PAGE") {
    return false;
  }

  try {
    sendResponse({ ok: true, data: scrapeLinkedInPage() });
  } catch (error) {
    sendResponse({ ok: false, error: error.message });
  }

  return true;
});

function scrapeLinkedInPage() {
  const pageType = detectPageType(location.href);
  const common = {
    id: crypto.randomUUID(),
    pageType,
    sourceUrl: location.href,
    scrapedAt: new Date().toISOString(),
    documentTitle: document.title,
    metadata: getMetadata(),
    jsonLd: getJsonLd()
  };

  if (pageType === "profile") {
    return { ...common, profile: scrapeProfile() };
  }

  if (pageType === "company") {
    return { ...common, company: scrapeCompany() };
  }

  if (pageType === "job") {
    return { ...common, job: scrapeJob() };
  }

  return {
    ...common,
    generic: {
      heading: text("h1"),
      sections: scrapeNamedSections(["About", "Experience", "Education", "Skills", "Details"]),
      visibleText: compactText(document.body?.innerText || "").slice(0, 12000)
    }
  };
}

function detectPageType(url) {
  const { pathname } = new URL(url);

  if (/^\/in\/[^/]+\/?/.test(pathname)) return "profile";
  if (/^\/company\/[^/]+\/?/.test(pathname) || /^\/school\/[^/]+\/?/.test(pathname)) return "company";
  if (pathname.startsWith("/jobs/")) return "job";

  return "unknown";
}

function scrapeProfile() {
  const sections = scrapeNamedSections(["About", "Experience", "Education", "Licenses & certifications", "Skills", "Projects", "Volunteer experience"]);
  const anchors = getUsefulAnchors();

  return cleanObject({
    name: firstText(["main h1", "h1"]),
    headline: firstText([
      "main h1 + div",
      ".text-body-medium.break-words",
      "[data-generated-suggestion-target] ~ div"
    ]),
    location: findNearbyText(["Location", "Contact info"]) || textFromProfileTopCard(2),
    about: sections.About,
    experience: parseListSection(sections.Experience),
    education: parseListSection(sections.Education),
    licensesAndCertifications: parseListSection(sections["Licenses & certifications"]),
    skills: parseListSection(sections.Skills),
    projects: parseListSection(sections.Projects),
    volunteerExperience: parseListSection(sections["Volunteer experience"]),
    contactLinks: anchors.filter((item) => /mailto:|tel:|contact-info|twitter|github|portfolio|website/i.test(item.href)),
    profileImage: meta("og:image")
  });
}

function scrapeCompany() {
  const sections = scrapeNamedSections(["About us", "Overview", "Locations", "Employees at", "Updates", "Jobs"]);
  const facts = scrapeCompanyFacts();

  return cleanObject({
    name: firstText(["main h1", "h1", ".org-top-card-summary__title"]),
    tagline: firstText([".org-top-card-summary__tagline", "main h1 + p", "main h1 + div"]),
    overview: sections["About us"] || sections.Overview,
    website: facts.website || findFirstHref(/https?:\/\/(?!www\.linkedin\.com)/i),
    industry: facts.industry,
    companySize: facts.companySize,
    headquarters: facts.headquarters,
    founded: facts.founded,
    specialties: facts.specialties,
    locations: parseListSection(sections.Locations),
    jobs: parseListSection(sections.Jobs),
    logo: meta("og:image")
  });
}

function scrapeJob() {
  const root = getJobRoot();

  if (!root) {
    return scrapeJobCardFromCollection();
  }

  const sections = scrapeNamedSections(["About the job", "Job description", "Responsibilities", "Qualifications", "Benefits"], root);
  const criteria = scrapeJobCriteria(root);
  const primaryDescription = firstTextWithin(root, [
    ".job-details-jobs-unified-top-card__primary-description-container",
    ".jobs-unified-top-card__primary-description",
    ".jobs-unified-top-card__subtitle-primary-grouping",
    ".jobs-unified-top-card__bullet"
  ]);
  const summary = parseJobSummary(primaryDescription);
  const description = getJobDescription(root, sections);

  return cleanObject({
    title: firstTextWithin(root, [
      ".job-details-jobs-unified-top-card__job-title",
      ".jobs-unified-top-card__job-title",
      "h1"
    ]),
    company: firstTextWithin(root, [
      ".job-details-jobs-unified-top-card__company-name a",
      ".job-details-jobs-unified-top-card__company-name",
      ".jobs-unified-top-card__company-name a",
      ".jobs-unified-top-card__company-name"
    ]),
    location: summary.location || cleanJobSummaryLine(firstTextWithin(root, [
      ".job-details-jobs-unified-top-card__tertiary-description-container",
      ".jobs-unified-top-card__subtitle-primary-grouping",
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".jobs-unified-top-card__bullet"
    ])) || locationFromJobSummary(primaryDescription),
    workplaceType: findTextMatching(/^(remote|hybrid|on-site|onsite)$/i, root),
    description,
    seniorityLevel: criteria["Seniority level"],
    employmentType: criteria["Employment type"],
    jobFunction: criteria["Job function"],
    industries: criteria.Industries,
    applicants: summary.applicants || findTextMatching(/applicants?/i, root),
    posted: summary.posted || findTextMatching(/\b(reposted|posted|ago)\b/i, root),
    applyLinks: getUsefulAnchors(root).filter((item) => /apply|jobs\/view|company/i.test(item.text + item.href))
  });
}

function getJobRoot() {
  const selectors = [
    ".jobs-search__job-details--container",
    ".jobs-search__job-details",
    ".scaffold-layout__detail",
    ".jobs-details",
    ".jobs-details__main-content",
    ".job-view-layout",
    ".jobs-unified-top-card"
  ];

  for (const selector of selectors) {
    const node = document.querySelector(selector);

    if (node && isJobDetailRoot(node)) {
      return node;
    }
  }

  return null;
}

function isJobDetailRoot(node) {
  const value = compactText(node?.innerText || "");
  const hasJobTitle = Boolean(node.querySelector("h1, .job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title"));
  const hasDescription = Boolean(node.querySelector(".jobs-description-content__text, .jobs-description__content, .jobs-box__html-content, .show-more-less-html__markup, #job-details"));
  const hasCriteria = Boolean(node.querySelector(".description__job-criteria-item, .jobs-description-details__list-item"));

  return hasJobTitle || hasDescription || hasCriteria || /\babout the job\b|\bjob description\b/i.test(value);
}

function scrapeJobCardFromCollection() {
  const currentJobId = getCurrentJobId();
  const card = getCurrentJobCard(currentJobId);
  const visibleJobs = getVisibleJobCards()
    .map((item) => parseJobCard(item.card, item.jobId))
    .filter((item) => item.title || item.company || item.jobId);
  const jobUrl = currentJobId ? `https://www.linkedin.com/jobs/view/${currentJobId}/` : "";
  const parsed = parseJobCard(card, currentJobId);
  const selected = parsed.title || parsed.company
    ? parsed
    : visibleJobs.find((item) => item.jobId === currentJobId) || {};

  return cleanObject({
    ...selected,
    jobId: currentJobId,
    jobUrl: selected.jobUrl || jobUrl,
    source: "collection-card",
    visibleJobs,
    note: "Open the job detail page or selected job pane to capture the full description and criteria."
  });
}

function getCurrentJobId() {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get("currentJobId");
  const fromPath = location.pathname.match(/\/jobs\/view\/(\d+)/)?.[1];

  return fromQuery || fromPath || "";
}

function getCurrentJobCard(jobId) {
  if (!jobId) return null;

  const dataNode = document.querySelector([
    `[data-job-id="${CSS.escape(jobId)}"]`,
    `[data-occludable-job-id="${CSS.escape(jobId)}"]`,
    `[data-entity-urn*="${CSS.escape(jobId)}"]`,
    `[data-test-job-id="${CSS.escape(jobId)}"]`
  ].join(", "));

  if (dataNode) {
    const card = dataNode.closest(getJobCardSelector()) || dataNode;
    if (isReasonableJobCard(card)) return card;
  }

  const anchors = [...document.querySelectorAll(`a[href*="${CSS.escape(jobId)}"]`)]
    .filter((anchor) => /\/jobs\//.test(anchor.href));

  for (const anchor of anchors) {
    const card = anchor.closest(getJobCardSelector());

    if (card && isReasonableJobCard(card)) {
      return card;
    }
  }

  return null;
}

function getVisibleJobCards() {
  const seen = new Set();
  const nodes = [...document.querySelectorAll(getJobCardSelector())];

  return nodes
    .map((card) => {
      const jobId = getJobIdFromCard(card);
      const key = jobId || compactText(card.innerText || "").slice(0, 120);

      if (!isReasonableJobCard(card) || seen.has(key)) return null;
      seen.add(key);

      return { card, jobId };
    })
    .filter(Boolean)
    .slice(0, 25);
}

function getJobCardSelector() {
  return [
    ".job-card-container",
    ".jobs-search-results__list-item",
    ".jobs-job-board-list__item",
    ".jobs-job-board-list__item--active",
    ".artdeco-list__item",
    "[data-job-id]",
    "[data-occludable-job-id]",
    "li"
  ].join(", ");
}

function getJobIdFromCard(card) {
  const value = card.getAttribute("data-job-id")
    || card.getAttribute("data-occludable-job-id")
    || card.querySelector("[data-job-id]")?.getAttribute("data-job-id")
    || card.querySelector("[data-occludable-job-id]")?.getAttribute("data-occludable-job-id")
    || card.querySelector("a[href*='/jobs/']")?.href?.match(/(?:currentJobId=|\/jobs\/view\/)(\d+)/)?.[1]
    || "";

  return value.replace(/\D/g, "");
}

function isReasonableJobCard(node) {
  const value = compactText(node?.innerText || "");
  if (!value || value.length > 1400) return false;
  if (/aboutaccessibilityhelp centerprivacy|linkedin corporation/i.test(value)) return false;
  return /posted|promoted|applicants?|easy apply|remote|hybrid|on-site|onsite|viewed|saved|·|\u00b7|•/i.test(value);
}

function parseJobCard(card, fallbackJobId = "") {
  if (!card) return {};

  const lines = dedupeLines(compactLines(card.innerText || ""));
  const jobLink = [...card.querySelectorAll("a[href*='/jobs/']")]
    .map((anchor) => ({ text: compactText(anchor.innerText || anchor.textContent || ""), href: anchor.href }))
    .find((item) => item.text && /\/jobs\//.test(item.href));
  const title = cleanRepeatedText(firstTextWithin(card, [
    ".job-card-list__title",
    ".job-card-container__link",
    ".jobs-unified-top-card__job-title",
    "a[href*='/jobs/']"
  ]) || jobLink?.text || lines[0] || "");
  const detailsLine = lines.find((line) => line.includes("•") || line.includes("\u00b7")) || "";
  const details = splitJobDetails(detailsLine);
  const company = firstTextWithin(card, [
    ".job-card-container__primary-description",
    ".artdeco-entity-lockup__subtitle",
    "[class*='company-name']"
  ]) || details[0] || lines.find((line) => line !== title && !/posted|promoted|viewed|easy apply|applicants?|actively reviewing/i.test(line)) || "";
  const location = details.find((item, index) => index > 0 && /remote|hybrid|on-site|onsite|,|india|bengaluru|mumbai|delhi|pune|chennai|hyderabad/i.test(item)) || "";
  const salary = details.find((item) => /\d+\s*(k|m|l|inr|usd|eur|gbp|₹|\$)/i.test(item)) || "";
  const workplaceType = location.match(/\(([^)]+)\)/)?.[1] || findLine(lines, /^(remote|hybrid|on-site|onsite)$/i);
  const posted = findLine(lines, /\b(posted|promoted|ago)\b/i);
  const applicants = findLine(lines, /applicants?/i);
  const status = findLine(lines, /viewed|saved|easy apply|be an early applicant|actively reviewing/i);

  return cleanObject({
    title,
    company,
    location,
    workplaceType,
    salary,
    posted,
    applicants,
    status,
    jobId: fallbackJobId || getJobIdFromCard(card),
    jobUrl: jobLink?.href || ""
  });
}

function splitJobDetails(value) {
  return compactText(value)
    .split(/•|\u00b7/)
    .map((item) => compactText(item))
    .filter(Boolean);
}

function getJobDescription(root, sections) {
  const description = firstTextWithin(root, [
    ".jobs-description-content__text",
    ".jobs-description__content",
    ".jobs-box__html-content",
    ".show-more-less-html__markup",
    "#job-details"
  ]);
  const fallback = sections["About the job"] || sections["Job description"] || getLargestTextBlock(root);

  return cleanJobText(description || fallback);
}

function cleanJobText(value) {
  return compactLines(value)
    .filter((line) => !/^(show more|show less|see more|see less|easy apply|apply|save|saved)$/i.test(line))
    .filter((line) => !/^sign in|^join now|^messaging$/i.test(line))
    .join("\n");
}

function locationFromJobSummary(value) {
  const lines = compactLines(value);
  const possibleLocation = lines.find((line) => /,\s*[A-Za-z ]+/.test(line) && !/applicants?|posted|ago/i.test(line));
  return possibleLocation || "";
}

function parseJobSummary(value) {
  const tokens = compactText(value)
    .split(/\n|·|\u00b7/)
    .map((item) => cleanJobSummaryLine(item))
    .filter(Boolean);

  const applicants = tokens.find((item) => /applicants?/i.test(item)) || "";
  const posted = tokens.find((item) => /\b(reposted|posted|ago)\b/i.test(item)) || "";
  const location = tokens.find((item, index) => {
    if (index === 0 && tokens.length > 1) return false;
    if (/applicants?|posted|ago|promoted|actively reviewing/i.test(item)) return false;
    if (/^(remote|hybrid|on-site|onsite|full-time|part-time|contract|temporary|internship)$/i.test(item)) return false;
    return /,|india|united states|united kingdom|canada|australia|singapore|germany|france|netherlands|remote/i.test(item);
  }) || "";

  return cleanObject({ applicants, posted, location });
}

function cleanJobSummaryLine(value) {
  return compactText(value)
    .replace(/\s+Promoted\s*$/i, "")
    .replace(/\s+Actively reviewing applicants\s*$/i, "")
    .trim();
}

function dedupeLines(lines) {
  const seen = new Set();

  return lines.filter((line) => {
    const key = normalizeLabel(line);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findLine(lines, pattern) {
  return lines.find((line) => pattern.test(line)) || "";
}

function cleanRepeatedText(value) {
  const textValue = compactText(value);
  const half = Math.floor(textValue.length / 2);

  if (textValue.length > 4 && textValue.length % 2 === 0 && textValue.slice(0, half) === textValue.slice(half)) {
    return textValue.slice(0, half);
  }

  return textValue;
}

function scrapeNamedSections(names, root = document) {
  const result = {};
  const sections = [...root.querySelectorAll("section, article, div[id*='description'], div[class*='description']")];

  for (const name of names) {
    const section = sections.find((candidate) => {
      const heading = firstTextWithin(candidate, ["h2", "h3", "[aria-hidden='true']"]);
      return normalizeLabel(heading) === normalizeLabel(name) || compactText(candidate.innerText).startsWith(name);
    });

    if (section) {
      result[name] = trimSectionText(section.innerText, name);
    }
  }

  return result;
}

function scrapeCompanyFacts() {
  const textValue = compactText(document.body?.innerText || "");
  const facts = {};

  facts.website = valueAfterLabel(textValue, "Website");
  facts.industry = valueAfterLabel(textValue, "Industry");
  facts.companySize = valueAfterLabel(textValue, "Company size");
  facts.headquarters = valueAfterLabel(textValue, "Headquarters");
  facts.founded = valueAfterLabel(textValue, "Founded");
  facts.specialties = valueAfterLabel(textValue, "Specialties");

  return cleanObject(facts);
}

function scrapeJobCriteria(root = document.body) {
  const labels = ["Seniority level", "Employment type", "Job function", "Industries"];
  const textValue = compactText(root?.innerText || "");
  const criteria = {};

  const items = [...root.querySelectorAll(".description__job-criteria-item, .jobs-description-details__list-item")];
  for (const item of items) {
    const heading = firstTextWithin(item, ["h3", "dt", ".description__job-criteria-subheader"]);
    const value = firstTextWithin(item, ["span", "dd", ".description__job-criteria-text"]);

    if (heading && value) {
      criteria[heading.replace(/:$/, "")] = value;
    }
  }

  for (const label of labels) {
    if (!criteria[label]) {
      criteria[label] = valueAfterLabel(textValue, label);
    }
  }

  return cleanObject(criteria);
}

function parseListSection(sectionText) {
  if (!sectionText) return [];

  return sectionText
    .split(/\n{2,}|(?=\n[A-Z][^\n]{2,80}\n)/)
    .map((item) => compactText(item))
    .filter(Boolean)
    .filter((item) => !/^(show all|see all|show more|show less)$/i.test(item))
    .slice(0, 50);
}

function text(selector) {
  return compactText(document.querySelector(selector)?.innerText || document.querySelector(selector)?.textContent || "");
}

function firstText(selectors) {
  for (const selector of selectors) {
    const value = text(selector);
    if (value) return value;
  }

  return "";
}

function firstTextWithin(root, selectors) {
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    const value = compactText(node?.innerText || node?.textContent || "");
    if (value) return value;
  }

  return "";
}

function textFromProfileTopCard(lineOffset) {
  const topCard = document.querySelector("main section");
  const lines = compactLines(topCard?.innerText || "");
  return lines[lineOffset] || "";
}

function findNearbyText(labels) {
  const lines = compactLines(document.body?.innerText || "");

  for (const label of labels) {
    const index = lines.findIndex((line) => normalizeLabel(line) === normalizeLabel(label));
    if (index > 0) return lines[index - 1];
  }

  return "";
}

function findTextMatching(pattern, root = document.body) {
  return compactLines(root?.innerText || "").find((line) => pattern.test(line)) || "";
}

function valueAfterLabel(textValue, label) {
  const lines = compactLines(textValue);
  const index = lines.findIndex((line) => normalizeLabel(line) === normalizeLabel(label));

  if (index >= 0 && lines[index + 1]) {
    return lines[index + 1];
  }

  const inlinePattern = new RegExp(`${escapeRegExp(label)}\\s+([^\\n]+)`, "i");
  return textValue.match(inlinePattern)?.[1]?.trim() || "";
}

function getLargestTextBlock(scope) {
  const root = typeof scope === "string" ? document.querySelector(scope) : scope;
  const activeScope = root || document.body;
  const blocks = [...activeScope.querySelectorAll("article, section, div, p")]
    .map((node) => compactText(node.innerText || ""))
    .filter((value) => value.length > 120)
    .sort((a, b) => b.length - a.length);

  return blocks[0] || "";
}

function trimSectionText(value, heading) {
  return compactLines(value)
    .filter((line) => normalizeLabel(line) !== normalizeLabel(heading))
    .filter((line) => !/^(show all|see all|show more|show less)$/i.test(line))
    .join("\n");
}

function getMetadata() {
  return cleanObject({
    title: meta("og:title") || document.title,
    description: meta("og:description") || meta("description"),
    image: meta("og:image"),
    canonical: document.querySelector("link[rel='canonical']")?.href || ""
  });
}

function meta(name) {
  return document.querySelector(`meta[property='${name}'], meta[name='${name}']`)?.content?.trim() || "";
}

function getJsonLd() {
  return [...document.querySelectorAll("script[type='application/ld+json']")]
    .map((script) => {
      try {
        return JSON.parse(script.textContent);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getUsefulAnchors(root = document) {
  const seen = new Set();

  return [...root.querySelectorAll("a[href]")]
    .map((anchor) => ({
      text: compactText(anchor.innerText || anchor.textContent || ""),
      href: anchor.href
    }))
    .filter((item) => item.href && !seen.has(item.href) && seen.add(item.href))
    .slice(0, 100);
}

function findFirstHref(pattern) {
  return getUsefulAnchors().find((item) => pattern.test(item.href))?.href || "";
}

function compactLines(value) {
  return String(value || "")
    .split("\n")
    .map((line) => compactText(line))
    .filter(Boolean);
}

function compactText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLabel(value) {
  return compactText(value).replace(/:$/, "").toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (Array.isArray(entry)) return entry.length > 0;
      if (entry && typeof entry === "object") return Object.keys(entry).length > 0;
      return Boolean(entry);
    })
  );
}
