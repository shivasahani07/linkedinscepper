chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SCRAPE_LINKEDIN_PAGE") {
    return false;
  }

  scrapeLinkedInPageWithExpansion()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function scrapeLinkedInPageWithExpansion() {
  await expandVisibleProfileContent();
  return scrapeLinkedInPage();
}

async function expandVisibleProfileContent() {
  for (let pass = 0; pass < 2; pass += 1) {
    const clicked = clickVisibleShowMoreButtons();
    if (!clicked) return;
    await delay(250);
  }
}

function clickVisibleShowMoreButtons() {
  const buttons = [...document.querySelectorAll("button, [role='button']")];
  let clicked = 0;

  for (const button of buttons) {
    if (!isVisibleElement(button) || button.disabled || button.getAttribute("aria-disabled") === "true") {
      continue;
    }

    const label = compactText(button.innerText || button.textContent || button.getAttribute("aria-label") || "")
      .replace(/^…\s*/, "")
      .replace(/^\.\.\.\s*/, "");
    if (!/^(see more|show more|more)\b/i.test(label)) {
      continue;
    }

    button.click();
    clicked += 1;
  }

  return clicked;
}

function isVisibleElement(node) {
  const style = getComputedStyle(node);
  const rect = node.getBoundingClientRect();
  return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  const profilePicture = getProfilePicture();

  return cleanObject({
    name: firstText(["main h1", "h1"]) || nameFromDocumentTitle(),
    headline: firstText([
      "main h1 + div",
      ".text-body-medium.break-words",
      "[data-generated-suggestion-target] ~ div"
    ]),
    location: cleanProfileLocation(findNearbyText(["Location", "Contact info"]) || textFromProfileTopCard(2)),
    profileUrl: document.querySelector("link[rel='canonical']")?.href || location.href,
    about: sections.About,
    experience: scrapeExperienceSection(),
    education: scrapeEducationSection(),
    licensesAndCertifications: scrapeCertificationSection(),
    skills: scrapeSkillsSection(),
    projects: scrapeGenericProfileSection("Projects"),
    volunteerExperience: scrapeGenericProfileSection("Volunteer experience"),
    contactLinks: anchors.filter((item) => /mailto:|tel:|contact-info|twitter|github|portfolio|website/i.test(item.href)),
    profilePicture,
    profileImage: profilePicture.url || meta("og:image")
  });
}

