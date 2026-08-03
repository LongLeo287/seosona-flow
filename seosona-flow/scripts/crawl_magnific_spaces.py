import os
import sys
import asyncio

async def main():
    try:
        from crawl4ai import AsyncWebCrawler
        print("Initializing Crawl4AI crawler...")
        async with AsyncWebCrawler(verbose=True) as crawler:
            result = await crawler.arun(
                url="https://www.magnific.com/app/spaces/a251273a-7e77-4b96-89a5-57eee78ad377",
                wait_for="css:.node-card, css:#app",
                delay_before_return_html=3.0
            )
            print("Crawl complete!")
            output_dir = os.path.join(os.path.dirname(__file__), "../magnific-ai-review/crawled-crawl4ai")
            os.makedirs(output_dir, exist_ok=True)
            
            html_path = os.path.join(output_dir, "spaces_crawled_crawl4ai.html")
            with open(html_path, "w", encoding="utf-8") as f:
                f.write(result.html)
            print(f"Saved crawled HTML to {html_path} (Bytes: {len(result.html)})")
            
            md_path = os.path.join(output_dir, "spaces_content.md")
            with open(md_path, "w", encoding="utf-8") as f:
                f.write(result.markdown)
            print(f"Saved markdown to {md_path}")
            
    except Exception as e:
        print(f"Error during crawl: {e}")

if __name__ == "__main__":
    asyncio.run(main())
