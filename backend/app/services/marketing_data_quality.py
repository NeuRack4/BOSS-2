"""Guards for marketing performance data.

Marketing reports must be based on actual published content metrics, not just
connected account credentials or empty account-level counters.
"""

NO_MARKETING_CONTENT_MESSAGE = (
    "Instagram or YouTube has no published content performance data for this period."
)


def has_instagram_performance(data: dict | None) -> bool:
    if not isinstance(data, dict) or data.get("error"):
        return False
    if data.get("total_posts_analyzed", 0) > 0:
        return True
    top_posts = data.get("top_posts")
    return isinstance(top_posts, list) and len(top_posts) > 0


def has_youtube_performance(data: dict | None) -> bool:
    if not isinstance(data, dict):
        return False
    channel = data.get("channel")
    if isinstance(channel, dict) and channel.get("error"):
        return False
    top_videos = data.get("top_videos")
    return isinstance(top_videos, list) and len(top_videos) > 0


def mark_empty_instagram(data: dict | None) -> dict:
    if not isinstance(data, dict):
        return {"error": NO_MARKETING_CONTENT_MESSAGE}
    if has_instagram_performance(data):
        return data
    return {**data, "error": NO_MARKETING_CONTENT_MESSAGE}


def mark_empty_youtube(data: dict | None) -> dict:
    if not isinstance(data, dict):
        return {"channel": {"error": NO_MARKETING_CONTENT_MESSAGE}, "top_videos": []}
    if has_youtube_performance(data):
        return data
    channel = data.get("channel") if isinstance(data.get("channel"), dict) else {}
    return {
        **data,
        "channel": {**channel, "error": NO_MARKETING_CONTENT_MESSAGE},
        "top_videos": data.get("top_videos") if isinstance(data.get("top_videos"), list) else [],
    }


def has_any_marketing_performance(instagram: dict | None, youtube: dict | None) -> bool:
    return has_instagram_performance(instagram) or has_youtube_performance(youtube)
