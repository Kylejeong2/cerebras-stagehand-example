import { Stagehand, Page, BrowserContext } from "@browserbasehq/stagehand";
import StagehandConfig from "./stagehand.config.js";
import chalk from "chalk";
import boxen from "boxen";
import { performance } from "perf_hooks";
import { z } from "zod";

/**
 * 🤘 Welcome to Stagehand! Thanks so much for trying us out!
 * 🛠️ CONFIGURATION: stagehand.config.ts will help you configure Stagehand
 *
 * 📝 Check out our docs for more fun use cases, like building agents
 * https://docs.stagehand.dev/
 *
 * 💬 If you have any feedback, reach out to us on Slack!
 * https://stagehand.dev/slack
 *
 * 📚 You might also benefit from the docs for Zod, Browserbase, and Playwright:
 * - https://zod.dev/
 * - https://docs.browserbase.com/
 * - https://playwright.dev/docs/intro
 */

// Define the search criteria
const SEARCH_TOPIC = "large language models"; // Replace with your desired topic
const PUBLICATION_YEAR = "2024"; // Replace with the desired year (or adjust logic for specific date)
const MAX_ABSTRACT_LENGTH = 300; // Limit abstract length to avoid token limit issues
const MAX_PAPERS = 4; // Changed from 3 to 5 papers

