import { Browser, Page } from 'puppeteer';
import fs from 'fs/promises'; // Import fs promises
import { URL } from 'url'; // Import URL for resolving relative links

// Define an interface for the structure of the details we expect
interface ApartmentDetails {
    url: string;
    title: string | null;
    address: string | null;
    postalCode: string | null;
    neighborhood: string | null;
    size: number | null;
    rooms: number | null;
    price: number | null;
    pricePerSqm: number | null;
    description: string | null; // Added description field
}

// Type definition for the extracted data
export interface ApartmentData {
    url: string;
    title: string | null;
    address: string | null;
    postalCode: string | null;
    neighborhood: string | null;
    size: number | null;
    rooms: number | null;
    price: number | null;
    pricePerSqm: number | null;
    description: string | null;
}

async function safeEval<T>(page: Page, selector: string, evaluateFn: (el: Element) => T): Promise<T | null> {
    try {
        // Wait for the selector to appear first (adjust timeout as needed)
        await page.waitForSelector(selector, { timeout: 5000 }); 
        return await page.$eval(selector, evaluateFn);
    } catch (error) {
        // console.warn(`Selector "${selector}" not found or evaluation failed.`);
        return null; // Return null if selector not found or evaluation fails
    }
}

// Function to extract apartment details from a single listing page
export async function extractApartmentDetails(browser: Browser, url: string): Promise<ApartmentData | null> {
    let page: Page | null = null; // Reintroduce page management within the function
    const details: ApartmentData = {
        url: url,
        title: null,
        address: null,
        postalCode: null,
        neighborhood: null,
        size: null,
        rooms: null,
        price: null,
        pricePerSqm: null,
        description: null,
    };

    try {
        page = await browser.newPage(); // Create a new page for this task
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'); // Set UA for this page
        console.log(`  Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log(`  Page loaded.`);

        // Extract static details using the local 'page'
        details.title = await safeEval(page, 'h2.ListingDetails-title', el => el.textContent?.trim() || null);
        
        const addressText = await safeEval(page, 'span[data-testid="ListingDetailsPage-address"]', el => el.textContent?.trim() || null);
        details.address = addressText; 
        if (addressText) {
            const postalCodeMatch = addressText.match(/\b(\d{5})\b/); 
            if (postalCodeMatch && postalCodeMatch[1]) {
                details.postalCode = postalCodeMatch[1];
                details.neighborhood = mapPostalCodeToNeighborhood(details.postalCode);
            }
        }
        
        const sizeText = await safeEval(page, 'div.ListingDetails-stats span.ListingDetails-statsElt.floor span', el => el.textContent?.trim() || null);
        if (sizeText) {
            const sizeMatch = sizeText.match(/\d+(\.\d+)?/);
            if (sizeMatch) {
                details.size = parseFloat(sizeMatch[0]);
            }
        }

        const roomsText = await safeEval(page, 'div.ListingDetails-stats span.ListingDetails-statsElt.rooms span', el => el.textContent?.trim() || null);
        if (roomsText) {
            const roomsMatch = roomsText.match(/\d+/);
            if (roomsMatch) {
                details.rooms = parseInt(roomsMatch[0], 10);
            }
        }

        const priceText = await safeEval(page, 'div.ListingPriceText__wrapper strong.ListingPriceText__value', el => el.textContent?.trim() || null);
        if (priceText) {
            const cleanedPrice = priceText.replace(/[^\d.]/g, ''); 
            details.price = parseFloat(cleanedPrice);
            if (isNaN(details.price)) {
                 console.warn(`Could not parse price: ${priceText}`);
                 details.price = null; 
            }
        }
        
        const descriptionSelector = '[data-testid="listing-description-text"]';
        const readMoreButtonSelector = 'button[data-testid="read-more-button"]';

        try {
            const readMoreButton = await page.$(readMoreButtonSelector);
            if (readMoreButton) {
                console.log('  Clicking "Read more" button...');
                await readMoreButton.click();
                await new Promise(resolve => setTimeout(resolve, 500)); 
                console.log('  Waited after click.');
            }
        } catch (e) {
            console.log('  "Read more" button not found or clickable, proceeding...');
        }
        
        details.description = await safeEval(page, descriptionSelector, el => el.textContent?.trim() ?? null);
        console.log(`  Description extracted.`);

        if (details.price !== null && details.size !== null && details.size > 0) {
            details.pricePerSqm = parseFloat((details.price / details.size).toFixed(2));
        } else {
            details.pricePerSqm = null;
        }

        console.log("\nExtracted Details (after calculations):");
        Object.entries(details).forEach(([key, value]) => {
            console.log(`- ${key.charAt(0).toUpperCase() + key.slice(1)}: ${value ?? 'Not found'}`);
        });

        return details;

    } catch (error) {
        console.error(`Error extracting details from ${url}:`, error);
        return null; 
    } finally {
        if (page) { // Close the temporary page
            await page.close();
            console.log(`  Page closed.`);
        }
    }
}

// Function to crawl a search results page and extract apartment links
export async function crawlSearchResults(browser: Browser, searchUrl: string): Promise<string[]> {
    let page: Page | null = null;
    const apartmentLinks: string[] = []; // Initialize array to store links

    try {
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        console.log(`Crawling search page: ${searchUrl}`);
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // --- Handle Cookie Consent Overlay ---
        const acceptButtonSelector = 'button[data-cookiefirst-action="accept"]'; // Selector for the accept button
        try {
            console.log(`Waiting for cookie consent button: ${acceptButtonSelector}`);
            await page.waitForSelector(acceptButtonSelector, { visible: true, timeout: 10000 }); // Wait up to 10s
            console.log('Cookie consent button found. Clicking...');
            await page.click(acceptButtonSelector);
            console.log('Clicked cookie consent button. Waiting for overlay to disappear...');
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second for overlay to fade
        } catch (e) {
            console.log('Cookie consent button not found or timed out, proceeding anyway...');
        }
        // -------------------------------------

        // --- Extract Apartment Links ---
        const linkSelector = 'a.Listing-link';
        console.log(`Waiting for listing links with selector: ${linkSelector}`);
        try {
            await page.waitForSelector(linkSelector, { timeout: 15000 }); // Wait up to 15s for links to appear
            console.log('Listing links found. Extracting...');

            const relativeLinks = await page.$$eval(linkSelector, (anchors) => 
                anchors.map(anchor => (anchor as HTMLAnchorElement).getAttribute('href'))
            );

            // Convert relative URLs to absolute URLs
            const baseUrl = new URL(searchUrl).origin;
            relativeLinks.forEach(relativeLink => {
                if (relativeLink) {
                    const absoluteUrl = new URL(relativeLink, baseUrl).toString();
                    if (!apartmentLinks.includes(absoluteUrl)) {
                        apartmentLinks.push(absoluteUrl);
                        console.log(`  Found link: ${absoluteUrl}`);
                    }
                }
            });
            console.log(`Extracted ${apartmentLinks.length} unique links.`);

        } catch (error) {
            console.error(`Error finding or extracting listing links with selector "${linkSelector}":`, error);
            // Optionally take screenshot on error here as well
            const screenshotPath = `error_screenshot_links_${Date.now()}.png`;
            try {
                if (page) {
                    await page.screenshot({ path: screenshotPath, fullPage: true });
                    console.log(`Screenshot saved to ${screenshotPath} due to link extraction error.`);
                }
            } catch (ssError) {
                console.error('Failed to take screenshot on link extraction error:', ssError);
            }
        }
        // -----------------------------

        return apartmentLinks; // Return the extracted links

    } catch (error) {
        console.error(`Error crawling search results page ${searchUrl}:`, error);
        if (page) {
            const screenshotPath = `error_screenshot_search_${Date.now()}.png`;
            try {
                await page.screenshot({ path: screenshotPath, fullPage: true });
                console.log(`Screenshot saved to ${screenshotPath}`);
            } catch (ssError) {
                console.error('Failed to take screenshot:', ssError);
            }
        }
        return [];
    } finally {
        if (page) {
            await page.close();
            console.log(`Search page closed.`);
        }
    }
}

// Helper function to map Berlin postal code to neighborhood
function mapPostalCodeToNeighborhood(postalCode: string | null): string | null {
    if (!postalCode) {
        return null;
    }

    const plz = parseInt(postalCode, 10);
    if (isNaN(plz)) {
        return null;
    }

    // Ranges based on search results and user request (central + Lichtenberg)
    if (plz >= 10115 && plz <= 10179) return 'Mitte';
    if (plz >= 10243 && plz <= 10249) return 'Friedrichshain';
    if (plz >= 10315 && plz <= 10319) return 'Lichtenberg'; // Lichtenberg range 1
    if (plz >= 10365 && plz <= 10369) return 'Lichtenberg'; // Lichtenberg range 2
    if (plz >= 10405 && plz <= 10439) return 'Prenzlauer Berg';
    if (plz >= 10551 && plz <= 10559) return 'Tiergarten/Moabit'; // Added Tiergarten/Moabit
    if (plz >= 10585 && plz <= 10629) return 'Charlottenburg';
    if (plz >= 10823 && plz <= 10829) return 'Schöneberg';
    if (plz >= 10961 && plz <= 10999) return 'Kreuzberg';
    if (plz >= 13347 && plz <= 13359) return 'Wedding'; // Added Wedding
    // Add more ranges here if needed

    return 'Other/Unknown'; // Default if no range matches
}
