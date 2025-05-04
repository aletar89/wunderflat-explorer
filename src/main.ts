import puppeteer from 'puppeteer';
import { createObjectCsvWriter } from 'csv-writer';
import { crawlSearchResults, extractApartmentDetails, ApartmentData } from './crawler';

// Separate base path and query string based on Python version
const BASE_PATH = 'https://wunderflats.com/en/furnished-apartments/berlin/'; // Ends with /
const QUERY_STRING = '?from=2025-07-01&to=2025-09-30&flexibleDays=14&scoreVariant=B' +
    '&minRooms=3&homeType=ENTIRE_APARTMENT&minSize=60' +
    '&bbox=13.216552161689062%2C52.61597416764286%2C13.601073646064062%2C52.400325008417106';

const CSV_FILENAME = 'wunderflats_berlin_all.csv';
const CONCURRENCY_LIMIT = 5; // Set how many detail pages to process at once

// Define header configuration separately for reuse
const csvHeader = [
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
];

async function main() {
    console.log('Launching browser...');
    // Launch browser - consider adding args for stability if needed
    const browser = await puppeteer.launch({
        headless: true,
        // args: ['--no-sandbox', '--disable-setuid-sandbox'] // Example args if running in restricted env
    });

    const csvWriter = createObjectCsvWriter({
        path: CSV_FILENAME,
        header: csvHeader // Use defined header
    });

    let currentPageNumber = 1;
    const allApartmentData: ApartmentData[] = [];

    console.log(`Starting crawl from base path: ${BASE_PATH} with query: ${QUERY_STRING}`);
    console.log(`Concurrency limit set to: ${CONCURRENCY_LIMIT}`);

    try {
        // RESTORED WHILE LOOP
        while (true) {
            // Construct URL with page number in the path, then query string
            const searchUrl = `${BASE_PATH}${currentPageNumber}${QUERY_STRING}`;

            console.log(`\nCrawling search results page ${currentPageNumber}: ${searchUrl}...`);

            // Pass browser instance to crawlSearchResults
            const apartmentLinks = await crawlSearchResults(browser, searchUrl);

            if (apartmentLinks.length === 0) {
                console.log('No more apartment links found on this page or subsequent pages. Finishing crawl.');
                break; // Exit loop if no links found on the page
            }

            console.log(`Found ${apartmentLinks.length} apartments on page ${currentPageNumber}. Extracting details with concurrency limit ${CONCURRENCY_LIMIT}...`);

            const currentPageData: ApartmentData[] = []; // Array for current page data

            // Process links in chunks based on CONCURRENCY_LIMIT
            for (let i = 0; i < apartmentLinks.length; i += CONCURRENCY_LIMIT) {
                const chunkOfLinks = apartmentLinks.slice(i, i + CONCURRENCY_LIMIT);
                console.log(`   (Page ${currentPageNumber}) Processing chunk: Links ${i + 1} to ${Math.min(i + CONCURRENCY_LIMIT, apartmentLinks.length)}...`);

                const detailPromises = chunkOfLinks.map((link, index) => {
                    const overallLinkIndex = i + index; // Calculate the index relative to the full apartmentLinks array
                    // Call the updated extractApartmentDetails with page number and index context
                    return extractApartmentDetails(browser, link, currentPageNumber, overallLinkIndex, apartmentLinks.length);
                });

                // Wait for the current chunk of promises to settle
                const results = await Promise.all(detailPromises);

                // --- Updated Filtering --- 
                // Filter out null results AND results from excluded neighborhoods
                const excludedNeighborhoods = ['Wedding', 'Kreuzberg', 'Tiergarten/Moabit'];
                const successfulResults = results.filter(details => {
                    if (details === null) return false; // Exclude null results
                    if (details.neighborhood && excludedNeighborhoods.includes(details.neighborhood)) {
                        console.log(`   (Page ${currentPageNumber}) Skipping apartment in excluded neighborhood: ${details.neighborhood} (${details.title})`);
                        return false; // Exclude if neighborhood matches
                    }
                    return true; // Keep otherwise
                }) as ApartmentData[];
                // -------------------------

                currentPageData.push(...successfulResults);

            } // End of chunk processing loop

            console.log(`   Finished concurrent extraction for page ${currentPageNumber}. Kept ${currentPageData.length}/${apartmentLinks.length} (after filtering).`); // Adjusted log

            // --- Save CSV for the current page (only contains filtered data) ---
            if (currentPageData.length > 0) {
                const pageCsvFilename = `wunderflats_berlin_page_${currentPageNumber}.csv`;
                console.log(`\nWriting ${currentPageData.length} filtered records from page ${currentPageNumber} to ${pageCsvFilename}...`);
                const pageCsvWriter = createObjectCsvWriter({
                    path: pageCsvFilename,
                    header: csvHeader
                });
                try {
                    await pageCsvWriter.writeRecords(currentPageData);
                    console.log(`Successfully wrote filtered data for page ${currentPageNumber} to ${pageCsvFilename}.`);
                    // Add current page data (already filtered) to the main array
                    allApartmentData.push(...currentPageData);
                } catch (csvError) {
                    console.error(`Error writing page CSV ${pageCsvFilename}:`, csvError);
                }
            } else {
                 console.log(`No details successfully extracted or kept after filtering for page ${currentPageNumber}, skipping page CSV.`); // Adjusted log
            }
            // -------------------------------------

            currentPageNumber++;

            // Optional: Add a small delay BETWEEN loading search result pages if needed
            // await new Promise(resolve => setTimeout(resolve, 1000)); // e.g., 1 second
        }
        // END RESTORED WHILE LOOP

        // --- Write final combined CSV (only contains filtered data) ---
        if (allApartmentData.length > 0) {
            console.log(`\nWriting ${allApartmentData.length} total filtered records to ${CSV_FILENAME}...`);
            await csvWriter.writeRecords(allApartmentData);
            console.log('Successfully wrote final combined filtered data to CSV.');
        } else {
            console.log('No filtered data collected overall to write to final CSV.'); // Adjusted log
        }
        // ------------------------------------------------------------

    } catch (error) {
        console.error('An unhandled error occurred during the main crawl loop:', error);
    } finally {
        console.log('Closing browser...');
        await browser.close();
    }
}

main();