async function main({
  page,
  context,
  stagehand,
}: {
  page: Page; // Playwright Page with act, extract, and observe methods
  context: BrowserContext; // Playwright BrowserContext
  stagehand: Stagehand; // Stagehand instance
}) {
  const startTime = performance.now();
  
  stagehand.log({
    category: "arxiv-scraper",
    message: `Starting arXiv scrape for topic: "${SEARCH_TOPIC}", year: ${PUBLICATION_YEAR}`,
  });

  // Navigate to arXiv advanced search
  await page.goto("https://arxiv.org/search/advanced");
  stagehand.log({ category: "arxiv-scraper", message: "Navigated to advanced search page" });

  // Fill in the search form using Stagehand
  await page.act("click the computer science checkbox in the subject field");
  await page.act(`Type "${SEARCH_TOPIC}" into the input field with current value "Title"`);
  await page.act(`Click specific year in the date section and type in "${PUBLICATION_YEAR}" for the year`);
  
  // Submit the search
  await page.locator('button.button.is-link.is-medium').filter({ hasText: 'Search' }).first().click();

  stagehand.log({ category: "arxiv-scraper", message: "Submitted search query" });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000); // Wait for the page to fully load

  // Use a hybrid approach of selectors and targeted extractions
  stagehand.log({ category: "arxiv-scraper", message: "Extracting search results" });
  
  // First, get the paper links using selectors to avoid context issues
  const paperElements = await page.locator('li.arxiv-result').all();
  
  if (paperElements.length === 0) {
    stagehand.log({ category: "arxiv-scraper", message: "No papers found with 'li.arxiv-result' selector, trying alternative" });
    // Try alternative selectors
    const altPaperElements = await page.locator('ol.breathe-horizontal > li').all();
    if (altPaperElements.length > 0) {
      paperElements.push(...altPaperElements);
    }
  }
  
  if (paperElements.length === 0) {
    stagehand.log({ category: "arxiv-scraper", message: "No paper elements found. Taking a screenshot to debug." });
    await page.screenshot({ path: './arxiv-search-results.png' });
    return;
  }
  
  stagehand.log({ 
    category: "arxiv-scraper", 
    message: `Found ${paperElements.length} papers, processing up to ${MAX_PAPERS} papers`
  });

  const papers = [];
  // Extract basic paper info using selectors for each result
  for (let i = 0; i < Math.min(paperElements.length, MAX_PAPERS); i++) {
    const element = paperElements[i];
    
    try {
      // Extract title using direct selectors
      const titleElement = await element.locator('p.title, .list-title, .title').first();
      const title = await titleElement.textContent() || "Title not found";
      const cleanTitle = title.replace(/^\s*Title:\s*/i, '').trim();
      
      // Extract link to abstract
      const linkElement = await element.locator('a.abstract-link, a[href*="/abs/"]').first();
      const href = await linkElement.getAttribute('href') || "";
      const abstractLink = href.startsWith('http') ? href : `https://arxiv.org${href}`;
      
      papers.push({
        title: cleanTitle,
        abstractLink
      });
    } catch (error) {
      stagehand.log({ 
        category: "arxiv-scraper", 
        message: `Error extracting paper ${i+1} info: ${error}`
      });
    }
  }

  const detailedPapers = [];

  // Process each paper individually
  for (let i = 0; i < papers.length; i++) {
    const paper = papers[i];
    stagehand.log({ category: "arxiv-scraper", message: `Processing paper ${i + 1}: ${paper.title}` });

    // Navigate to abstract page using direct URL
    await page.goto(paper.abstractLink);
    await page.waitForLoadState("domcontentloaded");

    try {
      // Use smaller, targeted extractions to avoid context length issues
      
      // 1. Extract abstract with Stagehand
      const { abstract } = await page.extract({
        instruction: "Extract only the abstract text",
        schema: z.object({
          abstract: z.string(),
        }),
      });
      
      // 2. Extract authors with selectors first, fall back to Stagehand if needed
      let authors = [];
      const authorsElement = await page.locator('.authors, .meta, p.authors').first();
      if (authorsElement) {
        const authorsText = await authorsElement.textContent() || "";
        authors = authorsText.split(',').map((author: string) => author.trim()).filter(Boolean);
      } else {
        // Fall back to Stagehand for authors
        const { extractedAuthors } = await page.extract({
          instruction: "Extract only the list of authors",
          schema: z.object({
            extractedAuthors: z.array(z.string()),
          }),
        });
        authors = extractedAuthors;
      }
      
      // 3. Extract submission date with selectors
      const dateElement = await page.locator('div.dateline').first();
      const submissionDate = await dateElement.textContent() || "Date not found";
      
      // 4. Extract arXiv ID from URL
      const urlPath = paper.abstractLink.split('/').pop() || "";
      const arxivId = urlPath.includes('v') ? urlPath : `arXiv:${urlPath}`;
      
      // 5. Extract DOI if available with selectors
      let doi = "Not available";
      const doiElement = await page.locator('a[href*="doi.org"]').first();
      if (doiElement) {
        doi = await doiElement.getAttribute('href') || "Not available";
      }
      
      // Truncate abstract to limit usage
      const truncatedAbstract = abstract.length > MAX_ABSTRACT_LENGTH 
        ? abstract.substring(0, MAX_ABSTRACT_LENGTH) + "..." 
        : abstract;
      
      detailedPapers.push({
        title: paper.title,
        authors,
        abstract: truncatedAbstract,
        submissionDate,
        doi,
        arxivId,
        citationCount: "N/A", // Not directly available on arXiv
      });
      
      stagehand.log({ 
        category: "arxiv-scraper", 
        message: `Successfully extracted details for paper ${i + 1}` 
      });
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      stagehand.log({
        category: "arxiv-scraper",
        message: `Failed to extract details for paper ${i + 1}: ${paper.title}`,
        auxiliary: {
          error: {
            value: error instanceof Error ? error.message : JSON.stringify(error),
            type: "string",
          },
        },
      });
      
      // Add partial data if extraction failed
      detailedPapers.push({
        title: paper.title,
        authors: [],
        abstract: "Extraction Failed",
        submissionDate: "Extraction Failed",
        doi: "Not available",
        arxivId: "Extraction Failed",
        citationCount: "N/A",
      });
    }
  }

  const endTime = performance.now();
  const executionTimeSeconds = (endTime - startTime) / 1000;

  // Log the final results with proper execution time
  stagehand.log({
    category: "arxiv-scraper",
    message: `Finished scraping in ${executionTimeSeconds.toFixed(2)} seconds.`,
    auxiliary: {
      results: {
        value: JSON.stringify(detailedPapers, null, 2),
        type: "object",
      },
      executionTime: {
        value: executionTimeSeconds.toFixed(2),
        type: "string",
      },
    },
  });

  console.log(chalk.green(`Cerebras script completed in ${executionTimeSeconds.toFixed(2)} seconds`));

  return detailedPapers;
}

/**
 * This is the main function that runs when you do npm run start
 *
 * YOU PROBABLY DON'T NEED TO MODIFY ANYTHING BELOW THIS POINT!
 *
 */
async function run() {
  const stagehand = new Stagehand({
    ...StagehandConfig,
  });
  await stagehand.init();

  if (StagehandConfig.env === "BROWSERBASE" && stagehand.browserbaseSessionID) {
    console.log(
      boxen(
        `View this session live in your browser: \n${chalk.blue(
          `https://browserbase.com/sessions/${stagehand.browserbaseSessionID}`,
        )}`,
        {
          title: "Browserbase",
          padding: 1,
          margin: 3,
        },
      ),
    );
  }

  const page = stagehand.page;
  const context = stagehand.context;
  await main({
    page,
    context,
    stagehand,
  });
  await stagehand.close();
  console.log(
    `\n🤘 Thanks so much for using Stagehand! Reach out to us on Slack if you have any feedback: ${chalk.blue(
      "https://stagehand.dev/slack",
    )}\n`,
  );
}

run();
