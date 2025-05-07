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
  await page.act(`Type "${SEARCH_TOPIC}" into the input field with current value "Search Title" in the top right corner`);
  await page.act(`Click specific year in the date section and type in "${PUBLICATION_YEAR}" for the year`);
  
  // Submit the search
  await page.act("Click the blue Search button that is in the center of the page");

  stagehand.log({ category: "arxiv-scraper", message: "Submitted search query" });
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2000); // Wait for the page to fully load

  // Extract search results using Stagehand
  stagehand.log({ category: "arxiv-scraper", message: "Extracting search results" });
  
  // Extract paper data using Stagehand
  const { papers: initialPapers } = await page.extract({
    instruction: `Extract information for up to ${MAX_PAPERS} papers from the search results, including the title and link to abstract page`,
    schema: z.object({
      papers: z.array(z.object({
        title: z.string(),
        abstractLink: z.string()
      })).max(MAX_PAPERS)
    }),
  });
  
  if (initialPapers.length === 0) {
    stagehand.log({ category: "arxiv-scraper", message: "No papers found. Taking a screenshot to debug." });
    await page.screenshot({ path: './arxiv-search-results.png' });
    return;
  }
  
  stagehand.log({ 
    category: "arxiv-scraper", 
    message: `Found ${initialPapers.length} papers, processing up to ${MAX_PAPERS} papers`
  });

  const detailedPapers = [];

  // Process each paper individually
  for (let i = 0; i < initialPapers.length; i++) {
    const paper = initialPapers[i];
    stagehand.log({ category: "arxiv-scraper", message: `Processing paper ${i + 1}: ${paper.title}` });

    // Navigate to abstract page using direct URL
    await page.goto(paper.abstractLink);
    await page.waitForLoadState("domcontentloaded");

    try {
      // Extract paper details with Stagehand
      const paperDetails = await page.extract({
        instruction: "Extract the paper details including abstract, authors, submission date, and any identifiers (arXiv ID, DOI)",
        schema: z.object({
          abstract: z.string(),
          authors: z.array(z.string()),
          submissionDate: z.string(),
          arxivId: z.string(),
          doi: z.string().default("Not available")
        }),
      });
      
      // Truncate abstract to limit usage
      const truncatedAbstract = paperDetails.abstract.length > MAX_ABSTRACT_LENGTH 
        ? paperDetails.abstract.substring(0, MAX_ABSTRACT_LENGTH) + "..." 
        : paperDetails.abstract;
      
      detailedPapers.push({
        title: paper.title,
        authors: paperDetails.authors,
        abstract: truncatedAbstract,
        submissionDate: paperDetails.submissionDate,
        doi: paperDetails.doi,
        arxivId: paperDetails.arxivId,
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