function scrapeCompany() {
  const sections = scrapeNamedSections(["About us", "Overview", "Locations", "Employees at", "Updates", "Jobs"]);
  const facts = scrapeCompanyFacts();
  const overview = sections["About us"] || sections.Overview || companyOverviewFromLines();

  return cleanObject({
    name: cleanCompanyName(firstText(["main h1", "h1", ".org-top-card-summary__title"]) || companyNameFromDocumentTitle() || companyNameFromUrl()),
    tagline: firstText([".org-top-card-summary__tagline", "main h1 + p", "main h1 + div"]) || companyTaglineFromLines(),
    overview,
    website: facts.website || findCompanyWebsite(),
    industry: facts.industry,
    companySize: facts.companySize,
    headquarters: facts.headquarters,
    founded: facts.founded,
    type: facts.type,
    specialties: facts.specialties,
    followers: facts.followers,
    employeesOnLinkedIn: facts.employeesOnLinkedIn,
    companyUrl: document.querySelector("link[rel='canonical']")?.href || location.href,
    locations: parseListSection(sections.Locations || companySectionAfterLabel("Locations")),
    jobs: parseListSection(sections.Jobs),
    logo: getCompanyLogo(),
    bannerImage: getCompanyBannerImage()
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

  for (const name of names) {
    const section = findNamedSection(name, root);

    if (section) {
      result[name] = trimSectionText(section.innerText, name);
    }
  }

  return result;
}

function findNamedSection(name, root = document) {
  const sections = [...root.querySelectorAll("section, article, div[id*='description'], div[class*='description']")];

  return sections.find((candidate) => {
    const heading = firstTextWithin(candidate, ["h2", "h3", "[aria-hidden='true']"]);
    return normalizeLabel(heading) === normalizeLabel(name) || compactText(candidate.innerText).startsWith(name);
  }) || null;
}

function scrapeExperienceSection() {
  return getGroupedProfileSectionItems("Experience", groupDatedProfileItems)
    .map(parseExperienceItem)
    .filter((item) => item.title || item.company || item.raw);
}

function scrapeEducationSection() {
  return getGroupedProfileSectionItems("Education", groupEducationItems)
    .map(parseEducationItem)
    .filter((item) => item.school || item.degree || item.raw);
}

function scrapeCertificationSection() {
  return getGroupedProfileSectionItems("Licenses & certifications", groupCertificationItems)
    .map(parseCertificationItem)
    .filter((item) => item.name || item.issuer || item.raw);
}

function scrapeSkillsSection() {
  const section = findNamedSection("Skills");
  if (!section) return [];

  const nodeItems = getProfileSectionItemNodes(section)
    .map((node) => cleanProfileItemText(node.innerText, "Skills"))
    .filter(Boolean);
  const groupedItems = groupSkillItems(cleanProfileLines(trimSectionText(section.innerText, "Skills"))
    .map((line) => line.replace(/\s+Skill name\s*$/i, "")));
  const rawItems = shouldPreferGroupedLines(nodeItems, groupedItems)
    ? groupedItems
    : nodeItems.length ? nodeItems : groupedItems;

  return rawItems
    .map(parseSkillItem)
    .filter((item) => item.name && !isSkillContextLine(item.name))
    .slice(0, 50);
}

function scrapeGenericProfileSection(name) {
  return getGroupedProfileSectionItems(name, groupDatedProfileItems)
    .map((raw) => cleanObject({ title: compactLines(raw)[0] || "", details: compactLines(raw).slice(1).join("\n"), raw }));
}

function scrapeProfileSection(name) {
  const section = findNamedSection(name);
  if (!section) return [];

  const itemNodes = getProfileSectionItemNodes(section);
  const items = itemNodes.length
    ? itemNodes.map((node) => cleanProfileItemText(node.innerText, name))
    : parseListSection(trimSectionText(section.innerText, name));

  return items.filter(Boolean).slice(0, 50);
}

function getGroupedProfileSectionItems(name, groupItems) {
  const section = findNamedSection(name);
  if (!section) return [];

  const nodeItems = getProfileSectionItemNodes(section)
    .map((node) => cleanProfileItemText(node.innerText, name))
    .filter(Boolean);
  const groupedItems = groupItems(cleanProfileLines(trimSectionText(section.innerText, name)));

  if (shouldPreferGroupedLines(nodeItems, groupedItems)) {
    return groupedItems.slice(0, 50);
  }

  return (nodeItems.length ? nodeItems : groupedItems).slice(0, 50);
}

function shouldPreferGroupedLines(nodeItems, groupedItems) {
  if (!groupedItems.length) return false;
  if (!nodeItems.length) return true;

  const singleLineCount = nodeItems.filter((item) => compactLines(item).length <= 1).length;
  return singleLineCount / nodeItems.length > 0.5 && groupedItems.length < nodeItems.length;
}

function groupDatedProfileItems(lines) {
  const cleaned = lines.filter(Boolean);
  const dateIndexes = cleaned
    .map((line, index) => isProfileDateLine(line) ? index : -1)
    .filter((index) => index >= 0);

  if (!dateIndexes.length) {
    return cleaned;
  }

  return groupLinesByDateAnchors(cleaned, dateIndexes, 2);
}

function groupEducationItems(lines) {
  const datedGroups = groupDatedProfileItems(lines);
  if (datedGroups.length < lines.filter(Boolean).length) {
    return datedGroups;
  }

  const grouped = [];
  let current = [];

  for (const line of lines.filter(Boolean)) {
    current.push(line);

    if (isSkillSummaryLine(line) && current.length > 1) {
      grouped.push(current.join("\n"));
      current = [];
    }
  }

  if (current.length) {
    grouped.push(current.join("\n"));
  }

  return grouped;
}

function groupCertificationItems(lines) {
  const cleaned = lines.filter(Boolean);
  const dateIndexes = cleaned
    .map((line, index) => isCertificationDateLine(line) ? index : -1)
    .filter((index) => index >= 0);

  if (!dateIndexes.length) {
    return cleaned;
  }

  return groupLinesByDateAnchors(cleaned, dateIndexes, 2);
}

function groupLinesByDateAnchors(lines, dateIndexes, titleOffset) {
  const starts = dateIndexes
    .map((index) => normalizeProfileGroupStart(lines, Math.max(0, index - titleOffset), index))
    .filter((start, index, list) => index === 0 || start > list[index - 1]);

  return starts
    .map((start, index) => lines.slice(start, starts[index + 1] || lines.length).join("\n"))
    .filter(Boolean);
}

function normalizeProfileGroupStart(_lines, start, _dateIndex) {
  return start;
}

function groupSkillItems(lines) {
  const grouped = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isSkillContextLine(line)) continue;

    const itemLines = [line];
    while (isSkillContextLine(lines[index + 1])) {
      itemLines.push(lines[index + 1]);
      index += 1;
    }

    grouped.push(itemLines.join("\n"));
  }

  return grouped;
}

