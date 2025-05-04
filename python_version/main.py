import crawler
from crawler import extract_apartment_details
import csv
import time  # Import time for potential delays

if __name__ == "__main__":
    base_url_template = (
        "https://wunderflats.com/en/furnished-apartments/berlin/{page_num}"
        "?from=2025-07-01&to=2025-09-30&flexibleDays=14&scoreVariant=B"
        "&minRooms=3&homeType=ENTIRE_APARTMENT&minSize=60"
    )

    all_apartment_details = []
    page_number = 1

    print("Starting crawl...")

    while True:
        page_url = base_url_template.format(page_num=page_number)
        print(f"\n--- Crawling search results page: {page_number} --- ({page_url})")

        apartment_links = crawler.crawl(page_url)

        if not apartment_links:
            print(f"No apartment links found on page {page_number}. Stopping crawl.")
            break

        print(
            f"Found {len(apartment_links)} links on page {page_number}. "
            f"Extracting details..."
        )

        for link in apartment_links:
            # Optional: Add a small delay to avoid overwhelming the server
            time.sleep(0.5)
            details = extract_apartment_details(link)
            if (
                details
            ):  # Ensure details were extracted (even if some fields are 'Not Found')
                all_apartment_details.append(details)

        page_number += 1
        # Optional: Limit the number of pages to crawl during testing
        # if page_number > 5:
        #    print("Reached page limit for testing.")
        #    break
        # Optional: Add a small delay between pages
        time.sleep(1)

    print(
        f"\n--- Crawling finished. "
        f"Found details for {len(all_apartment_details)} apartments. ---"
    )

    # --- Save to CSV ---
    if all_apartment_details:
        csv_filename = "wunderflats_berlin.csv"
        # Use the keys from the first dictionary as headers
        # Assumes all dictionaries have the same keys
        headers = all_apartment_details[0].keys()

        print(f"Saving results to {csv_filename}...")
        try:
            with open(csv_filename, "w", newline="", encoding="utf-8") as csvfile:
                writer = csv.DictWriter(csvfile, fieldnames=headers)
                writer.writeheader()
                writer.writerows(all_apartment_details)
            print("Successfully saved results to CSV.")
        except IOError as e:
            print(f"Error writing to CSV file {csv_filename}: {e}")
        except Exception as e:
            print(f"An unexpected error occurred during CSV writing: {e}")
    else:
        print("No apartment details collected, CSV file not created.")

    # --- Old Single Apartment Logic (Commented out) ---
    # apartment_url = (
    #     "https://wunderflats.com/en/furnished-apartment/"
    #     "spacious-3-bedroom-apartment-in-berlin-kreuzberg/"
    #     "653792d4be89cdaafe631baf"
    # )
    # extract_apartment_details(apartment_url)
    # --------------------------------------------------
