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
export async function extractApartmentDetails(
    browser: Browser,
    url: string,
    pageNumber: number, // Added parameter
    linkIndex: number,  // Added parameter
    totalLinks: number  // Added parameter
): Promise<ApartmentData | null> {
    let page: Page | null = null;
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

    // Log start of processing for this specific link
    console.log(`   (Page ${pageNumber}, Link ${linkIndex + 1}/${totalLinks}) Processing: ${url}`);

    try {
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        // console.log(`   (Page ${pageNumber}, Link ${linkIndex + 1}/${totalLinks}) Page loaded.`); // Reduced verbosity

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
                 console.warn(`   (Page ${pageNumber}, Link ${linkIndex + 1}/${totalLinks}) Could not parse price: ${priceText}`);
                 details.price = null;
            }
        }

        // --- Multi-Attempt Description Extraction ---
        const aboutSectionSelector = 'section#aboutListing';
        const readMoreSelectorNested = `${aboutSectionSelector} p > div > a.ListingDetails-readMoreToggle`;
        const descriptionSelectorNestedP = `${aboutSectionSelector} p > div > p`; // Attempt 1
        const descriptionSelectorSpan = `${aboutSectionSelector} > div > p > span`;  // Attempt 2
        const descriptionSelectorDirectP = `${aboutSectionSelector} > div > p`;   // Attempt 3

        details.description = null; // Reset description
        let descriptionFound = false;

        try {
            // Wait for the main section
            await page.waitForSelector(aboutSectionSelector, { timeout: 5000 });

            // Try clicking "Read more" if it exists (using the nested structure selector)
            try {
                const readMoreButton = await page.$(readMoreSelectorNested);
                if (readMoreButton) {
                    await readMoreButton.click();
                    await new Promise(resolve => setTimeout(resolve, 500)); // Wait briefly
                }
            } catch (readMoreError) {
                // Ignore if read more button doesn't exist or click fails
            }

            // Attempt 1: Nested P structure
            try {
                details.description = await page.$eval(descriptionSelectorNestedP, el => el.textContent?.trim() || null);
                if (details.description) descriptionFound = true;
            } catch (e) { /* Selector failed, try next */ }

            // Attempt 2: Span inside P structure
            if (!descriptionFound) {
                try {
                    details.description = await page.$eval(descriptionSelectorSpan, el => el.textContent?.trim() || null);
                    if (details.description) descriptionFound = true;
                } catch (e) { /* Selector failed, try next */ }
            }

            // Attempt 3: Direct P structure
            if (!descriptionFound) {
                 try {
                    details.description = await page.$eval(descriptionSelectorDirectP, el => {
                        // Check if this <p> contains the <span> from attempt 2 - if so, ignore it.
                        const spanChild = el.querySelector('span');
                        if (spanChild && spanChild.textContent?.trim()) {
                            return null; // Already tried getting this text via the span selector
                        }
                        return el.textContent?.trim() || null;
                    });
                    if (details.description) descriptionFound = true;
                } catch (e) { /* Selector failed */ }
            }

        } catch (e) {
             console.error(`   (Page ${pageNumber}, Link ${linkIndex + 1}/${totalLinks}) Error processing description section:`, e);
        }

        // Save HTML only if ALL description attempts failed
        if (!descriptionFound && page) { // Changed condition to !descriptionFound
             console.warn(`   (Page ${pageNumber}, Link ${linkIndex + 1}/${totalLinks}) Description not found using multiple selectors. Saving HTML...`);
             const errorHtmlPath = `error_description_page${pageNumber}_link${linkIndex + 1}_${Date.now()}.html`;
             try {
                const pageContent = await page.content();
                await fs.writeFile(errorHtmlPath, pageContent);
                console.log(`     Saved description error HTML to: ${errorHtmlPath}`);
             } catch (saveError) {
                console.error(`     Failed to save error HTML:`, saveError);
             }
        } else if (descriptionFound) {
             console.log(`   (Page ${pageNumber}, Link ${linkIndex + 1}/${totalLinks}) Description extracted successfully.`);
        }
        // --- End Description Extraction & Saving ---

        if (details.price !== null && details.size !== null && details.size > 0) {
            details.pricePerSqm = parseFloat((details.price / details.size).toFixed(2));
        } else {
            details.pricePerSqm = null;
        }

        // Don't log full details for every link
        // console.log(`   (Page ${pageNumber}, Link ${linkIndex + 1}/${totalLinks}) Detail extraction finished.`); // Can be noisy
        return details;

    } catch (error) {
        console.error(`   (Page ${pageNumber}, Link ${linkIndex + 1}/${totalLinks}) Error extracting details from ${url}:`, error);
        return null;
    } finally {
        if (page) {
            await page.close();
            // console.log(`   (Page ${pageNumber}, Link ${linkIndex + 1}/${totalLinks}) Page closed.`); // Reduced verbosity
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
        // console.log(`Crawling search page: ${searchUrl}`); // Reduced verbosity
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // --- Handle Cookie Consent Overlay ---
        const acceptButtonSelector = 'button[data-cookiefirst-action="accept"]';
        try {
            // console.log(`Waiting for cookie consent button: ${acceptButtonSelector}`); // Reduced verbosity
            await page.waitForSelector(acceptButtonSelector, { visible: true, timeout: 10000 });
            // console.log('Cookie consent button found. Clicking...'); // Reduced verbosity
            await page.click(acceptButtonSelector);
            // console.log('Clicked cookie consent button. Waiting for overlay to disappear...'); // Reduced verbosity
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (e) {
            console.log('Cookie consent button not found or timed out, proceeding anyway...');
        }
        // -------------------------------------

        // --- Extract Apartment Links ---
        const linkSelector = 'a.Listing-link';
        // console.log(`Waiting for listing links with selector: ${linkSelector}`); // Reduced verbosity
        try {
            await page.waitForSelector(linkSelector, { timeout: 15000 });
            // console.log('Listing links found. Extracting...'); // Reduced verbosity

            const relativeLinks = await page.$$eval(linkSelector, (anchors) =>
                anchors.map(anchor => (anchor as HTMLAnchorElement).getAttribute('href'))
            );

            const baseUrl = new URL(searchUrl).origin;
            relativeLinks.forEach(relativeLink => {
                if (relativeLink) {
                    const absoluteUrl = new URL(relativeLink, baseUrl).toString();
                    if (!apartmentLinks.includes(absoluteUrl)) {
                        apartmentLinks.push(absoluteUrl);
                        // console.log(`  Found link: ${absoluteUrl}`); // Reduced verbosity
                    }
                }
            });
            // console.log(`Extracted ${apartmentLinks.length} unique links.`); // Reduced verbosity

        } catch (error) {
            console.error(`Error finding or extracting listing links with selector "${linkSelector}":`, error);
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
            // console.log(`Search page closed.`); // Reduced verbosity
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
