import puppeteer from 'puppeteer';
import { createObjectCsvWriter } from 'csv-writer';
import { crawlSearchResults, extractApartmentDetails, ApartmentData } from './crawler';

// Separate base path and query string based on Python version
const BASE_PATH = 'https://wunderflats.com/en/furnished-apartments/berlin/'; // Ends with /
const QUERY_STRING = '?from=2025-07-01&to=2025-09-30&flexibleDays=14&scoreVariant=B' +
    '&minRooms=3&homeType=ENTIRE_APARTMENT&minSize=60';

const CSV_FILENAME = 'wunderflats_berlin_all.csv';

async function main() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({ headless: true }); // Changed to boolean true

    const csvWriter = createObjectCsvWriter({
        path: CSV_FILENAME,
        header: [
            { id: 'title', title: 'Title' },
            { id: 'address', title: 'Address' },
            { id: 'postalCode', title: 'PostalCode' },
            { id: 'neighborhood', title: 'Neighborhood' },
            { id: 'size', title: 'Size (sqm)' },
            { id: 'rooms', title: 'Rooms' },
            { id: 'price', title: 'Price (EUR)' },
            { id: 'pricePerSqm', title: 'Price/Sqm (EUR)' },
            { id: 'description', title: 'Description' },
            { id: 'url', title: 'URL' }
        ]
    });

    let currentPageNumber = 1;
    const allApartmentData: ApartmentData[] = [];

    console.log(`Starting crawl from base path: ${BASE_PATH} with query: ${QUERY_STRING}`);

    try {
        // --- Restore loop and detail extraction ---
        // const searchUrl = `${BASE_PATH}1${QUERY_STRING}`; // Construct URL for the first page only - REMOVED
        // console.log(`\nCrawling first search results page for analysis: ${searchUrl}...`); - REMOVED
        // await crawlSearchResults(browser, searchUrl); // Call once - REMOVED
        // console.log('HTML and screenshot should now be saved. Please review them.'); - REMOVED

        // RESTORED WHILE LOOP
        while (true) {
            // Construct URL with page number in the path, then query string
            const searchUrl = `${BASE_PATH}${currentPageNumber}${QUERY_STRING}`;

            console.log(`\nCrawling search results page: ${searchUrl}...`);

            // Pass browser instance to crawlSearchResults
            const apartmentLinks = await crawlSearchResults(browser, searchUrl);

            if (apartmentLinks.length === 0) {
                console.log('No more apartment links found. Finishing crawl.');
                break; // Exit loop if no links found on the page
            }

            console.log(`Found ${apartmentLinks.length} apartments on page ${currentPageNumber}. Extracting details...`);

            for (const link of apartmentLinks) {
                try {
                    console.log(`   Extracting details for: ${link}`);
                    const details = await extractApartmentDetails(browser, link);
                    if (details) {
                        allApartmentData.push(details);
                    } else {
                        console.warn(`   Could not extract details for: ${link}`);
                    }
                    // Wait for 1 second between requests to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    console.error(`   Error processing apartment ${link}:`, error);
                    // Optional: Add more robust error handling, e.g., retry logic
                }
            }

            console.log(`Finished processing page ${currentPageNumber}.`);
            currentPageNumber++;

            // Optional: Add a small delay between loading search result pages
            // await new Promise(resolve => setTimeout(resolve, 500));
        }
        // END RESTORED WHILE LOOP

        // RESTORED CSV WRITING
        if (allApartmentData.length > 0) {
            console.log(`\nWriting ${allApartmentData.length} records to ${CSV_FILENAME}...`);
            await csvWriter.writeRecords(allApartmentData);
            console.log('Successfully wrote data to CSV.');
        } else {
            console.log('No data collected to write to CSV.');
        }
        // END RESTORED CSV WRITING

    } catch (error) {
        console.error('An error occurred during the crawl:', error);
    } finally {
        console.log('Closing browser...');
        await browser.close();
    }
}

main();