function getProfileSectionItemNodes(section) {
  const selectors = [
    "li.pvs-list__paged-list-item",
    "li.artdeco-list__item",
    ".pvs-list__item--line-separated",
    ".pvs-entity"
  ].join(", ");
  const nodes = [...section.querySelectorAll(selectors)]
    .filter((node) => !node.querySelector("section, article"))
    .filter((node) => compactText(node.innerText || "").length > 2);
  const unique = [];

  for (const node of nodes) {
    if (unique.some((existing) => existing.contains(node) || node.contains(existing))) {
      continue;
    }

    unique.push(node);
  }

  return unique;
}

function cleanProfileItemText(value, heading = "") {
  const lines = dedupeLines(compactLines(value))
    .filter((line) => normalizeLabel(line) !== normalizeLabel(heading))
    .filter((line) => !isProfileSectionChrome(line));

  return lines.join("\n");
}

function isProfileSectionChrome(line) {
  return /^(show all|see all|show more|show less|view all|activate to view larger image|company logo|school logo|profile picture)$/i.test(line)
    || /^show all \d+/i.test(line)
    || /^(image|logo)$/i.test(line);
}

function parseExperienceItem(raw) {
  const lines = cleanProfileLines(raw);
  const dateIndex = lines.findIndex(isProfileDateLine);
  const dateLine = dateIndex >= 0 ? lines[dateIndex] : "";
  const beforeDate = dateIndex >= 0 ? lines.slice(0, dateIndex) : lines.slice(0, 2);
  const afterDate = dateIndex >= 0 ? lines.slice(dateIndex + 1) : lines.slice(2);
  const skillSummaries = beforeDate.filter(isSkillSummaryLine);
  const roleLines = beforeDate.filter((line) => !isSkillSummaryLine(line) && !isStandaloneDurationLine(line));
  const leadingLocation = roleLines.length > 1 && isLikelyProfileLocationLine(roleLines[0]) ? roleLines.shift() : "";
  const [title = "", companyLine = ""] = roleLines;
  const dateParts = splitBulletText(dateLine);
  const locationLine = leadingLocation || findProfileLocationLine(afterDate);
  const companyParts = splitBulletText(companyLine);
  const excluded = new Set([
    ...beforeDate,
    dateLine,
    locationLine
  ].filter(Boolean));
  const description = [
    ...skillSummaries,
    ...afterDate.filter((line) => !excluded.has(line))
  ].join("\n");

  return cleanObject({
    title,
    company: companyParts[0] || companyLine,
    employmentType: companyParts.slice(1).join(" · "),
    dateRange: dateParts[0] || dateLine,
    duration: dateParts.slice(1).join(" · "),
    location: locationLine,
    description,
    raw
  });
}

function parseEducationItem(raw) {
  const lines = cleanProfileLines(raw);
  const [school = "", degreeLine = ""] = lines;
  const dateLine = findProfileDateLine(lines);
  const degreeParts = degreeLine ? degreeLine.split(",").map((item) => compactText(item)).filter(Boolean) : [];
  const excluded = new Set([school, degreeLine, dateLine].filter(Boolean));
  const description = lines.filter((line) => !excluded.has(line)).join("\n");

  return cleanObject({
    school,
    degree: degreeParts[0] || degreeLine,
    fieldOfStudy: degreeParts.slice(1).join(", "),
    dateRange: splitBulletText(dateLine)[0] || dateLine,
    description,
    raw
  });
}


