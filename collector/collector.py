"""Radar de Tendências — coletor: abre, coleta, salva, encerra."""
import logging
import os
import re
import sys
import time
import unicodedata
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

REGION = os.getenv("TRENDS_REGION", "BR")
INTERVAL_MIN = int(os.getenv("INTERVAL_MINUTES", "30"))
FEED_URL = f"https://trends.google.com/trending/rss?geo={REGION}"
NS = {"ht": "https://trends.google.com/trending/rss"}
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}

log = logging.getLogger("radar")


def setup_logging():
    log_dir = BASE_DIR / "logs"
    log_dir.mkdir(exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    file_handler = RotatingFileHandler(
        log_dir / "collector.log", maxBytes=1_000_000, backupCount=5, encoding="utf-8"
    )
    file_handler.setFormatter(fmt)
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(file_handler)
    root.addHandler(console)


def fetch_feed() -> bytes:
    last_error = None
    for attempt in range(1, 4):
        try:
            resp = requests.get(FEED_URL, headers=HEADERS, timeout=20)
            resp.raise_for_status()
            return resp.content
        except requests.RequestException as exc:
            last_error = exc
            log.warning("Tentativa %d/3 falhou: %s", attempt, exc)
            time.sleep(5 * attempt)
    raise RuntimeError(f"Feed indisponivel: {last_error}")


def make_term_key(term: str) -> str:
    s = unicodedata.normalize("NFKD", term)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).strip().lower()


def parse_traffic(label):
    """'200+' -> 200 | '2K+' -> 2000 | '1M+' -> 1000000. Se nao entender, None."""
    if not label:
        return None
    m = re.match(r"^\s*(\d+)\s*(mil|mi|k|m)?\s*\+?\s*$", label, re.IGNORECASE)
    if not m:
        return None
    value = int(m.group(1))
    unit = (m.group(2) or "").lower()
    if unit in ("k", "mil"):
        value *= 1_000
    elif unit in ("m", "mi"):
        value *= 1_000_000
    return value


def child_text(node, tag):
    el = node.find(tag, NS)
    return el.text.strip() if el is not None and el.text else None


def parse_feed(xml_bytes: bytes) -> list[dict]:
    """Unico ponto que conhece o formato do feed. Se o Google mudar, ajuste aqui."""
    root = ET.fromstring(xml_bytes)
    items = []
    for item in root.iter("item"):
        term = (item.findtext("title") or "").strip()
        if not term:
            continue

        label = child_text(item, "ht:approx_traffic")

        published = None
        raw_date = item.findtext("pubDate")
        if raw_date:
            try:
                published = (
                    parsedate_to_datetime(raw_date).astimezone(timezone.utc).isoformat()
                )
            except (TypeError, ValueError):
                published = None

        news = [
            {
                "title": child_text(n, "ht:news_item_title"),
                "url": child_text(n, "ht:news_item_url"),
                "source": child_text(n, "ht:news_item_source"),
            }
            for n in item.findall("ht:news_item", NS)
        ]

        items.append(
            {
                "rank": len(items) + 1,
                "term": term,
                "term_key": make_term_key(term),
                "traffic_label": label,
                "traffic_min": parse_traffic(label),
                "published_at": published,
                "news": news,
            }
        )
    return items


def current_slot(now: datetime) -> datetime:
    minutes = now.hour * 60 + now.minute
    floored = minutes - (minutes % INTERVAL_MIN)
    return now.replace(
        hour=floored // 60, minute=floored % 60, second=0, microsecond=0
    )


def main() -> int:
    setup_logging()
    log.info("=== RADAR TRENDS - COLLECTOR (%s) ===", REGION)

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SECRET_KEY")
    if not url or not key:
        log.error("SUPABASE_URL / SUPABASE_SECRET_KEY ausentes no .env")
        return 1

    try:
        items = parse_feed(fetch_feed())
    except Exception:
        log.exception("Falha ao buscar/interpretar o feed")
        return 2

    if not items:
        log.error("Feed sem itens - nada sera gravado")
        return 2
    log.info("OK fonte conectada | %d tendencias encontradas", len(items))

    slot = current_slot(datetime.now(timezone.utc))
    try:
        client = create_client(url, key)
        client.rpc(
            "ingest_collection",
            {
                "p_region": REGION,
                "p_source": "google_trends_rss",
                "p_slot": slot.isoformat(),
                "p_items": items,
            },
        ).execute()
    except Exception as exc:
        if "23505" in str(exc) or "duplicate key" in str(exc).lower():
            log.info("Coleta deste horario ja existe (slot %s) - ignorando", slot.isoformat())
            return 0
        log.exception("Falha ao gravar no Supabase")
        return 3

    log.info("OK %d registros enviados ao Supabase (slot %s)", len(items), slot.isoformat())
    log.info("Coleta finalizada.")
    return 0


if __name__ == "__main__":
    sys.exit(main())