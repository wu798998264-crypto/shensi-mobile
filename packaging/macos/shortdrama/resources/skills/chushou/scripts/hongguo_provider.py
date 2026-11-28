"""Fruitknife 3.1.2 playback adapter; no browser or private profile reuse."""
import json
from html.parser import HTMLParser
from http.client import HTTPSConnection
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.parse

from download_video import DownloadError, extract_url, host_matches, safe_error

ROOT = Path(__file__).resolve().parent
UPSTREAM = "fruitknife-3.1.2-hongguo-1.0.11"
QUALITIES = ("360p", "480p", "540p", "720p", "1080p")
HOSTS = ("novelquickapp.com", "hongguoduanju.com", "fanqienovel.com", "fqnovel.com")


def is_hongguo_source(value):
    if re.fullmatch(r"\d{6,25}", str(value).strip()):
        return True
    try:
        host = urllib.parse.urlsplit(extract_url(value)).hostname or ""
        return any(host_matches(host.lower(), domain) for domain in HOSTS)
    except ValueError:
        return False


def parse_episodes(value, total, all_episodes=False):
    if all_episodes:
        if value:
            raise DownloadError("Use either episode selection or all episodes")
        return list(range(1, total + 1))
    if not value:
        raise DownloadError("Specify --episodes or --all-episodes")
    selected = set()
    for part in str(value).replace("，", ",").split(","):
        match = re.fullmatch(r"\s*(\d+)(?:\s*-\s*(\d+))?\s*", part)
        if not match:
            raise DownloadError("Invalid episode range; use 1,3-5")
        start, end = int(match[1]), int(match[2] or match[1])
        if start < 1 or end < start or end > total:
            raise DownloadError(f"Episode range must be between 1 and {total}")
        selected.update(range(start, end + 1))
    return sorted(selected)


class HongguoClient:
    download_mode = "fruitknife_3_1_2"

    def prepare_episode(self, source, destination, key):
        return self._call("prepare", source=str(source), destination=str(destination), key=key.hex())

    def __init__(self, timeout=30):
        self.timeout = timeout
        self.episodes = {}
        self.series_id = None
        self.series_title = ""

    def _call(self, action, **args):
        node = os.environ.get("SHENSI_NODE_PATH") or os.environ.get("CHUSHOU_NODE_PATH") or shutil.which("node")
        if not node:
            raise DownloadError("红果下载需要 Node.js 22+；神思使用随包 Node，本地触手请安装 Node.js")
        env = {k: v for k, v in os.environ.items() if k not in ("NODE_OPTIONS", "NODE_PATH", "ELECTRON_RUN_AS_NODE")}
        result = subprocess.run([node, str(ROOT / "hongguo_vendor" / "cli.cjs")],
                                input=json.dumps({"action": action, "cacheFile": str(Path(os.environ.get("CHUSHOU_RUNTIME_ROOT", str(ROOT.parent / "runtime"))).resolve() / "hongguo" / "device.json"), **args}, ensure_ascii=False),
                                capture_output=True, text=True, encoding="utf-8", errors="replace",
                                timeout=max(60, self.timeout * 10), shell=False, env=env)
        if result.returncode:
            raise DownloadError(safe_error(result.stderr))
        try:
            return json.loads(result.stdout)
        except ValueError as exc:
            raise DownloadError("红果下载器未返回有效JSON") from exc

    def search(self, keyword, cursor=""):
        result = self._call("search", keyword=keyword, cursor=cursor or "1")
        return {"status": "search_ready", "provider": "hongguo", "keyword": keyword,
                "items": result.get("items", []), "cursor": str(result.get("nextOffset", 0)),
                "has_more": bool(result.get("hasMore")), "warning": result.get("warning") or None, "upstream_commit": UPSTREAM}

    def inspect(self, source):
        if not is_hongguo_source(source):
            raise DownloadError("请输入红果分享链接或已核对剧集编号")
        result = self._call("inspect", source=source)
        episodes = result.get("episodes", [])
        if not episodes or any(not re.fullmatch(r"\d{6,25}", str(e.get("vid", ""))) for e in episodes):
            raise DownloadError("红果未返回有效集表")
        self.episodes = {str(e["vid"]): e for e in episodes}
        self.series_id = result["series_id"]
        self.series_title = result["series_title"]
        return {"provider": "hongguo", "series_id": result["series_id"], "title": result["series_title"],
                "source_url": extract_url(source) if not str(source).strip().isdigit() else None,
                "total_episodes": len(episodes), "episodes": [{"episode": i, "video_id": str(e["vid"]),
                "title": e.get("title", ""), "source_episode_index": e.get("vid_index")} for i, e in enumerate(episodes, 1)],
                "upstream_commit": UPSTREAM}

    def resolve_episode(self, video_id, quality="1080p"):
        episode = self.episodes.get(str(video_id))
        if not episode:
            raise DownloadError("请先核对集表，再取流")
        try:
            result = self._call("resolve", videoId=str(video_id), seriesId=self.series_id)
        except DownloadError as exc:
            # The series landing page plays its first episode. Never substitute it
            # for another item or retry a denial/rate limit through another route.
            if (str(video_id) != next(iter(self.episodes)) or str(episode.get("vid_index")) != "1"
                    or "网页取流失败：红果未返回所请求的剧集" not in str(exc)
                    or re.search(r"\b(?:401|403|429)\b", str(exc))):
                raise
            public = public_first_episode(self.series_id, self.series_title, self.timeout)
            if not public:
                raise
            return public
        return {"url": result["url"], "key": bytes.fromhex(result["key"]) if result.get("key") else None,
                "referer": result.get("referer"), "actual_quality": str(result.get("quality") or "source-best"),
                "reported_duration_seconds": result.get("duration") or None,
                "source_route": result.get("sourceRoute")}


class PublicPlayer(HTMLParser):
    """Read only the displayed HTML video and title of the official player."""

    def __init__(self):
        super().__init__()
        self.in_title = False
        self.title = []
        self.sources = set()

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        elif tag == "video":
            src = dict(attrs).get("src") or ""
            if re.fullmatch(r"/video/public/[A-Za-z0-9_-]+/[0-9]+p\.mp4", src):
                self.sources.add(src)

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title.append(data)


def public_first_episode(series_id, title, timeout):
    if not re.fullmatch(r"\d{6,25}", str(series_id)) or not title:
        return None
    page = "/player/" + str(series_id)
    origin = "https://hongguoduanju.com"
    connection = HTTPSConnection("hongguoduanju.com", timeout=timeout)
    try:
        connection.request("GET", page, headers={"Accept": "text/html", "Accept-Encoding": "identity"})
        response = connection.getresponse()
        if response.status != 200:
            raise DownloadError(f"红果公开播放页返回 HTTP {response.status}")
        if response.headers.get_content_type() != "text/html":
            return None
        body = response.read(1024 * 1024 + 1)
    finally:
        connection.close()
    if len(body) > 1024 * 1024:
        raise DownloadError("红果公开播放页超过大小限制")
    player = PublicPlayer()
    player.feed(body.decode("utf-8", errors="replace"))
    player.close()
    heading = "".join(player.title).split("|", 1)[0].strip()
    if not re.fullmatch(re.escape(title.strip()) + r"\s*第\s*1\s*集", heading) or len(player.sources) != 1:
        return None
    return {"url": origin + next(iter(player.sources)), "key": None, "referer": origin + page,
            "actual_quality": "source-best", "reported_duration_seconds": None,
            "source_route": "official_public_player"}