function parseCertificationItem(raw) {
  const lines = cleanProfileLines(raw);
  const [name = ""] = lines;
  const issued = lines.find((line) => /^issued\b/i.test(line)) || "";
  const expires = lines.find((line) => /^expires\b/i.test(line)) || "";
  const credentialId = lines.find((line) => /^credential id\b/i.test(line)) || "";
  const issuer = lines.find((line, index) => index > 0 && !isCertificationDateLine(line) && !/^credential/i.test(line)) || "";
  const excluded = new Set([name, issuer, issued, expires, credentialId].filter(Boolean));
  const details = lines.filter((line) => !excluded.has(line)).join("\n");

  return cleanObject({
    name,
    issuer,
    issued,
    expires,
    credentialId: credentialId.replace(/^credential id\s*/i, ""),
    details,
    raw
  });
}

function parseSkillItem(raw) {
  const lines = cleanProfileLines(raw)
    .filter((line) => !/^skill name$/i.test(line));
  const [name = ""] = lines;
  const endorsements = lines.find((line) => /endorsements?/i.test(line)) || "";
  const associatedWith = lines.find((line) => /associated with|used at|featured|\bat\b/i.test(line)) || "";
  const excluded = new Set([name, endorsements, associatedWith].filter(Boolean));
  const details = lines.filter((line) => !excluded.has(line)).join("\n");

  return cleanObject({
    name,
    endorsements,
    associatedWith,
    details,
    raw
  });
}

function cleanProfileLines(raw) {
  return dedupeLines(compactLines(raw))
    .filter((line) => !isProfileSectionChrome(line));
}

function findProfileDateLine(lines) {
  return lines.find(isProfileDateLine) || "";
}

function isProfileDateLine(line) {
  return /\b(present|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|\d{4})\b/i.test(line)
    && /-|–|—|·|\u00b7|\b\d+\s*(yr|yrs|year|years|mo|mos|month|months)\b/i.test(line);
}

function isCertificationDateLine(line) {
  return /^(issued|expires)\b/i.test(line)
    || /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{4}\b/i.test(line);
}

function isSkillContextLine(line) {
  return /^(associated with|used at|featured|endorsed by)\b/i.test(line)
    || /\bendorsements?\b/i.test(line)
    || /\bat\b/i.test(line);
}

function isSkillSummaryLine(line) {
  return /^skills?:/i.test(line) || /\+\d+\s+skills?\b/i.test(line);
}

function isStandaloneDurationLine(line) {
  return /^\d+\s*(yr|yrs|year|years)(\s+\d+\s*(mo|mos|month|months))?$|^\d+\s*(mo|mos|month|months)$/i.test(compactText(line));
}

