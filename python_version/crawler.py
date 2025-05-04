import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin


def crawl(url):
    """Fetches a URL and extracts apartment listing links."""
    apartment_links = []
    try:
        # Add User-Agent header
        headers = {"User-Agent": "Mozilla/5.0"}
        response = requests.get(url, timeout=10, headers=headers)
        response.raise_for_status()  # Raise an exception for bad status codes

        soup = BeautifulSoup(response.text, "html.parser")

        # --- Wunderflats specific logic ---
        # This selector might need adjustment if the website structure changes.
        # It targets links within the main content area that likely
        # lead to listings.
        # A more robust approach might involve finding the listing cards first.
        listing_links = soup.find_all("a", href=True)  # Start broad, then filter

        print(f"Found {len(listing_links)} potential links on {url}.")

        for link in listing_links:
            href = link["href"]
            # Filter for links that look like apartment listings
            if href.startswith("/en/furnished-apartment/"):
                # Construct full URL handling relative paths
                full_url = urljoin(url, href)
                if full_url not in apartment_links:
                    apartment_links.append(full_url)
                    print(f"Found listing: {full_url}")

        # ------------------------------------

    except requests.exceptions.RequestException as e:
        print(f"Error fetching {url}: {e}")
    except Exception as e:
        print(f"An error occurred while processing {url}: {e}")

    return apartment_links  # Return the list of found links


def extract_apartment_details(url):
    """Fetches an apartment page and extracts details using specific selectors."""
    # Initialize details dictionary
    details = {
        "url": url,
        "title": "Not Found",
        "price": "Not Found",
        "size": "Not Found",
        "rooms": "Not Found",
        "address": "Not Found",
        "description": "Not Found",
        "availability": "Not implemented",
    }
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        print(f"\nFetching details for: {url}")
        response = requests.get(url, timeout=10, headers=headers)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        # --- Extract details using provided selectors ---

        # Title (h2 with specific class)
        title_tag = soup.find("h2", class_="ListingDetails-title")
        if title_tag:
            details["title"] = title_tag.text.strip()

        # Address (span with data-testid)
        address_tag = soup.find(
            "span", attrs={"data-testid": "ListingDetailsPage-address"}
        )
        if address_tag:
            details["address"] = address_tag.text.strip()
        # Fallback/Alternative: Look within the div if specific testid fails
        elif soup.find("div", class_="ListingDetails-basic"):
            basic_div = soup.find("div", class_="ListingDetails-basic")
            if basic_div.find("span"):  # Find any span within
                details["address"] = basic_div.find("span").text.strip() + " (fallback)"

        # Stats Container
        stats_container = soup.find("div", class_="ListingDetails-stats")
        if stats_container:
            # Size (within stats)
            size_span = stats_container.find(
                "span", class_="ListingDetails-statsElt floor"
            )
            if size_span and size_span.find("span"):  # Find the inner span
                # Extract text like "98 m²...", split and take the first part
                size_text_parts = size_span.find("span").text.strip().split(",")
                if size_text_parts:
                    details["size"] = size_text_parts[0].strip()

            # Rooms (within stats)
            rooms_span = stats_container.find(
                "span", class_="ListingDetails-statsElt rooms"
            )
            if rooms_span and rooms_span.find("span"):  # Find the inner span
                details["rooms"] = rooms_span.find("span").text.strip()

        # Price
        price_wrapper = soup.find("div", class_="ListingPriceText__wrapper")
        if price_wrapper:
            price_value_tag = price_wrapper.find(
                "strong", class_="ListingPriceText__value"
            )
            price_unit_tag = price_wrapper.find("span")  # Check for 'per month'
            if (
                price_value_tag
                and price_unit_tag
                and "per month" in price_unit_tag.text
            ):
                details["price"] = (
                    f"{price_value_tag.text.strip()} {price_unit_tag.text.strip()}"
                )
            elif price_value_tag:  # Fallback if unit span is different
                details["price"] = price_value_tag.text.strip()

        # Description (Keep the previous generic attempt for now)
        desc_tag = soup.find(
            "div", class_="description"
        )  # Replace 'description' with actual class if known
        if desc_tag:
            details["description"] = desc_tag.text.strip()
        else:
            details["description"] = (
                "Description section not found (using generic selector)"
            )

        # Availability remains not implemented
        # --------------------------------------------------------------------

        print("Extracted Details:")
        for key, value in details.items():
            print(f"- {key.capitalize()}: {value}")

    except requests.exceptions.RequestException as e:
        print(f"Error fetching apartment details from {url}: {e}")
    except Exception as e:
        print(
            f"An error occurred while processing apartment details from {url}: " f"{e}"
        )

    return details
