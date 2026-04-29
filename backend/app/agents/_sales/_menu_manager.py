"""메뉴 마스터 관리 — sales capability 헬퍼

upsert_menu      : 메뉴 등록(신규) 또는 가격 업데이트(기존)
list_menus_with_profit : 메뉴 목록 + 마진율 계산
"""
from __future__ import annotations

from datetime import date

from app.core.supabase import get_supabase

# ── 카테고리 자동 분류 키워드 ──────────────────────────────────────────────────

_DRINK_KEYWORDS = [
    "라떼", "아메리카노", "에스프레소", "카푸치노", "카페", "모카", "마키아또",
    "콜드브루", "플랫화이트", "드립", "핸드드립", "콜드", "아이스",
    "티", "홍차", "녹차", "보리차", "허브티", "밀크티",
    "주스", "에이드", "스무디", "쉐이크", "프라푸치노", "음료",
    "레모네이드", "딸기에이드", "청포도", "자몽", "복숭아",
    "코코아", "초코", "초콜릿", "꿀", "시나몬", "바닐라라떼",
]

_DESSERT_KEYWORDS = [
    "케이크", "크로아상", "타르트", "쿠키", "마카롱", "스콘",
    "와플", "팬케이크", "파이", "머핀", "브라우니", "도넛",
    "빵", "베이글", "샌드위치", "토스트", "디저트",
]

_FOOD_KEYWORDS = [
    "밥", "국", "찌개", "볶음", "구이", "튀김", "떡볶이", "라면",
    "파스타", "피자", "버거", "샐러드", "덮밥", "비빔밥", "김밥",
    "삼겹살", "치킨", "닭", "소고기", "돼지", "생선", "해물",
]


def _infer_category(name: str) -> str:
    """메뉴 이름으로 카테고리 자동 추론. 매칭 없으면 '기타'."""
    lower = name.lower()
    if any(kw in lower for kw in _DRINK_KEYWORDS):
        return "음료"
    if any(kw in lower for kw in _DESSERT_KEYWORDS):
        return "디저트"
    if any(kw in lower for kw in _FOOD_KEYWORDS):
        return "음식"
    return "기타"


async def upsert_menu(
    account_id: str,
    name: str,
    category: str,
    price: int,
    cost_price: int = 0,
    memo: str = "",
) -> dict:
    """메뉴 등록(신규) 또는 수정(기존 동일 이름).

    중복 검사: 이름에서 '[MOCK] ' 등 테스트 프리픽스를 제거한 뒤 대소문자 무관 비교.
    """
    sb = get_supabase()

    # 전체 메뉴 로드 후 정규화 이름으로 비교
    all_menus = (
        sb.table("menus")
        .select("id, name, price, cost_price, category, memo")
        .eq("account_id", account_id)
        .eq("is_active", True)
        .execute()
    )

    def _normalize(n: str) -> str:
        """'[MOCK] ' 같은 테스트 프리픽스 제거 + 공백 정규화 + 소문자."""
        import re
        return re.sub(r"^\[.*?\]\s*", "", n).strip().lower()

    target = _normalize(name)
    existing = next(
        (m for m in (all_menus.data or []) if _normalize(m["name"]) == target),
        None,
    )

    if existing:
        menu_id = existing["id"]
        # 사용자가 명시하지 않은 필드는 기존 값 유지
        # (기본값이면 미입력으로 간주)
        final_category   = category   if category != "기타"  else existing["category"]
        final_cost_price = cost_price if cost_price > 0      else existing["cost_price"]
        final_memo       = memo       if memo                else existing.get("memo", "")

        result = (
            sb.table("menus")
            .update({
                "price":      price,
                "cost_price": final_cost_price,
                "category":   final_category,
                "memo":       final_memo,
            })
            .eq("id", menu_id)
            .execute()
        )
        return {
            "action":     "updated",
            "menu":       result.data[0],
            "old_price":  existing["price"],
            "old_cost":   existing["cost_price"],
        }

    # 카테고리 미입력(기타)이면 이름으로 자동 추론
    final_category = category if category != "기타" else _infer_category(name)

    result = (
        sb.table("menus")
        .insert({
            "account_id": account_id,
            "name":       name,
            "category":   final_category,
            "price":      price,
            "cost_price": cost_price,
            "memo":       memo,
        })
        .execute()
    )
    return {"action": "created", "menu": result.data[0], "old_price": None}