function isLikelyProfileLocationLine(line) {
  const value = cleanProfileLocation(line);
  if (!value || isSkillSummaryLine(value) || isProfileDateLine(value) || isStandaloneDurationLine(value)) return false;
  if (/skills?|\+\d+|salesforce|architecture|components|developer|workflow|validation|visualforce|data loader|automation|custom objects|process|communication|documentation|training|management|customer|support|onboarding|program|contract|renewals|e-learning|cbt|dashboard|reports?/i.test(value)) return false;
  if (/remote|hybrid|on-site|onsite|metropolitan area|\barea\b|\bregion\b/i.test(value)) return true;
  if (/^[A-Za-z .'-]+,\s*[A-Z]{2}$/.test(value)) return true;
  if (/,/.test(value) && value.length <= 80 && /\b(united states|india|canada|germany|france|california|new york|texas|florida|washington|ca|ny|tx|uk|united kingdom)\b/i.test(value)) return true;
  return false;
}

function findProfileLocationLine(lines, excludedLines = []) {
  const excluded = new Set(excludedLines.filter(Boolean));
  return lines.find((line) => !excluded.has(line) && isLikelyProfileLocationLine(line)) || "";
}

function splitBulletText(value) {
  return compactText(value)
    .split(/·|\u00b7|•/)
    .map((item) => compactText(item))
    .filter(Boolean);
}

function getProfilePicture() {
  const topCard = document.querySelector(".pv-top-card, .ph5, main section") || document.querySelector("main");
  const selectors = [
    "img.pv-top-card-profile-picture__image--show",
    "img.pv-top-card-profile-picture__image",
    ".pv-top-card__photo img",
    ".profile-photo-edit__preview",
    "button img[alt*='profile']",
    "img[alt*='profile']",
    "img[width='200']",
    "img[height='200']",
    "img"
  ];
  const candidates = selectors.flatMap((selector) => [...(topCard || document).querySelectorAll(selector)]);
  const node = candidates.find((image) => {
    const url = imageUrlFromNode(image);
    const alt = compactText(image.alt || "");
    if (!url || /^data:image\/gif/i.test(url)) return false;
    if (/background|cover|company|logo/i.test(alt)) return false;
    return true;
  });
  const url = imageUrlFromNode(node) || meta("og:image");

  return cleanObject({
    url,
    alt: compactText(node?.alt || ""),
    width: node?.naturalWidth || node?.width || "",
    height: node?.naturalHeight || node?.height || ""
  });
}

function imageUrlFromNode(node) {
  if (!node) return "";

  const srcset = node.getAttribute("srcset") || "";
  const srcsetUrl = srcset.split(",").map((entry) => compactText(entry).split(" ")[0]).filter(Boolean).at(-1) || "";

  return node.currentSrc
    || node.src
    || node.getAttribute("data-delayed-url")
    || node.getAttribute("data-src")
    || node.getAttribute("data-ghost-url")
    || srcsetUrl
    || "";
}

function scrapeCompanyFacts() {
  const lines = companyTextLines();
  const summaryFacts = companyHeaderSummaryFacts(lines);
  const facts = {};

  facts.website = firstLikelyCompanyWebsite([
    companyDomValueAfterLabel("Website"),
    companyValueAfterLabel(lines, "Website")
  ]);
  facts.industry = companyDomValueAfterLabel("Industry") || companyValueAfterLabel(lines, "Industry") || summaryFacts.industry;
  facts.companySize = companyDomValueAfterLabel("Company size") || companyValueAfterLabel(lines, "Company size") || summaryFacts.companySize;
  facts.headquarters = companyDomValueAfterLabel("Headquarters") || companyValueAfterLabel(lines, "Headquarters") || summaryFacts.headquarters;
  facts.founded = companyDomValueAfterLabel("Founded") || companyValueAfterLabel(lines, "Founded");
  facts.type = companyDomValueAfterLabel("Type") || companyValueAfterLabel(lines, "Type");
  facts.specialties = companyDomValueAfterLabel("Specialties") || companyValueAfterLabel(lines, "Specialties");
  facts.followers = summaryFacts.followers || findCompanyFactLine(lines, /followers/i);
  facts.employeesOnLinkedIn = findCompanyFactLine(lines, /employees on linkedin|associated members/i);

  return cleanObject(facts);
}

function companyHeaderSummaryFacts(lines) {
  const summaryLine = lines.find((line) => isReasonableCompanyFactLine(line) && /followers/i.test(line) && /employees/i.test(line) && /·|•|\|/.test(line)) || "";
  const parts = splitCompanySummary(summaryLine);

  return cleanObject({
    industry: parts.find((part) => !/followers|employees/i.test(part) && !/,/.test(part)),
    headquarters: parts.find((part) => /,/.test(part) && !/followers|employees/i.test(part)),
    followers: parts.find((part) => /followers/i.test(part)),
    companySize: parts.find((part) => /employees/i.test(part))
  });
}


function companyTextLines() {
  const bodyLines = compactLines(document.body?.innerText || "")
    .filter(isReasonableCompanyTextLine);
  const scopedLines = companyScopedTextLines();
  const combined = dedupeLines([...bodyLines, ...scopedLines]);

  if (combined.length) return combined;

  return dedupeLines([...document.querySelectorAll("main h1, main h2, main h3, main dt, main dd, main span, main p, main a")]
    .flatMap((node) => companyLinesFromNode(node)));
}

function companyScopedTextLines() {
  return dedupeLines([...document.querySelectorAll([
    "main section",
    "main article",
    "main dl",
    "main .artdeco-card",
    "main .org-page-details-module__card-spacing",
    "main [class*='org-page-details']",
    "main [class*='organization']"
  ].join(", "))]
    .flatMap((node) => companyLinesFromNode(node)));
}

function companyLinesFromNode(node) {
  if (!node) return [];

  const innerLines = compactLines(node.innerText || "");
  if (innerLines.length > 1) return innerLines.filter(isReasonableCompanyTextLine);

  const textValue = node.textContent || "";
  if (!textValue || textValue.length > 20000 || /window\.__como_module_cache__/i.test(textValue)) return [];

  return compactLines(textValue).filter(isReasonableCompanyTextLine);
}

function isReasonableCompanyTextLine(line) {
  const value = compactText(line);
  return Boolean(value) && value.length <= 1200 && !/window\.__como_module_cache__|Video Player is loading|Beginning of dialog window|Ad Options|Why am I seeing this ad/i.test(value);
}

function findCompanyFactLine(lines, pattern) {
  return lines.find((line) => pattern.test(line) && isReasonableCompanyFactLine(line)) || "";
}

function isReasonableCompanyFactLine(line) {
  const value = compactText(line);
  return isReasonableCompanyTextLine(value) && value.length <= 240 && !/Activity|Posts|Comments|Images|Profile language|Public profile|People you may know|Who your viewers also viewed/i.test(value);
}

function companyOverviewFromDom() {
  const heading = [...document.querySelectorAll("main h2, main h3, h2, h3")]
    .find((node) => normalizeLabel(node.innerText || node.textContent || "") === "overview");
  if (!heading) return "";

  for (let scope = heading.parentElement; scope && scope !== document.body; scope = scope.parentElement) {
    const lines = companyLinesFromNode(scope);
    if (lines.length < 2) continue;

    const overview = trimCompanySectionLines(lines, "Overview");
    if (overview) return overview;
  }

  return "";
}

function trimCompanySectionLines(lines, label) {
  const stopLabels = getCompanyStopLabels();
  const values = [];
  let started = false;

  for (const line of lines) {
    const normalized = normalizeLabel(line);
    if (!started) {
      started = normalized === normalizeLabel(label);
      continue;
    }

    if (stopLabels.has(normalized) || /^employees at\b/i.test(line)) break;
    if (!isCompanyChromeLine(line)) values.push(line);
  }

  return values.join("\n");
}

function splitCompanySummary(value) {
  return compactText(value)
    .split(/·|•|\|/)
    .map((part) => compactText(part))
    .filter(Boolean);
}

function companyDomValueAfterLabel(label) {
  const selectors = "dt, dd, h2, h3, span, div, p";
  const labelNode = [...document.querySelectorAll(selectors)]
    .find((node) => normalizeLabel(node.innerText || node.textContent || "") === normalizeLabel(label));
  if (!labelNode) return "";

  for (let scope = labelNode.parentElement; scope && scope !== document.body; scope = scope.parentElement) {
    const link = label === "Website" ? [...scope.querySelectorAll("a[href]")].map((anchor) => anchor.href).find(isLikelyCompanyWebsite) : "";
    if (link) return link;

    const lines = companyLinesFromNode(scope);
    const value = companyValueAfterLabel(lines, label);
    if (value && value !== label) return value;
  }

  return "";
}

function companyValueAfterLabel(lines, label) {
  const normalizedLabel = normalizeLabel(label);
  const stopLabels = getCompanyStopLabels();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalized = normalizeLabel(line);

    if (normalized === normalizedLabel) {
      return cleanCompanyFactValue(lines[index + 1] || "");
    }

    if (normalized.startsWith(`${normalizedLabel}:`)) {
      const inlineValue = line.slice(label.length).replace(/^\s*:?\s*/, "");
      if (inlineValue && !stopLabels.has(normalizeLabel(inlineValue))) {
        return cleanCompanyFactValue(inlineValue);
      }
    }
  }

  return "";
}

function cleanCompanyFactValue(value) {
  const cleaned = compactText(value);
  if (!cleaned || isCompanyChromeLine(cleaned) || getCompanyStopLabels().has(normalizeLabel(cleaned))) {
    return "";
  }
  return cleaned;
}

function getCompanyStopLabels() {
  return new Set(["home", "overview", "about", "about us", "services", "products", "website", "industry", "company size", "headquarters", "type", "founded", "specialties", "locations", "updates", "posts", "jobs", "people", "employees at"]);
}

function companyNameFromDocumentTitle() {
  return cleanCompanyName(document.title.replace(/:\s*(about|overview|jobs|people).*$/i, "").replace(/\s*\|\s*LinkedIn.*$/i, ""));
}

function cleanCompanyName(value) {
  return compactText(value).replace(/^\(\d+\)\s*/, "");
}

function companyNameFromUrl() {
  const match = location.pathname.match(/^\/(?:company|school)\/([^/]+)/);
  if (!match) return "";
  return match[1]
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function companyTaglineFromLines() {
  const name = companyNameFromDocumentTitle();
  const lines = companyTextLines();
  const index = lines.findIndex((line) => normalizeLabel(line) === normalizeLabel(name));

  if (index >= 0) {
    return lines.slice(index + 1).find((line) => !isCompanyChromeLine(line) && !getCompanyStopLabels().has(normalizeLabel(line)) && !isExternalCompanyUrl(line) && !/followers|employees/i.test(line)) || "";
  }

  return "";
}

function companyOverviewFromLines() {
  return companyOverviewFromDom() || companySectionAfterLabel("Overview") || companySectionAfterLabel("About us") || companySectionAfterLabel("About");
}

function companySectionAfterLabel(label) {
  const lines = companyTextLines();
  const start = lines.findIndex((line) => normalizeLabel(line) === normalizeLabel(label));
  if (start < 0) return "";

  const stopLabels = getCompanyStopLabels();
  const values = [];

  for (const line of lines.slice(start + 1)) {
    const normalized = normalizeLabel(line);
    if (stopLabels.has(normalized) || /^employees at\b/i.test(line)) break;
    if (!isCompanyChromeLine(line)) values.push(line);
  }

  return values.join("\n");
}

function isCompanyChromeLine(line) {
  return /^(home|about|services|products|posts|jobs|people|show more|show less|follow|following|visit website)$/i.test(line)
    || /^page ·/i.test(line);
}

function findCompanyWebsite() {
  const visibleWebsite = firstLikelyCompanyWebsite([
    companyDomValueAfterLabel("Website"),
    companyValueAfterLabel(companyTextLines(), "Website")
  ]);
  if (visibleWebsite) return visibleWebsite;

  const candidates = [];
  for (const item of getUsefulAnchors()) {
    candidates.push(extractExternalCompanyUrl(item.text));
    candidates.push(extractExternalCompanyUrl(item.href));
    candidates.push(externalUrlFromLinkedInRedirect(item.href));
  }

  return firstLikelyCompanyWebsite(candidates);
}

function firstLikelyCompanyWebsite(candidates) {
  return candidates
    .filter(Boolean)
    .sort((a, b) => companyWebsiteScore(b) - companyWebsiteScore(a))
    .find(isLikelyCompanyWebsite) || "";
}

function externalUrlFromLinkedInRedirect(value) {
  try {
    const url = new URL(value);
    if (!/linkedin\.com$/i.test(url.hostname) && !/\.linkedin\.com$/i.test(url.hostname)) return "";
    const redirected = url.searchParams.get("url") || url.searchParams.get("u") || "";
    return extractExternalCompanyUrl(redirected);
  } catch {
    return "";
  }
}

function extractExternalCompanyUrl(value) {
  const match = compactText(value).match(/https?:\/\/[^\s)]+/i);
  if (!match) return "";
  const candidate = match[0].replace(/[.,;]+$/, "");
  return isExternalCompanyUrl(candidate) ? candidate : "";
}

function isExternalCompanyUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("http") && !/(^|\.)linkedin\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function isLikelyCompanyWebsite(value) {
  return isExternalCompanyUrl(value) && companyWebsiteScore(value) >= 80;
}

function companyWebsiteScore(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    const slug = companySlugFromUrl();
    const name = normalizeWebsiteToken(companyNameFromDocumentTitle() || companyNameFromUrl());

    if (isDisallowedCompanyWebsiteHost(host)) return 0;
    if (slug && host.includes(slug)) return 100;
    if (name && host.includes(name)) return 90;
    if (/\.(com|io|ai|dev|app|co|org|net)$/i.test(host)) return 10;
    return 1;
  } catch {
    return 0;
  }
}

