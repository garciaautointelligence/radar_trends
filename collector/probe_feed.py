import requests

URL = "https://trends.google.com/trending/rss?geo=BR"
r = requests.get(URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=20)
print("Status:", r.status_code, "| bytes:", len(r.content))
open("feed_sample.xml", "wb").write(r.content)
print(r.text[:3000])