async def delete_menu(account_id: str, name: str) -> dict:
    """메뉴 삭제. 정규화 이름 비교로 [MOCK] 프리픽스도 처리."""
    sb = get_supabase()

    all_menus = (
        sb.table("menus")
        .select("id, name, price, category")
        .eq("account_id", account_id)
        .eq("is_active", True)
        .execute()
    )

    def _normalize(n: str) -> str:
        import re
        return re.sub(r"^\[.*?\]\s*", "", n).strip().lower()

    target = _normalize(name)
    existing = next(
        (m for m in (all_menus.data or []) if _normalize(m["name"]) == target),
        None,
    )

    if not existing:
        return {"action": "not_found", "name": name}

    sb.table("menus").delete().eq("id", existing["id"]).execute()
    return {"action": "deleted", "menu": existing}


async def upsert_menu_list_artifact(account_id: str, menus: list[dict]) -> str | None:
    """메뉴판 artifact를 Pricing 서브허브에 upsert.

    _revenue.py 패턴 동일: Pricing 서브허브 찾기 → artifact insert/update → contains 엣지.
    계정당 menu_list artifact는 1개만 유지 (기존 있으면 content 업데이트).
    """
    import logging
    log = logging.getLogger(__name__)
    sb = get_supabase()

    # Pricing 서브허브 찾기
    try:
        hub_res = (
            sb.table("artifacts")
            .select("id")
            .eq("account_id", account_id)
            .eq("kind", "domain")
            .eq("type", "category")
            .ilike("title", "%Pricing%")
            .limit(1)
            .execute()
        )
        pricing_hub_id = hub_res.data[0]["id"] if hub_res.data else None
    except Exception as e:
        log.warning("[_menu_manager] Pricing 허브 조회 실패: %s", e)
        return None

    # artifact content 구성 — 한 줄 요약 (상세는 MenuListPanel에서 실시간 표시)
    total = len(menus)
    today = date.today().strftime("%Y-%m-%d")
    content = f"📋 총 {total}개 메뉴 등록됨 · 마지막 업데이트: {today}"
    title = f"메뉴판 ({total}개)"

    # 기존 menu_list artifact 확인 (upsert)
    try:
        existing = (
            sb.table("artifacts")
            .select("id")
            .eq("account_id", account_id)
            .eq("type", "menu_list")
            .eq("kind", "artifact")
            .limit(1)
            .execute()
        )
        if existing.data:
            artifact_id = existing.data[0]["id"]
            sb.table("artifacts").update({
                "title":   title,
                "content": content,
            }).eq("id", artifact_id).execute()
            return artifact_id

        # 신규 생성
        art_res = sb.table("artifacts").insert({
            "account_id": account_id,
            "kind":       "artifact",
            "type":       "menu_list",
            "domains":    ["sales"],
            "title":      title,
            "content":    content,
            "status":     "active",
            "metadata":   {"menu_count": total},
        }).execute()

        if not art_res.data:
            return None

        artifact_id = art_res.data[0]["id"]

        if pricing_hub_id:
            sb.table("artifact_edges").insert({
                "account_id": account_id,
                "parent_id":  pricing_hub_id,
                "child_id":   artifact_id,
                "relation":   "contains",
            }).execute()

        return artifact_id
    except Exception as e:
        log.warning("[_menu_manager] menu_list artifact upsert 실패: %s", e)
        return None


async def list_menus_with_profit(account_id: str) -> dict:
    """활성 메뉴 목록 + 마진율·마진액 계산."""
    sb = get_supabase()

    result = (
        sb.table("menus")
        .select("*")
        .eq("account_id", account_id)
        .eq("is_active", True)
        .order("category")
        .order("name")
        .execute()
    )
    menus = result.data or []

    for m in menus:
        price = m.get("price", 0)
        cost  = m.get("cost_price", 0)
        if price > 0:
            m["margin_rate"]   = round((price - cost) / price * 100, 1)
            m["margin_amount"] = price - cost
        else:
            m["margin_rate"]   = None
            m["margin_amount"] = None

    by_category: dict[str, list] = {}
    for m in menus:
        by_category.setdefault(m["category"], []).append(m)

    return {"menus": menus, "by_category": by_category, "total": len(menus)}