function isDisallowedCompanyWebsiteHost(host) {
  return /(^|\.)(linkedin\.com|google\.com|drive\.google\.com|docs\.google\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|youtu\.be|github\.com|bit\.ly|tinyurl\.com)$/i.test(host);
}

function companySlugFromUrl() {
  return normalizeWebsiteToken(location.pathname.match(/^\/(?:company|school)\/([^/]+)/)?.[1] || "");
}

function normalizeWebsiteToken(value) {
  return compactText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getCompanyLogo() {
  const selectors = [
    ".org-top-card-primary-content__logo img",
    ".org-top-card-primary-content__logo",
    ".org-top-card-summary__logo img",
    "img[src*='company-logo']",
    "img[alt*='logo']"
  ];
  const image = firstCompanyImageUrl(selectors, (url, node) => !isCompanyBannerUrl(url) && isCurrentCompanyImage(node, url));
  const fallback = meta("og:image");
  return image || (!isCompanyBannerUrl(fallback) && isCurrentCompanyImage(null, fallback) ? fallback : "");
}

function getCompanyBannerImage() {
  return firstCompanyImageUrl([
    ".org-top-card__cover-photo img",
    ".profile-background-image__image",
    "img[src*='profile-displaybackgroundimage']"
  ], (url, node) => isCompanyBannerUrl(url) && isVisibleCandidateElement(node)) || (isCompanyBannerUrl(meta("og:image")) ? meta("og:image") : "");
}

function firstCompanyImageUrl(selectors, predicate = Boolean) {
  const roots = companyImageRoots();

  for (const root of roots) {
    for (const selector of selectors) {
      for (const node of root.querySelectorAll(selector)) {
        const url = imageUrlFromNode(node);
        if (url && predicate(url, node)) return url;
      }
    }
  }

  return "";
}

function companyImageRoots() {
  const roots = [];
  const heading = [...document.querySelectorAll("main h1, h1")]
    .find((node) => normalizeLabel(node.innerText || node.textContent || "") === normalizeLabel(companyNameFromDocumentTitle() || companyNameFromUrl()));
  const topCard = heading?.closest?.("section, article, div");
  if (topCard) roots.push(topCard);
  const main = document.querySelector("main");
  if (main && !roots.includes(main)) roots.push(main);
  if (!roots.length) roots.push(document);
  return roots;
}

function isCurrentCompanyImage(node, url) {
  if (!url || isCompanyBannerUrl(url) || !isVisibleCandidateElement(node)) return false;

  const alt = compactText(node?.alt || node?.getAttribute?.("alt") || "");
  const companyToken = normalizeWebsiteToken(companyNameFromDocumentTitle() || companyNameFromUrl());
  const slug = companySlugFromUrl();
  const imageTokenSource = normalizeWebsiteToken(`${alt} ${url}`);

  if (alt && companyToken && !normalizeWebsiteToken(alt).includes(companyToken)) return false;
  if (/company-logo/i.test(url) && (imageTokenSource.includes(slug) || imageTokenSource.includes(companyToken))) return true;
  if (/company-logo/i.test(url) && !alt && !slug && !companyToken) return true;
  if (/company-logo/i.test(url) && !/_[a-z0-9-]*logo/i.test(url)) return true;
  return Boolean(alt && /logo/i.test(alt));
}

function isVisibleCandidateElement(node) {
  if (!node) return true;

  try {
    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") return false;
  } catch {}

  const rect = node.getBoundingClientRect?.();
  if (rect && rect.width === 0 && rect.height === 0) return false;
  return true;
}

function isCompanyBannerUrl(url) {
  return /profile-displaybackgroundimage|background|cover/i.test(url || "");
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


function nameFromDocumentTitle() {
  return compactText(document.title.replace(/\s*\|\s*LinkedIn.*$/i, ""));
}

function cleanProfileLocation(value) {
  const locationValue = compactText(value);

  if (!locationValue || /^[·•|,\-\s]+$/.test(locationValue) || /^contact info$/i.test(locationValue) || /·|\b(full-time|part-time|freelance|self-employed|internship|contract)\b/i.test(locationValue)) {
    return "";
  }

  return locationValue;
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
