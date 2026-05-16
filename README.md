# LinkedIn Visible Data Scraper

A small Chrome extension for scraping data that is visible on the LinkedIn page you are currently viewing. It supports profile, company, and job pages, stores results locally in the browser, and exports them as JSON.

This extension is intended for personal or authorized use only. It does not bypass login, paywalls, rate limits, robots controls, or LinkedIn protections. You are responsible for using exported personal data lawfully and in line with any applicable terms and privacy rules.

## Install locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `/Users/shivasahani/Desktop/scrappper`.
5. Pin the extension if you want quick access.

## Use

1. Open a LinkedIn profile, company, or job page.
2. Click the extension icon.
3. Click **Scrape current page**.
4. Repeat on more pages if needed.
5. Click **Copy JSON** or **Export JSON**.

The popup keeps every scraped record until you click **Clear**. If you want a JSON file with only jobs, click **Clear** before scraping job pages.

For URLs such as `/jobs/collections/recommended/?currentJobId=...`, LinkedIn may show only a feed card instead of a full job detail pane. In that case the extension exports the selected job card fields and adds `source: "collection-card"`. Open the job detail page to capture full description and criteria.

## Output shape

Each saved record includes:

- `id`
- `pageType`
- `sourceUrl`
- `scrapedAt`
- `documentTitle`
- `metadata`
- `jsonLd`
- one of `profile`, `company`, `job`, or `generic`

LinkedIn changes its page markup often, so the scraper combines stable URL detection, visible headings, page metadata, JSON-LD, and text-section heuristics.
