# Sales 도메인 작업계획 & 학습 가이드

> BOSS-2 프로젝트 Sales 도메인 미구현 작업 A~H에 대한 종합 학습 문서.
> 기준일: 2026-04-21 / 현재 버전: v0.9.0 / 작성자: meene11

---

## 목차

1. [작업 D — 매출/비용 통계 API + 차트](#작업-d--매출비용-통계-api--차트)
2. [작업 C — 매출/비용 레코드 수정/삭제](#작업-c--매출비용-레코드-수정삭제)
3. [작업 A — 메뉴 마스터 관리](#작업-a--메뉴-마스터-관리)
4. [작업 E — 메뉴별 랭킹](#작업-e--메뉴별-랭킹)
5. [작업 B — 시간대별 분류](#작업-b--시간대별-분류)
6. [작업 F — AI 인사이트 분석](#작업-f--ai-인사이트-분석)
7. [작업 G — 재무 자동 집계 (founder_financials)](#작업-g--재무-자동-집계-founder_financials)
8. [작업 H — 프로액티브 트리거](#작업-h--프로액티브-트리거)

---

## 현재 Sales 도메인 현황 요약

### 구현 완료된 것

| 파일                           | 역할                                                                  |
| ------------------------------ | --------------------------------------------------------------------- |
| `backend/app/agents/sales.py`  | 자연어 매출/비용 파싱, [ACTION:OPEN_SALES_TABLE] 마커, capability 7종 |
| `backend/app/routers/sales.py` | POST/GET/DELETE + /summary 집계                                       |
| `backend/app/routers/costs.py` | POST/GET/DELETE + /summary 집계                                       |

### 현재 DB 테이블

```
sales_records: id, account_id, item_name, category, quantity, unit_price, amount, recorded_date, memo, source, raw_input, metadata
cost_records:  id, account_id, item_name, category, amount, recorded_date, memo, source
artifacts:     id, account_id, domains, kind, type, title, content, status, metadata(jsonb)
artifact_edges: parent_id, child_id, relation
```

### Sales 서브허브

Reports / Customers / Pricing / Costs

---

---

## 작업 D — 매출/비용 통계 API + 차트

### 1. 개요

**왜 필요한가:**
현재 `GET /api/sales/summary`와 `GET /api/costs/summary`는 단순 Python-레벨 집계(딕셔너리 루프)로 구현되어 있다. 이는 데이터가 수천 건 이상 쌓일 경우 모든 행을 Python 메모리에 올려 처리하므로 성능 문제가 생긴다. 또한 "전월 대비 변화율", "일별 추이", "누적 손익 트렌드" 같은 시계열 분석은 현재 전혀 없다.

**BOSS-1에서는 어떻게 했는가:**
BOSS-1에는 매출 도메인 자체가 없었거나 별도 간단한 스프레드시트 연동 수준이었다. BOSS-2에서 완전한 데이터 레이어를 새로 구축한다.

---

### 2. 핵심 개념 & 지식

#### 2-1. PostgreSQL `date_trunc` 함수

`date_trunc`은 타임스탬프/날짜를 특정 단위(year/month/week/day/hour 등)로 잘라(truncate) 반환하는 함수다. 집계의 기반이 된다.

```sql
-- recorded_date가 DATE 타입일 때
SELECT date_trunc('month', recorded_date::timestamptz) AS month,
       SUM(amount) AS total
FROM sales_records
WHERE account_id = $1
  AND recorded_date BETWEEN '2026-01-01' AND '2026-04-30'
GROUP BY 1
ORDER BY 1;

-- 결과 예시
-- month                  | total
-- 2026-01-01 00:00:00+00 | 3200000
-- 2026-02-01 00:00:00+00 | 2850000
-- 2026-03-01 00:00:00+00 | 4100000
```

`date_trunc('week', ...)` 는 ISO 주(월요일 시작)로 잘라준다. `'day'`는 일별 집계에 사용한다.

#### 2-2. LAG 윈도우 함수 — 전달 대비 변화율

윈도우 함수는 현재 행과 다른 행들의 관계를 계산할 때 쓴다. `LAG(col, n)`은 현재 행에서 n행 앞의 값을 가져온다.

```sql
-- 월별 매출 + 전월 대비 변화율 계산
WITH monthly AS (
    SELECT
        date_trunc('month', recorded_date::timestamptz) AS month,
        SUM(amount)::bigint AS total
    FROM sales_records
    WHERE account_id = $1
    GROUP BY 1
),
with_lag AS (
    SELECT
        month,
        total,
        LAG(total) OVER (ORDER BY month) AS prev_total
    FROM monthly
)
SELECT
    month,
    total,
    prev_total,
    CASE
        WHEN prev_total IS NULL OR prev_total = 0 THEN NULL
        ELSE ROUND((total - prev_total)::numeric / prev_total * 100, 1)
    END AS change_pct
FROM with_lag
ORDER BY month;
```

`OVER (ORDER BY month)` 가 핵심이다. 이 구문이 없으면 LAG는 동작하지 않는다.

#### 2-3. CTE (Common Table Expression)

`WITH` 절로 서브쿼리에 이름을 붙여 재사용성을 높인다. 위 예시의 `WITH monthly AS (...)` 처럼 중간 결과를 정의해두면 최종 SELECT가 깔끔해진다. 성능상으로는 PostgreSQL 12+에서 인라인 최적화가 기본 적용된다.

#### 2-4. FILTER 절 — 조건부 집계

하나의 쿼리에서 여러 조건의 합계를 동시에 계산할 때 쓴다.

```sql
SELECT
    date_trunc('month', recorded_date::timestamptz) AS month,
    SUM(amount) AS total_revenue,
    SUM(amount) FILTER (WHERE category = '음료') AS beverage_revenue,
    SUM(amount) FILTER (WHERE category = '디저트') AS dessert_revenue,
    COUNT(*) AS transaction_count,
    ROUND(AVG(amount), 0) AS avg_transaction
FROM sales_records
WHERE account_id = $1
GROUP BY 1
ORDER BY 1;
```

`CASE WHEN ... END` 안에 집계함수를 넣는 방식보다 가독성이 높고 PostgreSQL에서 최적화가 잘 된다.

#### 2-5. COALESCE + generate_series — 빈 날짜 채우기

데이터가 없는 날도 0으로 채워서 연속적인 시계열을 만들어야 차트가 올바르게 그려진다.

```sql
-- 날짜 시리즈를 만들고 LEFT JOIN으로 빈 날짜 0 채우기
WITH date_series AS (
    SELECT generate_series(
        '2026-04-01'::date,
        '2026-04-30'::date,
        '1 day'::interval
    )::date AS day
),
daily_sales AS (
    SELECT recorded_date AS day, SUM(amount) AS total
    FROM sales_records
    WHERE account_id = $1
      AND recorded_date BETWEEN '2026-04-01' AND '2026-04-30'
    GROUP BY 1
)
SELECT d.day, COALESCE(s.total, 0) AS total
FROM date_series d
LEFT JOIN daily_sales s ON d.day = s.day
ORDER BY d.day;
```

이렇게 하면 판매가 없었던 날도 `total = 0`으로 반환되어 프론트엔드 차트에서 끊기지 않는다.

#### 2-6. 손익(순이익) 계산 — sales_records + cost_records JOIN

두 테이블을 날짜 기준으로 합산해 손익을 계산한다.

```sql
WITH monthly_revenue AS (
    SELECT date_trunc('month', recorded_date::timestamptz) AS month,
           SUM(amount) AS revenue
    FROM sales_records
    WHERE account_id = $1
    GROUP BY 1
),
monthly_cost AS (
    SELECT date_trunc('month', recorded_date::timestamptz) AS month,
           SUM(amount) AS cost
    FROM cost_records
    WHERE account_id = $1
    GROUP BY 1
)
SELECT
    COALESCE(r.month, c.month) AS month,
    COALESCE(r.revenue, 0) AS revenue,
    COALESCE(c.cost, 0) AS cost,
    COALESCE(r.revenue, 0) - COALESCE(c.cost, 0) AS profit
FROM monthly_revenue r
FULL OUTER JOIN monthly_cost c ON r.month = c.month
ORDER BY 1;
```

`FULL OUTER JOIN`을 써야 매출만 있는 달, 비용만 있는 달 모두 잡힌다.

#### 2-7. Recharts vs Chart.js — BOSS-2 선택 기준

| 항목         | Recharts                   | Chart.js                     |
| ------------ | -------------------------- | ---------------------------- |
| 프레임워크   | React 전용 (컴포넌트 기반) | 프레임워크 무관 (Canvas API) |
| 번들 크기    | ~80KB gzip                 | ~60KB gzip                   |
| 반응형       | ResponsiveContainer 내장   | 별도 설정 필요               |
| 커스터마이징 | JSX로 직접 조작            | 옵션 객체로 설정             |
| 애니메이션   | 기본 내장, 제어 쉬움       | 기본 내장, 제어 쉬움         |
| TypeScript   | 완전 지원                  | `@types/chart.js` 별도       |

BOSS-2는 Next.js + React 기반이므로 **Recharts** 가 자연스럽다. 컴포넌트 조합 방식이라 Tailwind 클래스와 함께 쓰기 쉽고, shadcn/ui의 차트 컴포넌트도 Recharts 기반이다.

```tsx
// Recharts 기본 사용 예시 — 월별 매출 바 차트
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface MonthlyData {
  month: string; // "2026-03"
  revenue: number;
  cost: number;
  profit: number;
}

export function MonthlySalesChart({ data }: { data: MonthlyData[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5ddd0" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis
          tickFormatter={(v) => `${(v / 10000).toFixed(0)}만`}
          tick={{ fontSize: 11 }}
        />
        <Tooltip
          formatter={(value: number) => [`${value.toLocaleString()}원`, ""]}
        />
        <Bar
          dataKey="revenue"
          name="매출"
          fill="#c47865"
          radius={[4, 4, 0, 0]}
        />
        <Bar dataKey="cost" name="비용" fill="#d89a2b" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

#### 2-8. 시계열 데이터 시각화 패턴

- **일별 트렌드**: `LineChart` + `area` fill로 부드럽게 표현
- **카테고리 비중**: `PieChart` 또는 `RadialBarChart`
- **전월 대비**: `change_pct`를 `Badge` 컴포넌트로 ↑3.2% / ↓1.5% 표기
- **빈 날짜 처리**: generate_series로 백엔드에서 채우거나, 프론트에서 날짜 배열 생성 후 merge

---

### 3. BOSS-2 구현 계획

#### 백엔드: 새 파일/수정 파일

**`backend/app/routers/sales_analytics.py`** — 신규 생성

```python
# POST /api/sales/analytics/trend   — 일별/주별/월별 추이 (LAG 포함)
# GET  /api/sales/analytics/profit  — 매출-비용 손익 월별
# GET  /api/sales/analytics/summary — 기간 내 핵심 KPI (전달 대비 포함)
```

`sales.py`의 `/summary`는 Python-레벨 집계인데, analytics는 Supabase RPC(PostgreSQL 함수)를 통해 DB 레벨에서 집계한다.

#### DB 마이그레이션: `020_sales_analytics_functions.sql`

```sql
-- 월별 매출 추이 (LAG 포함)
CREATE OR REPLACE FUNCTION get_monthly_revenue_trend(
    p_account_id UUID,
    p_from DATE DEFAULT (CURRENT_DATE - INTERVAL '12 months')::DATE,
    p_to   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    month         DATE,
    total_revenue BIGINT,
    prev_revenue  BIGINT,
    change_pct    NUMERIC
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
    WITH monthly AS (
        SELECT
            date_trunc('month', recorded_date)::DATE AS month,
            SUM(amount)::BIGINT AS total
        FROM sales_records
        WHERE account_id = p_account_id
          AND recorded_date BETWEEN p_from AND p_to
        GROUP BY 1
    )
    SELECT
        month,
        total AS total_revenue,
        LAG(total) OVER (ORDER BY month) AS prev_revenue,
        CASE
            WHEN LAG(total) OVER (ORDER BY month) IS NULL
              OR LAG(total) OVER (ORDER BY month) = 0
            THEN NULL
            ELSE ROUND(
                (total - LAG(total) OVER (ORDER BY month))::NUMERIC
                / LAG(total) OVER (ORDER BY month) * 100, 1
            )
        END AS change_pct
    FROM monthly
    ORDER BY month;
$$;

-- 손익 월별 (매출 - 비용)
CREATE OR REPLACE FUNCTION get_monthly_profit(
    p_account_id UUID,
    p_from DATE DEFAULT (CURRENT_DATE - INTERVAL '6 months')::DATE,
    p_to   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    month    DATE,
    revenue  BIGINT,
    cost     BIGINT,
    profit   BIGINT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
    WITH r AS (
        SELECT date_trunc('month', recorded_date)::DATE AS month, SUM(amount)::BIGINT AS revenue
        FROM sales_records WHERE account_id = p_account_id GROUP BY 1
    ),
    c AS (
        SELECT date_trunc('month', recorded_date)::DATE AS month, SUM(amount)::BIGINT AS cost
        FROM cost_records WHERE account_id = p_account_id GROUP BY 1
    )
    SELECT
        COALESCE(r.month, c.month) AS month,
        COALESCE(r.revenue, 0) AS revenue,
        COALESCE(c.cost, 0) AS cost,
        COALESCE(r.revenue, 0) - COALESCE(c.cost, 0) AS profit
    FROM r FULL OUTER JOIN c ON r.month = c.month
    WHERE COALESCE(r.month, c.month) BETWEEN p_from AND p_to
    ORDER BY 1;
$$;

-- RLS 적용 (SECURITY INVOKER 이므로 호출자의 RLS 그대로 적용됨)
```

#### API 엔드포인트 설계

**Request**

```
GET /api/sales/analytics/trend?account_id=UUID&from=2026-01-01&to=2026-04-30&granularity=month
```

**Response**

```json
{
  "data": {
    "trend": [
      {
        "period": "2026-01",
        "revenue": 3200000,
        "prev_revenue": 2800000,
        "change_pct": 14.3
      },
      {
        "period": "2026-02",
        "revenue": 2850000,
        "prev_revenue": 3200000,
        "change_pct": -10.9
      }
    ],
    "summary": {
      "total_revenue": 9150000,
      "avg_monthly": 3050000,
      "best_month": "2026-03",
      "best_month_revenue": 4100000
    }
  },
  "error": null,
  "meta": { "from": "2026-01-01", "to": "2026-04-30", "granularity": "month" }
}
```

#### 프론트엔드: 필요한 컴포넌트

```
frontend/components/sales/
├── SalesDashboard.tsx          — 메인 대시보드 (탭: 매출/비용/손익)
├── charts/
│   ├── MonthlyRevenueChart.tsx — 월별 매출 바 차트 + change_pct 배지
│   ├── DailyTrendChart.tsx     — 일별 라인 차트 (이번 달 vs 지난달)
│   ├── CategoryPieChart.tsx    — 카테고리별 비중 도넛 차트
│   └── ProfitLineChart.tsx     — 매출/비용/손익 복합 라인 차트
└── SalesKpiCard.tsx            — 핵심 KPI 카드 (총매출, 전달 대비, 마진율)
```

---

### 4. 모델/기술 선택 이유

**PostgreSQL RPC vs Python 집계:**
현재 코드는 `sales_records` 전체를 Python에 올려 딕셔너리로 처리한다. 데이터가 3만 건이면 약 50MB 메모리가 필요하다. DB RPC는 데이터가 이동하지 않고 결과만 반환하므로 N배 빠르고 메모리 효율이 좋다. 단, RPC는 마이그레이션 파일로 관리해야 해서 버전 관리가 중요하다.

**Recharts 선택:**
React 컴포넌트 기반이라 상태 관리(useState/useQuery)와 자연스럽게 통합되고, shadcn/ui 디자인 시스템에 이미 Recharts 래퍼가 존재한다. Chart.js는 imperative API라 React의 선언형 패러다임과 어울리지 않아 `ref` 관리가 복잡해진다.

---

### 5. 예상 면접 질문 & 답변

**Q1. LAG 윈도우 함수와 일반 서브쿼리의 차이는?**

> LAG는 결과 집합 내에서 행 간 비교를 단일 쿼리로 처리합니다. 서브쿼리로 같은 걸 구현하면 self-join이 필요해 `FROM monthly m1 JOIN monthly m2 ON m2.month = m1.month - interval '1 month'` 형태가 되는데, 이는 full scan이 2번 발생합니다. 윈도우 함수는 데이터를 한 번만 읽고 파티션 내에서 포인터를 이동하므로 시계열 데이터에서 성능 차이가 크게 납니다.

**Q2. generate_series를 안 쓰고 빈 날짜를 채우는 다른 방법은?**

> 프론트엔드에서 처리하는 방법이 있습니다. `eachDayOfInterval` (date-fns 라이브러리)로 날짜 배열을 생성한 뒤 API 응답 데이터를 Map으로 변환해서 merge합니다. 이 방법은 백엔드 SQL 복잡도를 줄이지만, 빈 날짜 채우기 로직이 프론트에 분산됩니다. BOSS-2에서는 SQL RPC에서 처리하는 걸 선호했는데, 데이터 정합성 로직이 한 곳에 집중되기 때문입니다.

**Q3. FULL OUTER JOIN을 쓰는 이유는?**

> 매출 테이블과 비용 테이블은 독립적입니다. 특정 달에 매출만 있고 비용이 없을 수도, 반대로 비용만 있을 수도 있습니다. LEFT JOIN으로 매출 기준으로 조인하면 비용만 있는 달이 누락됩니다. FULL OUTER JOIN이 두 쪽 모두 보존합니다.

**Q4. Recharts ResponsiveContainer를 왜 필수로 써야 하나?**

> Recharts의 차트 컴포넌트는 `width`/`height`를 픽셀 값으로 받습니다. 고정 픽셀로 지정하면 모바일/태블릿에서 레이아웃이 깨집니다. `ResponsiveContainer`는 부모 컨테이너의 크기를 관찰(ResizeObserver)해서 차트에 동적으로 전달합니다. `height={300}`처럼 height만 고정하고 `width="100%"`로 가로를 가변으로 쓰는 패턴이 일반적입니다.

**Q5. 현재 summary API와 analytics API의 차이점은?**

> 현재 `/api/sales/summary`는 Python에서 `sales_records`를 전부 불러와 딕셔너리 루프로 집계합니다. 기간이 짧거나 데이터가 적으면 문제없지만, 연간 데이터나 다수 사용자 동시 요청 시 성능이 저하됩니다. 새 analytics API는 PostgreSQL 집계 함수(SUM, GROUP BY, LAG)를 DB 레벨에서 실행하는 RPC를 호출하며, 연간 트렌드나 손익 계산처럼 복잡한 쿼리도 단 한 번의 DB 쿼리로 처리합니다.

**Q6. change_pct를 null로 반환하는 경우가 있는데, 프론트에서 어떻게 처리하나?**

> 첫 달은 이전 달 데이터가 없고, 이전 달 매출이 0이면 나눗셈이 불가합니다. 두 경우 모두 null을 반환합니다. 프론트에서는 `change_pct != null`인 경우에만 배지를 표시하고, null이면 빈 공간이나 "기준 없음" 텍스트를 보여줍니다.

---

---

## 작업 C — 매출/비용 레코드 수정/삭제

### 1. 개요

**왜 필요한가:**
현재 `DELETE /api/sales/{id}`, `DELETE /api/costs/{id}`는 구현되어 있지만 **수정(PATCH/PUT) 엔드포인트가 없다**. 사용자가 잘못 입력한 단가나 수량을 수정하려면 삭제 후 재입력해야 하는 UX 문제가 있다. 프론트엔드에는 레코드를 인라인 편집할 수 있는 테이블 UI가 필요하다.

**BOSS-1에서는:**
BOSS-1은 매출 원장 자체가 없어서 해당 없음.

---

### 2. 핵심 개념 & 지식

#### 2-1. PATCH vs PUT

| 메서드 | 의미                 | 바디           |
| ------ | -------------------- | -------------- |
| PUT    | 리소스 전체를 교체   | 전체 필드 필수 |
| PATCH  | 리소스의 일부만 수정 | 변경된 필드만  |

매출 레코드는 `item_name`, `category`, `quantity`, `unit_price`, `amount` 등 여러 필드가 있는데, 사용자가 수량만 바꾸는 경우가 많다. PATCH가 더 적합하다.

#### 2-2. Pydantic v2 Optional 필드와 None 처리

```python
from pydantic import BaseModel, field_validator
from typing import Optional

class SaleItemPatch(BaseModel):
    item_name:     Optional[str]  = None
    category:      Optional[str]  = None
    quantity:      Optional[int]  = None
    unit_price:    Optional[int]  = None
    amount:        Optional[int]  = None
    recorded_date: Optional[str]  = None
    memo:          Optional[str]  = None

    # 실제로 제공된 필드만 추출
    def to_update_dict(self) -> dict:
        return {k: v for k, v in self.model_dump().items() if v is not None}
```

`model_dump(exclude_unset=True)`를 쓰면 클라이언트가 보내지 않은 필드(None vs 미전송 구분)도 정확히 처리할 수 있다.

```python
class SaleItemPatch(BaseModel):
    model_config = {"populate_by_name": True}

    item_name:     Optional[str]  = None
    quantity:      Optional[int]  = None
    unit_price:    Optional[int]  = None
    amount:        Optional[int]  = None
    recorded_date: Optional[str]  = None
    memo:          Optional[str]  = None

@router.patch("/{record_id}")
async def update_sale(record_id: str, account_id: str, body: SaleItemPatch):
    update_fields = body.model_dump(exclude_unset=True)
    if not update_fields:
        raise HTTPException(status_code=400, detail="수정할 항목이 없습니다.")

    sb = get_supabase()
    # 소유권 확인
    check = sb.table("sales_records").select("id").eq("id", record_id).eq("account_id", account_id).execute()
    if not check.data:
        raise HTTPException(status_code=404)

    result = sb.table("sales_records").update(update_fields).eq("id", record_id).execute()
    return {"data": result.data[0], "error": None, "meta": {}}
```

#### 2-3. amount 자동 재계산

`quantity`나 `unit_price`가 수정될 경우 `amount = quantity * unit_price`를 자동으로 재계산해야 한다. 이를 백엔드에서 처리할지(API 레벨) 아니면 DB 트리거로 할지 선택이 필요하다.

**API 레벨 재계산(권장):**

```python
# 수정된 필드 합성 후 amount 재계산
if "quantity" in update_fields or "unit_price" in update_fields:
    # 현재 레코드를 읽어와 누락된 값 보완
    current = sb.table("sales_records").select("quantity,unit_price").eq("id", record_id).single().execute().data
    qty = update_fields.get("quantity", current["quantity"])
    price = update_fields.get("unit_price", current["unit_price"])
    update_fields["amount"] = qty * price
```

**DB 트리거 방식:**

```sql
CREATE OR REPLACE FUNCTION recalculate_amount()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (
        NEW.quantity IS DISTINCT FROM OLD.quantity OR
        NEW.unit_price IS DISTINCT FROM OLD.unit_price
    ) THEN
        NEW.amount := NEW.quantity * NEW.unit_price;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalculate_amount
BEFORE UPDATE ON sales_records
FOR EACH ROW EXECUTE FUNCTION recalculate_amount();
```

트리거 방식은 애플리케이션 레벨 버그를 방지하지만, 로직이 DB에 분산되어 디버깅이 어렵다. BOSS-2의 규모에서는 API 레벨 처리가 유지보수에 유리하다.

#### 2-4. 임베딩 재인덱싱

수정 후 `embeddings` 테이블의 해당 소스도 업데이트해야 RAG 검색에서 정확한 결과가 나온다.

```python
# 수정 후 임베딩 재인덱싱
updated_record = result.data[0]
content = _record_to_text(updated_record)
await index_artifact(
    account_id=account_id,
    source_type="sales",
    source_id=str(record_id),
    content=content,
)
```

현재 `index_artifact`는 delete + insert 방식으로 upsert를 처리한다(`rag/embedder.py` 참고).

#### 2-5. Optimistic Update 패턴 (프론트엔드)

수정 요청을 보낼 때 서버 응답을 기다리지 않고 UI를 먼저 업데이트하는 패턴이다. 응답이 실패하면 롤백한다. React Query의 `onMutate`, `onError`, `onSettled`로 구현한다.

```tsx
const mutation = useMutation({
  mutationFn: (patch: SaleItemPatch) => patchSaleRecord(recordId, patch),
  onMutate: async (patch) => {
    await queryClient.cancelQueries({ queryKey: ["sales"] });
    const prev = queryClient.getQueryData(["sales"]);
    queryClient.setQueryData(["sales"], (old) =>
      old.map((r) => (r.id === recordId ? { ...r, ...patch } : r)),
    );
    return { prev };
  },
  onError: (_, __, ctx) => {
    queryClient.setQueryData(["sales"], ctx?.prev);
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: ["sales"] }),
});
```

---

### 3. BOSS-2 구현 계획

#### 백엔드: 수정할 파일

**`backend/app/routers/sales.py`** — PATCH 엔드포인트 추가

```
PATCH /api/sales/{record_id}  — 매출 단건 수정 + 임베딩 재인덱싱
PATCH /api/costs/{record_id}  — 비용 단건 수정
```

#### Request/Response 스키마

```python
# PATCH /api/sales/{record_id}
# Request body
class SaleItemPatch(BaseModel):
    item_name:     str | None = None
    category:      str | None = None
    quantity:      int | None = None
    unit_price:    int | None = None
    recorded_date: str | None = None
    memo:          str | None = None
    # amount는 quantity/unit_price에서 자동 계산

# Response: { data: { updated: {...record} }, error: null, meta: {} }
```

#### 프론트엔드 컴포넌트

```
frontend/components/sales/
├── SalesRecordTable.tsx     — 인라인 편집 가능한 테이블 (클릭 → input 전환)
├── CostRecordTable.tsx      — 비용 인라인 편집 테이블
└── RecordEditModal.tsx      — 모바일용 모달 편집 UI
```

---

### 4. 모델/기술 선택 이유

**PATCH vs DELETE+POST:**
DELETE 후 재등록하면 artifact 노드도 새로 생성되어 캔버스가 지저분해진다. PATCH는 기존 레코드를 유지하면서 변경 이력을 남기기 좋다. 향후 `updated_at` 컬럼을 추가하면 수정 시각도 추적 가능하다.

**인라인 편집 vs 모달:**
인라인 편집은 수정 흐름이 자연스럽지만 모바일에서 작은 입력 셀 조작이 불편하다. 모달은 터치 친화적이지만 컨텍스트 전환 비용이 있다. BOSS-2에서는 데스크톱은 인라인, 모바일은 모달로 분기하는 방식을 권장한다.

---

### 5. 예상 면접 질문 & 답변

**Q1. model_dump(exclude_unset=True)와 model_dump()의 차이는?**

> `model_dump()`는 모든 필드를 반환하고 설정 안 된 Optional 필드는 None으로 반환합니다. `exclude_unset=True`는 클라이언트가 실제로 보낸 필드만 반환합니다. PATCH에서 중요한 이유는, 클라이언트가 `quantity: 5`만 보낸 경우 `unit_price: null`로 DB를 덮어씌우는 걸 방지하기 위해서입니다.

**Q2. 트리거 방식과 API 레벨 재계산의 트레이드오프는?**

> 트리거는 어떤 경로로 UPDATE가 실행되어도 항상 amount가 정확하다는 장점이 있습니다. 단, 로직이 DB에 분산되어 코드 리뷰나 디버깅 시 SQL 파일도 함께 봐야 합니다. BOSS-2는 소상공인 대상 SaaS로 업데이트 경로가 API 단 하나이므로 API 레벨 재계산으로 충분하고, 유지보수 측면에서 유리합니다.

**Q3. Optimistic Update 롤백 시 사용자 경험은?**

> 네트워크 오류 등으로 뮤테이션이 실패하면 `onError`에서 이전 캐시 데이터(`ctx.prev`)로 즉시 복원합니다. 사용자 입장에선 잠깐 변경됐다가 원래대로 돌아오는 것처럼 보입니다. 이때 toast 알림("수정에 실패했습니다. 다시 시도해주세요.")을 함께 띄워 명시적으로 알려줍니다.

**Q4. 임베딩을 수정할 때마다 재생성하는 게 비용 낭비 아닌가?**

> BOSS-2 임베딩 모델은 OpenAI API가 아닌 로컬에서 실행되는 BAAI/bge-m3입니다. 외부 API 비용이 없고, 1024차원 벡터 생성 속도도 CPU에서 약 50~200ms 수준입니다. 매출 레코드 수정은 사용자가 자주 하는 작업이 아니므로 수정 시마다 재인덱싱하는 방식이 간단하고 충분합니다.

**Q5. 레코드 삭제 시 연결된 artifact 노드도 삭제해야 하는가?**

> 현재 구현에서는 개별 `sales_records` 행과 summary artifact 노드(예: `revenue_entry`)가 1:N 관계입니다. 하루치 여러 레코드가 하나의 artifact에 묶입니다. 따라서 레코드 하나 삭제 시 artifact를 삭제하면 다른 레코드들의 캔버스 표현도 사라집니다. 설계 선택으로는 (1) artifact는 유지하고 metadata.record_count만 감소하거나, (2) 해당 날짜 레코드가 0개가 되면 artifact도 삭제하는 방식 두 가지가 있습니다. BOSS-2에서는 캔버스 노드를 최대한 보존하는 방향이므로 (1)을 권장합니다.

---

---

## 작업 A — 메뉴 마스터 관리

### 1. 개요

**왜 필요한가:**
현재 매출을 입력할 때마다 GPT-4o로 `item_name`, `category`를 자연어에서 파싱한다. 같은 메뉴가 "아메리카노", "아메", "Americano"처럼 다양하게 입력되어 집계 시 별개의 항목으로 취급되는 문제가 있다. 메뉴 마스터 테이블이 있으면 정규화된 이름으로 매핑할 수 있고, 신규 입력 시 자동완성도 제공할 수 있다.

**BOSS-1에서는:**
없음. BOSS-2 신규 기능.

---

### 2. 핵심 개념 & 지식

#### 2-1. 마스터 데이터 개념

**마스터 데이터(Master Data)**는 트랜잭션 데이터가 참조하는 기준 정보다.

| 구분            | 예시                      |
| --------------- | ------------------------- |
| 마스터 데이터   | 메뉴 목록, 고객 등록 정보 |
| 트랜잭션 데이터 | 오늘 판매 기록, 주문 이력 |

메뉴 마스터가 없으면:

- "라떼" / "카페라떼" / "Latte" → 3개의 별개 item 취급
- 가격 정보가 없어 매번 재입력 필요
- 카테고리가 일관되지 않아 집계가 부정확

#### 2-2. DB 정규화 — 외래 키 참조

메뉴 마스터 테이블을 만들고 `sales_records.menu_id`로 참조하는 방식:

```sql
CREATE TABLE menu_items (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    account_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    category      TEXT NOT NULL DEFAULT '기타',
    default_price INT  DEFAULT 0,
    unit          TEXT DEFAULT '개',         -- 개/잔/그릇/장/팩
    is_active     BOOLEAN DEFAULT TRUE,
    sort_order    INT DEFAULT 0,             -- 표시 순서
    aliases       TEXT[] DEFAULT '{}',       -- 별칭 목록 ['아메', 'Americano']
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 계정+이름 유니크 인덱스 (동일 계정에서 같은 이름 메뉴 중복 방지)
CREATE UNIQUE INDEX idx_menu_items_account_name
ON menu_items (account_id, name);
```

그러나 `sales_records.menu_id` 외래 키를 추가하면 기존 레코드 전체가 null menu_id를 가지게 된다. **하위 호환을 위해 menu_id를 nullable**로 유지하고, 점진적으로 연결하는 전략이 현실적이다.

#### 2-3. 별칭(aliases) 배열과 매칭

PostgreSQL의 배열 타입을 활용해 별칭을 저장한다:

```sql
-- 별칭이나 이름으로 메뉴 검색
SELECT * FROM menu_items
WHERE account_id = $1
  AND (name ILIKE $2 OR $2 = ANY(aliases));
```

`= ANY(배열)` 연산자는 배열의 요소 중 하나와 같은지 확인한다. `ILIKE`로 대소문자 무시 매칭도 가능하다.

#### 2-4. 자동완성 — 퍼지 검색 (pg_trgm)

메뉴 입력 시 "아메리카"를 치면 "아메리카노"가 나오는 자동완성을 구현하려면 트라이그램(trigram) 검색을 활용한다:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_menu_items_name_trgm
ON menu_items USING GIN (name gin_trgm_ops);

-- 퍼지 검색 (유사도 0.3 이상)
SELECT name, category, default_price
FROM menu_items
WHERE account_id = $1
  AND similarity(name, $2) > 0.3
ORDER BY similarity(name, $2) DESC
LIMIT 10;
```

#### 2-5. sort_order를 이용한 드래그 정렬

메뉴 순서를 사용자가 지정할 수 있도록 `sort_order` 컬럼을 관리한다. 드래그앤드롭으로 순서 변경 시 순번을 업데이트하는 방식:

```python
# 여러 메뉴의 sort_order를 한 번에 업데이트
@router.patch("/menu-items/reorder")
async def reorder_menu_items(req: ReorderRequest):
    sb = get_supabase()
    # [{id: uuid, sort_order: int}, ...] 배치 업데이트
    for item in req.items:
        sb.table("menu_items").update({"sort_order": item.sort_order}).eq("id", item.id).eq("account_id", req.account_id).execute()
```

더 효율적인 방법은 Supabase의 `upsert`를 사용해 단일 쿼리로 처리하는 것이다:

```python
sb.table("menu_items").upsert(
    [{"id": item.id, "account_id": req.account_id, "sort_order": item.sort_order} for item in req.items],
    on_conflict="id"
).execute()
```

---

### 3. BOSS-2 구현 계획

#### DB 마이그레이션: `021_menu_items.sql`

```sql
CREATE TABLE menu_items (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    account_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    category      TEXT NOT NULL DEFAULT '기타',
    default_price INT  DEFAULT 0,
    unit          TEXT DEFAULT '개',
    is_active     BOOLEAN DEFAULT TRUE,
    sort_order    INT DEFAULT 0,
    aliases       TEXT[] DEFAULT '{}',
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_menu_items_account_name ON menu_items (account_id, name);
CREATE INDEX idx_menu_items_account_active ON menu_items (account_id, is_active, sort_order);

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own menu items"
    ON menu_items FOR ALL USING (account_id = auth.uid());
```

#### 백엔드: `backend/app/routers/menu_items.py` 신규 생성

```
GET    /api/menu-items?account_id=...          — 전체 목록 조회 (is_active=true만)
POST   /api/menu-items                         — 신규 등록
PATCH  /api/menu-items/{id}                    — 수정 (이름/가격/카테고리/별칭)
DELETE /api/menu-items/{id}?account_id=...     — 삭제 (또는 is_active=false)
PATCH  /api/menu-items/reorder                 — 순서 일괄 변경
GET    /api/menu-items/search?q=아메&account_id=... — 자동완성 검색
```

#### 프론트엔드

```
frontend/components/sales/
└── MenuMasterModal.tsx    — 메뉴 CRUD 모달 (드래그 정렬 포함)
    └── MenuItemRow.tsx    — 개별 메뉴 행 (인라인 편집)
```

---

### 4. 모델/기술 선택 이유

**외래 키 vs 자유 텍스트:**
외래 키로 연결하면 집계의 정확성이 높아지지만, 기존 `sales_records`와의 하위 호환이 깨진다. BOSS-2에서는 `menu_id nullable` + 매칭 로직(별칭 배열)으로 점진적 전환을 선택한다.

**pg_trgm vs 전문 검색 엔진(Elasticsearch):**
BOSS-2의 메뉴 수는 계정당 수십~수백 개 수준이다. Elasticsearch 같은 별도 검색 엔진을 도입할 규모가 아니며, pg_trgm은 이미 BOSS-2 migrations 001에서 활성화되어 있어 추가 인프라 없이 쓸 수 있다.

---

### 5. 예상 면접 질문 & 답변

**Q1. 메뉴 이름에 UNIQUE 인덱스를 계정+이름으로 거는 이유는?**

> 이름만으로 UNIQUE를 걸면 서로 다른 계정의 사용자가 같은 메뉴 이름(예: "아메리카노")을 쓸 수 없게 됩니다. 소상공인 플랫폼에서 계정은 각각 독립된 사업체이므로 동일 이름이 허용되어야 합니다. (account_id, name) 복합 유니크 인덱스는 같은 계정 내에서만 중복을 방지합니다.

**Q2. aliases 배열을 jsonb로 저장하지 않고 TEXT[]로 저장하는 이유는?**

> TEXT[]는 `= ANY(aliases)` 연산자와 GIN 인덱스를 지원해서 별칭 검색이 효율적입니다. jsonb로 저장하면 `jsonb_array_elements_text`를 통해 검색해야 해서 인덱스 활용이 어렵습니다. aliases는 단순 문자열 목록이므로 TEXT[]가 더 적합합니다.

**Q3. sort_order 관리에서 중간 삽입 시 성능 이슈는?**

> 리스트 중간에 항목을 삽입할 경우 그 이후 모든 항목의 sort_order를 1씩 증가시켜야 하는 N번의 UPDATE가 필요합니다. 이를 피하는 방법으로 sort_order를 정수 대신 소수(floating point)로 저장하는 "렉시코그래픽 정렬" 패턴이 있습니다(예: 1과 2 사이에 1.5 삽입). 하지만 계정당 메뉴 수백 개 규모에서는 단순 정수 업데이트가 충분히 빠르므로 BOSS-2에서는 심플한 정수 방식을 사용합니다.

---

---

## 작업 E — 메뉴별 랭킹

### 1. 개요

**왜 필요한가:**
소상공인이 "어떤 메뉴가 제일 많이 팔렸나?", "수익에 가장 기여하는 메뉴가 뭔가?"를 직관적으로 볼 수 있어야 한다. 현재 `/api/sales/summary`의 `by_item` 필드가 항목별 집계를 반환하지만, 순위 정보나 전월 대비 순위 변동, 매출 비중(%) 등은 없다.

**BOSS-1에서는:**
없음. BOSS-2 신규 기능.

---

### 2. 핵심 개념 & 지식

#### 2-1. RANK vs DENSE_RANK vs ROW_NUMBER

PostgreSQL의 순위 함수들:

```sql
SELECT
    item_name,
    SUM(amount) AS total,
    RANK()         OVER (ORDER BY SUM(amount) DESC) AS rank,
    DENSE_RANK()   OVER (ORDER BY SUM(amount) DESC) AS dense_rank,
    ROW_NUMBER()   OVER (ORDER BY SUM(amount) DESC) AS row_num
FROM sales_records
WHERE account_id = $1
GROUP BY item_name;
```

| 함수       | 동점 처리            | 예시 (1000, 1000, 800) |
| ---------- | -------------------- | ---------------------- |
| RANK       | 다음 순위 건너뜀     | 1, 1, 3                |
| DENSE_RANK | 순위 연속 유지       | 1, 1, 2                |
| ROW_NUMBER | 동점 무시, 임의 부여 | 1, 2, 3                |

메뉴 랭킹에서는 **DENSE_RANK**가 자연스럽다. "공동 1위 2개, 2위 1개"처럼 표현할 수 있다.

#### 2-2. 전월 대비 순위 변동 (Rank Change)

```sql
WITH current_month AS (
    SELECT item_name,
           SUM(amount) AS total,
           DENSE_RANK() OVER (ORDER BY SUM(amount) DESC) AS rank
    FROM sales_records
    WHERE account_id = $1
      AND recorded_date BETWEEN date_trunc('month', CURRENT_DATE) AND CURRENT_DATE
    GROUP BY item_name
),
prev_month AS (
    SELECT item_name,
           DENSE_RANK() OVER (ORDER BY SUM(amount) DESC) AS rank
    FROM sales_records
    WHERE account_id = $1
      AND recorded_date BETWEEN date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
                            AND date_trunc('month', CURRENT_DATE) - INTERVAL '1 day'
    GROUP BY item_name
)
SELECT
    c.item_name,
    c.total,
    c.rank AS current_rank,
    p.rank AS prev_rank,
    CASE
        WHEN p.rank IS NULL THEN 'new'
        WHEN c.rank < p.rank THEN 'up'
        WHEN c.rank > p.rank THEN 'down'
        ELSE 'same'
    END AS trend
FROM current_month c
LEFT JOIN prev_month p ON c.item_name = p.item_name
ORDER BY c.rank;
```

#### 2-3. 매출 비중 계산 — PERCENT_RANK vs 수동 계산

```sql
SELECT
    item_name,
    SUM(amount) AS total,
    ROUND(
        SUM(amount)::NUMERIC
        / SUM(SUM(amount)) OVER ()  -- 윈도우 함수로 전체 합계
        * 100, 1
    ) AS share_pct
FROM sales_records
WHERE account_id = $1
  AND recorded_date BETWEEN $2 AND $3
GROUP BY item_name
ORDER BY total DESC;
```

`SUM(SUM(amount)) OVER ()`이 핵심이다. 집계 함수 위에 윈도우 함수를 중첩 적용한 패턴으로, 전체 합계를 별도 서브쿼리 없이 구할 수 있다.

#### 2-4. ABC 분석 (파레토 법칙)

소상공인 메뉴를 A(상위 20%, 매출 80% 기여), B(중간), C(하위)로 분류하는 방법:

```sql
WITH ranked AS (
    SELECT
        item_name,
        SUM(amount) AS total,
        SUM(SUM(amount)) OVER () AS grand_total
    FROM sales_records
    WHERE account_id = $1
    GROUP BY item_name
),
cumulative AS (
    SELECT
        item_name,
        total,
        SUM(total) OVER (ORDER BY total DESC) AS running_total,
        grand_total
    FROM ranked
)
SELECT
    item_name,
    total,
    ROUND(running_total::NUMERIC / grand_total * 100, 1) AS cumulative_pct,
    CASE
        WHEN running_total::NUMERIC / grand_total <= 0.8 THEN 'A'
        WHEN running_total::NUMERIC / grand_total <= 0.95 THEN 'B'
        ELSE 'C'
    END AS abc_class
FROM cumulative
ORDER BY total DESC;
```

---

### 3. BOSS-2 구현 계획

#### 백엔드: `sales_analytics.py`에 추가

```
GET /api/sales/analytics/ranking?account_id=...&from=...&to=...&top_n=10
```

**Response**

```json
{
  "data": {
    "ranking": [
      {
        "rank": 1,
        "item_name": "아메리카노",
        "category": "음료",
        "total_amount": 450000,
        "total_quantity": 45,
        "share_pct": 35.2,
        "trend": "up",
        "prev_rank": 2,
        "abc_class": "A"
      }
    ],
    "summary": {
      "total_items": 12,
      "a_class_count": 3,
      "b_class_count": 4
    }
  }
}
```

#### 프론트엔드

```
frontend/components/sales/
└── MenuRankingPanel.tsx    — 순위 변동 UI (↑2 / NEW / - 등 배지)
    └── RankBadge.tsx       — 순위 변동 배지 컴포넌트
```

---

### 4. 모델/기술 선택 이유

**DENSE_RANK 선택:**
동점 메뉴가 있을 때 RANK는 3위가 갑자기 5위로 건너뛰어 혼란스럽다. 소상공인이 보는 UI에서는 "공동 2위" 표현이 더 직관적이다.

**ABC 분석:**
단순 매출 순위 외에 "A급 메뉴를 집중 관리하라"는 인사이트를 제공하는 파레토 분석이 소상공인에게 실용적이다. 별도 ML 없이 SQL 누적 합으로 구현 가능하다.

---

### 5. 예상 면접 질문 & 답변

**Q1. `SUM(SUM(amount)) OVER ()`처럼 집계 함수를 중첩할 수 있는 이유는?**

> PostgreSQL의 윈도우 함수는 GROUP BY + 집계가 완료된 결과 집합에 대해 추가로 작동합니다. 따라서 `SUM(amount)`로 그룹별 집계를 먼저 수행하고, 그 결과에 대해 `SUM(...) OVER ()`로 전체 합을 계산하는 2단계 처리가 가능합니다. 이를 "집계 위의 윈도우(Window over Aggregate)" 패턴이라 부릅니다.

**Q2. 전월 대비 순위 변동에서 지난달에 없던 메뉴는 어떻게 처리하나?**

> LEFT JOIN을 사용하므로 지난달에 없던 메뉴는 `p.rank IS NULL`이 됩니다. 이 경우 `trend = 'new'`로 표시합니다. 프론트에서는 "NEW" 배지를 보여줍니다.

**Q3. ABC 분석의 80% 기준은 고정값인가, 조정 가능한가?**

> 파레토 법칙의 80%는 경험칙이지 절대적 기준이 아닙니다. API 파라미터로 `a_threshold=0.8`을 받아 사용자가 조정할 수 있게 설계할 수 있습니다. BOSS-2 초기 구현에서는 80/95 고정으로 시작하고, 향후 사용자 피드백에 따라 커스터마이징을 추가하는 방향입니다.

---

---

## 작업 B — 시간대별 분류

### 1. 개요

**왜 필요한가:**
현재 `sales_records`의 `recorded_date`는 DATE 타입이라 시간 정보가 없다. "오전 11~오후 1시에 매출이 집중된다"는 피크타임 분석은 불가능하다. 시간대별 데이터가 쌓이면 "피크타임에 직원 추가 투입", "비피크 타임 한정 프로모션" 같은 운영 인사이트를 제공할 수 있다.

**BOSS-1에서는:**
없음.

---

### 2. 핵심 개념 & 지식

#### 2-1. TIMESTAMPTZ vs DATE

현재 `recorded_date DATE`는 날짜만 저장한다. 시간대별 분석을 위해 `recorded_at TIMESTAMPTZ`(타임존 포함 타임스탬프)로 교체하거나, 별도 컬럼을 추가해야 한다.

```sql
-- 기존 컬럼 유지하면서 시간 정보 컬럼 추가 (하위 호환)
ALTER TABLE sales_records
    ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ;

-- 시간대별 집계 — EXTRACT(hour FROM ...) 사용
SELECT
    EXTRACT(hour FROM recorded_at AT TIME ZONE 'Asia/Seoul') AS hour,
    COUNT(*) AS tx_count,
    SUM(amount) AS total
FROM sales_records
WHERE account_id = $1
  AND recorded_at IS NOT NULL
  AND recorded_at >= NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1;
```

#### 2-2. 시간대 (Timezone) 처리

서버는 UTC로 저장하고 표시 시 KST(Asia/Seoul, UTC+9)로 변환한다. `AT TIME ZONE` 연산자를 사용한다:

```sql
-- UTC로 저장된 타임스탬프를 한국 시간으로 변환해서 hour 추출
EXTRACT(hour FROM recorded_at AT TIME ZONE 'Asia/Seoul')
```

이렇게 하면 "오전 9시" 피크가 UTC 0시(UTC+9=오전 9시)로 집계되는 오류를 방지한다.

#### 2-3. 피크타임 정의 구간

소상공인 업종별 일반적인 피크타임:

| 업종   | 피크 구간               |
| ------ | ----------------------- |
| 카페   | 8~10시, 13~15시         |
| 음식점 | 12~14시, 18~21시        |
| 편의점 | 8~9시, 12~13시, 18~20시 |

이를 enum 또는 구간 배열로 정의해 "몇 % 매출이 피크 구간에 발생했는가"를 계산한다.

#### 2-4. 시간대별 히트맵 — 요일 × 시간

```sql
SELECT
    TO_CHAR(recorded_at AT TIME ZONE 'Asia/Seoul', 'D') AS dow,  -- 1=일, 7=토
    EXTRACT(hour FROM recorded_at AT TIME ZONE 'Asia/Seoul') AS hour,
    COUNT(*) AS tx_count,
    COALESCE(SUM(amount), 0) AS total
FROM sales_records
WHERE account_id = $1
  AND recorded_at >= NOW() - INTERVAL '90 days'
GROUP BY 1, 2
ORDER BY 1, 2;
```

결과는 7×24 히트맵 행렬로 프론트엔드에서 `HeatmapChart`로 시각화한다.

---

### 3. BOSS-2 구현 계획

#### DB 마이그레이션: `022_sales_recorded_at.sql`

```sql
-- recorded_at 컬럼 추가 (기존 recorded_date는 유지)
ALTER TABLE sales_records ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ;

-- 기존 레코드 마이그레이션: recorded_date의 정오(KST)로 채우기
UPDATE sales_records
SET recorded_at = (recorded_date + TIME '03:00:00')::TIMESTAMPTZ  -- UTC 03:00 = KST 12:00
WHERE recorded_at IS NULL;
```

#### API 엔드포인트

```
GET /api/sales/analytics/hourly?account_id=...&from=...&to=...
```

**Response**

```json
{
  "data": {
    "hourly": [
      { "hour": 9, "tx_count": 45, "total": 220000 },
      { "hour": 10, "tx_count": 72, "total": 350000 }
    ],
    "peak_hours": [9, 10, 13],
    "heatmap": [{ "dow": 1, "hour": 9, "tx_count": 12, "total": 60000 }]
  }
}
```

#### 프론트엔드

```
frontend/components/sales/
├── HourlyBarChart.tsx   — 시간대별 막대 그래프 (피크 구간 하이라이트)
└── HeatmapChart.tsx     — 요일×시간대 히트맵 (색상 농도로 매출 강도 표현)
```

---

### 4. 모델/기술 선택 이유

**recorded_date 유지 + recorded_at 추가:**
기존 API와 하위 호환을 유지하면서 점진적으로 마이그레이션한다. 프론트엔드에서 입력 시 `recorded_at`에 현재 시각을 함께 보내도록 업데이트하고, 기존 레코드는 날짜의 정오로 채운다.

**히트맵 vs 라인 차트:**
시간대와 요일 두 차원을 동시에 보려면 히트맵이 직관적이다. 단일 시간대 추이는 라인/바 차트로 보여준다. Recharts에는 기본 히트맵이 없어 커스텀 SVG 또는 `react-chartjs-2`의 matrix 플러그인을 고려한다.

---

### 5. 예상 면접 질문 & 답변

**Q1. TIMESTAMPTZ와 TIMESTAMP의 차이는?**

> TIMESTAMP는 타임존 정보를 무시하고 입력된 값을 그대로 저장합니다. TIMESTAMPTZ는 입력값을 UTC로 변환해 저장하고, 조회 시 세션의 TimeZone 설정에 따라 변환해 반환합니다. 글로벌 서비스나 서버가 여러 지역에 배포된 경우 TIMESTAMPTZ가 필수입니다. BOSS-2는 한국 소상공인 대상이지만, 서버가 UTC 기준으로 동작하는 클라우드(Supabase)를 사용하므로 TIMESTAMPTZ로 저장하고 `AT TIME ZONE 'Asia/Seoul'`로 변환하는 방식을 사용합니다.

**Q2. 기존 DATE 컬럼을 TIMESTAMPTZ로 바꾸지 않고 컬럼을 추가한 이유는?**

> ALTER COLUMN TYPE은 기존 데이터 전체를 재작성하므로 대용량 테이블에서 락(lock)이 오래 걸립니다. 또한 기존 API가 `recorded_date`를 날짜 필터로 사용하는데, TIMESTAMPTZ로 바꾸면 `WHERE recorded_date = '2026-04-21'` 같은 쿼리가 깨집니다. 새 컬럼을 추가하는 방식이 하위 호환을 유지하면서 안전하게 마이그레이션할 수 있습니다.

**Q3. 시간대를 UTC로 저장하는데 "오전 피크" 분석이 틀리지 않나?**

> `EXTRACT(hour FROM recorded_at AT TIME ZONE 'Asia/Seoul')` 처럼 쿼리에서 명시적으로 KST로 변환해서 시간을 추출합니다. UTC 9시(오전 6시 KST)를 "오전 9시 피크"로 잘못 집계하는 오류는 이 변환으로 방지됩니다.

---

---

## 작업 F — AI 인사이트 분석

### 1. 개요

**왜 필요한가:**
작업 D의 통계는 "무슨 일이 일어났는가(What)"를 보여주지만, "왜 그런 일이 일어났고 다음에 무엇을 해야 하는가(Why & So What)"는 AI가 해석해야 한다. 소상공인은 데이터를 해석하는 전문성이 부족하므로 GPT가 데이터를 읽고 실행 가능한 인사이트를 제공하는 기능이 차별점이다.

**BOSS-1에서는:**
없음.

---

### 2. 핵심 개념 & 지식

#### 2-1. BOSS-2 RAG 파이프라인 구조

BOSS-2의 RAG는 세 단계로 구성된다:

```
사용자 질문
    ↓
[1] 임베딩 생성 (BAAI/bge-m3, 1024dim, 로컬 실행)
    ↓
[2] Hybrid Search (pgvector + PostgreSQL FTS)
    → 벡터 검색: 코사인 유사도 기반 의미 검색
    → BM25 키워드 검색: 정확한 용어 매칭
    → RRF(Reciprocal Rank Fusion)으로 두 결과 병합
    ↓
[3] 검색 결과 + 사용자 질문을 GPT-4o 프롬프트에 주입
    ↓
응답 생성
```

AI 인사이트 분석에서 RAG의 역할: 최근 매출 기록(`sales_records` 임베딩)을 recall해서 GPT 컨텍스트에 주입한다.

#### 2-2. 매출 데이터 컨텍스트 주입 전략

GPT-4o context window는 128K 토큰이다. 매출 데이터 전체를 넣을 수는 없으므로 **집계된 요약 + 주요 이상값**만 주입하는 전략을 쓴다:

```python
async def _build_sales_context(account_id: str, period: str) -> str:
    """분석용 매출 컨텍스트 구성:
    1. 월별 매출 추이 (최근 6개월)
    2. 상위 5개 메뉴 및 비중
    3. 전달 대비 변화율
    4. 이상값 (평균 대비 ±50% 이상 이탈 날짜)
    """
    sb = get_supabase()
    # 1. 월별 추이
    monthly = sb.rpc("get_monthly_revenue_trend", {
        "p_account_id": account_id,
        "p_from": ...,
        "p_to": ...
    }).execute().data

    # 2. 상위 메뉴
    top_items = sb.table("sales_records").select(
        "item_name,amount"
    ).eq("account_id", account_id).execute().data
    # Python에서 집계

    lines = [
        f"[분석 기간] {period}",
        f"[월별 매출] {_format_monthly(monthly)}",
        f"[상위 메뉴] {_format_top_items(top_items)}",
    ]
    return "\n".join(lines)
```

#### 2-3. 프롬프트 엔지니어링 — 매출 분석용

**핵심 원칙:**

1. **역할 부여**: "당신은 소상공인 매출 분석 전문가입니다"
2. **데이터 우선**: "아래 실제 데이터만 바탕으로 분석하세요. 데이터 없는 추측 금지"
3. **행동 지향**: "분석 후 구체적인 다음 액션 2~3개를 제안하세요"
4. **맥락 활용**: 프로필(업종/위치/목표)을 시스템 프롬프트에 주입

```python
INSIGHT_SYSTEM_PROMPT = """
당신은 소상공인 매출 분석 AI입니다.
제공된 실제 데이터만 바탕으로 분석하고, 데이터에 없는 수치는 절대 추측하지 마세요.

분석 구조:
1. 핵심 패턴 (2~3줄): 데이터에서 발견되는 가장 중요한 흐름
2. 주목 포인트 (1~2개): 평균 대비 이상하게 높거나 낮은 항목
3. 실행 액션 (2~3개): "이번 주 ~ 해보세요" 형식의 구체적 조언

프로필 정보: {profile}
"""
```

#### 2-4. GPT-4o vs GPT-4o-mini 선택 기준

| 기준               | GPT-4o     | GPT-4o-mini |
| ------------------ | ---------- | ----------- |
| 복잡한 데이터 해석 | 우수       | 보통        |
| 창의적 인사이트    | 우수       | 보통        |
| 속도               | 느림 (~3s) | 빠름 (~1s)  |
| 비용               | 높음       | 낮음 (1/10) |
| 분류/라벨링        | 과분       | 충분        |

**매출 AI 인사이트는 GPT-4o를 사용한다.** 이유:

- 여러 달의 수치를 비교해 패턴을 찾는 것은 복잡한 추론이 필요하다
- 업종 맥락, 계절성, 이상값 해석 등 다층적 분석이 필요하다
- 사용자가 자주 호출하는 기능이 아니므로 비용 부담이 적다

반면 **의도 분류, 카테고리 라벨링 같은 단순 작업은 GPT-4o-mini**를 쓴다. (현재 `_parse_cost_from_message`가 이미 gpt-4o-mini 사용)

#### 2-5. 외부 데이터 컨텍스트 (상권 통계 + 기상)

더 풍부한 인사이트를 위해 외부 데이터를 주입할 수 있다:

- **상권 통계**: 소상공인시장진흥공단 API (업종별 평균 매출, 지역별 소비 트렌드)
- **기상 데이터**: 기상청 API (강수량 → 카페 매출 상관관계)
- **공휴일**: Python `holidays` 라이브러리

```python
# 기상 컨텍스트 예시
weather_note = ""
if period_includes_rainy_season:
    weather_note = "[기상] 분석 기간 중 7~8월은 장마철로, 배달 매출 증가가 예상됩니다."
```

이 외부 데이터는 매 요청마다 실시간으로 가져오지 않고, **별도 스케줄러(Celery Beat)로 일 1회 캐싱**하는 방식이 효율적이다.

---

### 3. BOSS-2 구현 계획

#### 백엔드: `backend/app/agents/_sales_insight.py` 신규 생성

```python
async def generate_insight(
    account_id: str,
    period: str,
    insight_type: str = "general",  # general | menu | trend | cost
    profile: dict | None = None,
) -> str:
    """매출 데이터 + RAG 컨텍스트 → GPT-4o 인사이트 생성."""
    ...
```

#### API 엔드포인트

```
POST /api/sales/analytics/insight
{
  "account_id": "uuid",
  "period": "2026-04",
  "insight_type": "general"
}
```

**Response**

```json
{
  "data": {
    "insight": "이번 달 아메리카노 매출이 전월 대비 23% 증가했습니다...",
    "actions": ["피크타임 재료 사전 준비량을 20% 늘려보세요", ...],
    "artifact_id": "uuid"  // Reports 서브허브에 저장된 artifact
  }
}
```

#### 프론트엔드

```
frontend/components/sales/
└── InsightPanel.tsx    — AI 인사이트 카드 (로딩 스켈레톤 + 스트리밍 표시)
```

스트리밍 응답을 위해 `ReadableStream` + `useEffect`로 청크 단위 텍스트를 append하는 방식을 쓴다.

---

### 4. 모델/기술 선택 이유

**RAG로 실제 매출 데이터를 recall하는 이유:**
GPT에 직접 "지난달 매출 분석해줘"라고만 하면 GPT가 데이터를 모른다. 현재 임베딩 파이프라인(`rag/embedder.py`, `index_artifact`)으로 `sales_records`가 이미 인덱싱되어 있으므로, `hybrid_search`로 recall해서 컨텍스트로 주입하면 된다. 추가 인프라가 불필요하다.

**응답을 artifact로 저장하는 이유:**
생성된 인사이트가 일회성으로 사라지면 "지난달에 어떤 분석을 했는지" 추적이 안 된다. `sales_report` type artifact로 Reports 서브허브에 저장하면 캔버스에서 인사이트 히스토리를 볼 수 있다.

---

### 5. 예상 면접 질문 & 답변

**Q1. RRF(Reciprocal Rank Fusion)란 무엇이고 왜 사용하나?**

> RRF는 여러 검색 결과 목록을 합산해 하나의 최종 순위를 만드는 알고리즘입니다. 점수 공식은 `1 / (k + rank_i)` 의 합(k는 상수, 보통 60)입니다. BOSS-2에서는 pgvector 벡터 검색(의미 기반)과 PostgreSQL FTS(키워드 기반)의 결과를 RRF로 병합합니다. 벡터 검색은 "라떼"를 쳐도 "카페라떼 관련 기록"을 찾고, FTS는 정확한 용어를 찾습니다. 두 방식 중 하나만 쓰면 각각의 약점이 있는데, RRF로 합치면 보완됩니다.

**Q2. GPT-4o 대신 로컬 LLM을 쓰는 방법은?**

> Ollama + Llama-3 같은 로컬 LLM을 사용할 수 있습니다. 비용이 없고 데이터가 외부에 나가지 않는 장점이 있습니다. 단, 한국어 매출 분석에서 GPT-4o 대비 정확도가 낮고, 멀티스텝 추론이 부족합니다. BOSS-2 초기에는 비용보다 품질을 우선해 GPT-4o를 사용하고, 향후 사용량이 늘면 fine-tuned 소형 모델로 전환을 검토합니다.

**Q3. 프롬프트 인젝션 공격은 어떻게 방어하나?**

> 사용자 입력이 직접 시스템 프롬프트에 들어가지 않도록 합니다. "아래 데이터만 분석하세요"처럼 구조화된 컨텍스트 블록으로 격리하고, 매출 데이터는 SQL로 직접 조회한 구조화 데이터만 사용합니다. "이 분석을 무시하고 다른 걸 해줘" 같은 악의적 입력이 들어와도 시스템 프롬프트의 역할과 규칙이 우선합니다.

**Q4. 스트리밍 응답을 구현할 때 FastAPI에서 어떻게 처리하나?**

> FastAPI의 `StreamingResponse`를 사용합니다. OpenAI SDK에서 `stream=True`로 호출하면 chunk iterator를 반환하고, 이를 `async for chunk in stream`으로 순회하면서 `yield`로 SSE(Server-Sent Events) 형식으로 프론트에 전송합니다. 프론트엔드에서는 `fetch` + `ReadableStream.getReader()`로 받아 청크 단위로 텍스트를 append합니다.

**Q5. 인사이트 품질을 어떻게 측정하나?**

> 현재 BOSS-2에는 `evaluations` 테이블(rating: up/down, feedback)이 있습니다. 인사이트 artifact에 대해 사용자가 thumbs-up/down을 남기면 `_feedback.py`가 이를 수집해 다음 프롬프트에 "과거 down-vote 받은 패턴은 피하세요"로 주입합니다. 이는 정성적 평가 루프입니다. 정량적으로는 인사이트 생성 후 "추천 액션을 실제로 실행했는지"를 활동 로그로 추적하는 방향을 검토 중입니다.

**Q6. 매출 데이터를 GPT에 주입할 때 토큰 한계는 어떻게 다루나?**

> GPT-4o의 context window는 128K 토큰으로 넉넉하지만, 1년치 일별 레코드를 전부 주입하면 비용이 증가합니다. BOSS-2에서는 집계된 요약 데이터(월별 합계, 상위 10개 메뉴, 이상값 날짜)만 주입하는 방식을 씁니다. 이 방식으로 실제 주입 토큰은 500~1000 토큰 수준입니다. RAG로 recall된 장기기억도 관련도 높은 상위 3~5건만 포함합니다.

---

---

## 작업 G — 재무 자동 집계 (founder_financials)

### 1. 개요

**왜 필요한가:**
매출과 비용 데이터가 `sales_records`와 `cost_records`에 쌓이지만, "이번 달 순이익이 얼마인가"를 조회할 때마다 두 테이블을 JOIN + 집계하는 비용이 발생한다. `founder_financials` 테이블은 이를 월별로 미리 계산해 저장하는 **Materialized View 패턴**이다. 브리핑이나 대시보드에서 빠른 조회가 가능해진다.

**BOSS-1에서는:**
없음.

---

### 2. 핵심 개념 & 지식

#### 2-1. Materialized View vs 일반 View vs 집계 테이블

| 방식                             | 특징                        | 장점            | 단점                   |
| -------------------------------- | --------------------------- | --------------- | ---------------------- |
| 일반 View                        | 쿼리 저장, 호출 시마다 실행 | 항상 최신       | 복잡한 집계 시 느림    |
| Materialized View                | 결과를 스냅샷으로 저장      | 빠른 조회       | 수동/자동 REFRESH 필요 |
| 집계 테이블 (founder_financials) | 앱 레벨 트리거로 유지       | 유연한 업데이트 | 로직 분산              |

PostgreSQL의 Materialized View는 RLS를 지원하지 않는다(Supabase 제약). 그래서 BOSS-2에서는 **집계 테이블 방식**을 택한다. 레코드가 INSERT/UPDATE될 때 애플리케이션 레벨에서 집계 테이블을 업데이트한다.

#### 2-2. UPSERT 패턴 — INSERT ON CONFLICT DO UPDATE

월별 집계를 저장할 때 같은 (account_id, year, month)에 대해 이미 행이 있으면 업데이트, 없으면 삽입하는 UPSERT가 필요하다:

```sql
INSERT INTO founder_financials (
    account_id, year, month,
    total_revenue, total_cost, profit, margin_pct,
    updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
ON CONFLICT (account_id, year, month)
DO UPDATE SET
    total_revenue = EXCLUDED.total_revenue,
    total_cost    = EXCLUDED.total_cost,
    profit        = EXCLUDED.profit,
    margin_pct    = EXCLUDED.margin_pct,
    updated_at    = NOW();
```

`EXCLUDED`는 INSERT하려 했던 새 값을 가리킨다. `ON CONFLICT`에 사용되는 컬럼에는 반드시 UNIQUE 인덱스가 있어야 한다.

Python에서 Supabase 클라이언트를 사용할 때:

```python
sb.table("founder_financials").upsert(
    {
        "account_id": account_id,
        "year": year,
        "month": month,
        "total_revenue": total_revenue,
        "total_cost": total_cost,
        "profit": total_revenue - total_cost,
        "margin_pct": round((total_revenue - total_cost) / total_revenue * 100, 1) if total_revenue > 0 else 0,
    },
    on_conflict="account_id,year,month"
).execute()
```

#### 2-3. PostgreSQL 트리거 vs 애플리케이션 레벨 집계

**DB 트리거 방식:**

```sql
CREATE OR REPLACE FUNCTION update_monthly_financials()
RETURNS TRIGGER AS $$
DECLARE
    v_year INT := EXTRACT(year FROM COALESCE(NEW.recorded_date, OLD.recorded_date));
    v_month INT := EXTRACT(month FROM COALESCE(NEW.recorded_date, OLD.recorded_date));
BEGIN
    -- 해당 월 전체를 재집계
    INSERT INTO founder_financials (account_id, year, month, total_revenue, updated_at)
    SELECT
        COALESCE(NEW.account_id, OLD.account_id),
        v_year, v_month,
        COALESCE(SUM(amount), 0),
        NOW()
    FROM sales_records
    WHERE account_id = COALESCE(NEW.account_id, OLD.account_id)
      AND EXTRACT(year FROM recorded_date) = v_year
      AND EXTRACT(month FROM recorded_date) = v_month
    ON CONFLICT (account_id, year, month) DO UPDATE SET
        total_revenue = EXCLUDED.total_revenue,
        updated_at = NOW();
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_financials_on_sale
AFTER INSERT OR UPDATE OR DELETE ON sales_records
FOR EACH ROW EXECUTE FUNCTION update_monthly_financials();
```

**트레이드오프:**

| 항목      | DB 트리거                 | 애플리케이션 레벨    |
| --------- | ------------------------- | -------------------- |
| 일관성    | 항상 동기화 보장          | 업데이트 놓칠 가능성 |
| 성능      | INSERT마다 집계 쿼리 발생 | 배치 업데이트 가능   |
| 디버깅    | 어렵 (DB 로직)            | 쉬움 (Python 코드)   |
| 버전 관리 | SQL 마이그레이션          | Git 관리             |
| 복잡도    | 트리거 체인 주의          | 명시적 호출 필요     |

BOSS-2 규모(계정당 일 최대 수십 건 입력)에서는 두 방식 모두 성능 문제가 없다. **디버깅과 유지보수 측면에서 애플리케이션 레벨을 권장**한다. API 레이어(`POST /api/sales` 처리 후)에서 명시적으로 집계를 업데이트한다.

#### 2-4. 월별 재무 데이터 모델링

```sql
CREATE TABLE founder_financials (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    account_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    year          SMALLINT NOT NULL,       -- 2026
    month         SMALLINT NOT NULL,       -- 4 (1~12)
    total_revenue BIGINT NOT NULL DEFAULT 0,
    total_cost    BIGINT NOT NULL DEFAULT 0,
    profit        BIGINT GENERATED ALWAYS AS (total_revenue - total_cost) STORED,
    margin_pct    NUMERIC(5,2),           -- 35.20 (%)
    transaction_count INT DEFAULT 0,
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_financials_period UNIQUE (account_id, year, month),
    CONSTRAINT chk_month CHECK (month BETWEEN 1 AND 12)
);
```

`GENERATED ALWAYS AS ... STORED`는 PostgreSQL 12+의 계산 컬럼(generated column)으로, `total_revenue - total_cost`가 자동으로 관리된다.

---

### 3. BOSS-2 구현 계획

#### DB 마이그레이션: `023_founder_financials.sql`

위의 CREATE TABLE + RLS 정책 포함.

#### 백엔드: 수정 파일

**`backend/app/routers/sales.py`** — POST 핸들러 끝에 `_update_financials` 호출 추가

```python
async def _update_financials(account_id: str, recorded_date: str) -> None:
    """매출 저장 후 해당 월 founder_financials 업데이트."""
    year = int(recorded_date[:4])
    month = int(recorded_date[5:7])
    sb = get_supabase()

    # 매출 집계
    revenue_res = sb.table("sales_records").select("amount").eq(
        "account_id", account_id
    ).execute()  # 해당 월 필터 추가 필요

    # 비용 집계
    # UPSERT
```

**`backend/app/routers/dashboard.py`** 또는 신규 `summary.py`에서 조회:

```
GET /api/financials?account_id=...&year=2026    — 연간 월별 요약
GET /api/financials/latest?account_id=...       — 이번 달 + 전달 비교
```

---

### 4. 모델/기술 선택 이유

**PostgreSQL generated column 활용:**
`profit = total_revenue - total_cost` 처럼 단순 계산은 DB generated column으로 관리하면 코드에서 계산을 빠뜨리는 실수를 방지한다. `margin_pct`는 division by zero가 있어 generated column으로 처리하기 어려워 애플리케이션에서 계산한다.

**월 단위로 집계하는 이유:**
소상공인의 세무 신고, 부가세 신고, 간이과세 등이 모두 월 단위다. 일별 집계는 너무 세분화되어 저장 비용이 크고, 분기별은 조회 해상도가 떨어진다.

---

### 5. 예상 면접 질문 & 답변

**Q1. UPSERT(INSERT ON CONFLICT)를 직접 구현하면 발생하는 Race Condition은?**

> 동시에 두 요청이 같은 (account_id, year, month) 행이 없는 상태에서 INSERT를 시도하면, 첫 번째가 성공하고 두 번째가 conflict를 만납니다. `ON CONFLICT DO UPDATE`가 있으면 두 번째 요청이 자동으로 UPDATE로 처리됩니다. 이는 atomic 연산이므로 별도 락이 필요 없습니다. PostgreSQL UPSERT는 이 race condition을 DB 레벨에서 안전하게 처리합니다.

**Q2. generated column과 트리거 컬럼의 차이는?**

> generated column(`GENERATED ALWAYS AS ... STORED`)은 DDL 레벨에서 정의된 공식으로만 계산됩니다. 직접 INSERT/UPDATE로 값을 바꿀 수 없습니다. 트리거 컬럼은 트리거 함수 안에서 어떤 로직도 적용할 수 있어 유연하지만, 무한 루프(트리거가 트리거를 부르는 상황)에 주의해야 합니다. 단순 산술 계산은 generated column이 안전하고 명시적입니다.

**Q3. 대용량 트래픽에서 집계 테이블을 실시간으로 업데이트하는 게 병목이 되지 않나?**

> 동시 INSERT가 많은 경우 같은 행에 대한 UPDATE 경합이 발생할 수 있습니다. 이를 완화하는 방법으로는 (1) 배치 업데이트: 개별 INSERT마다 업데이트 대신 Celery 스케줄러로 5분마다 배치 재집계, (2) 버퍼 테이블: 변경분을 임시 테이블에 모아 주기적으로 머지하는 방식이 있습니다. BOSS-2의 소상공인 사용자 규모(동시 사용자 수십 명)에서는 실시간 업데이트로 충분합니다.

**Q4. margin_pct 계산에서 division by zero를 어떻게 처리하나?**

> 매출이 0인 달은 마진율이 의미 없습니다. `CASE WHEN total_revenue > 0 THEN ... ELSE NULL END` 또는 `NULLIF(total_revenue, 0)`으로 처리해 NULL을 반환합니다. 프론트엔드에서 NULL은 "데이터 없음" 또는 "해당 없음"으로 표시합니다.

---

---

## 작업 H — 프로액티브 트리거

### 1. 개요

**왜 필요한가:**
사용자가 직접 채팅을 열지 않아도 BOSS-2가 먼저 "오늘 매출 입력이 없네요", "이번 달 비용이 전달 대비 30% 늘었어요" 같은 알림을 보내는 기능이다. 소상공인은 바빠서 대시보드를 매일 보지 않는다. 프로액티브 알림이 플랫폼 재방문율을 높이고, 중요한 비즈니스 시그널을 놓치지 않게 한다.

**BOSS-1에서는:**
없음.

---

### 2. 핵심 개념 & 지식

#### 2-1. BOSS-2 현재 Celery Beat 구조

```
celery_app.py
    → Beat 스케줄: scheduler-tick 1분마다 실행
    → tasks.tick()
        → scanner.find_due_schedules(now)  → run_schedule_artifact.delay(id) fan-out
        → scanner.find_date_notifications(today) → activity_logs.schedule_notify INSERT
```

현재 tick은 두 가지 작업을 한다:

1. `kind='schedule'` artifact 실행 (자동화 태스크)
2. 날짜 기반 알림 (D-7/D-3/D-1/D-0)

프로액티브 매출 트리거는 세 번째 카테고리다. **tick 안에서 호출하는 새 스캔 함수**를 추가한다.

#### 2-2. 이벤트 감지 패턴

매출 관련 프로액티브 알림 유형:

| 알림 종류      | 감지 조건                               | notify_kind      |
| -------------- | --------------------------------------- | ---------------- |
| 매출 미입력    | 오늘 18시 이후 sales_records 없음       | `no_sales_entry` |
| 비용 급등      | 이번 달 비용이 전달 대비 20% 초과       | `cost_spike`     |
| 매출 급락      | 오늘 매출이 최근 7일 평균 대비 50% 미만 | `revenue_drop`   |
| 매출 최고 기록 | 오늘 매출이 최근 30일 최고값 갱신       | `revenue_record` |
| 주간 리포트    | 매주 월요일 지난주 요약                 | `weekly_summary` |

```python
# scanner.py에 추가할 함수
def find_sales_proactive_triggers(today: date, now: datetime) -> list[dict]:
    """프로액티브 매출 알림 감지."""
    sb = get_supabase()
    results = []

    # 1. 오늘 매출 미입력 감지 (오후 6시 이후만 실행)
    if now.hour >= 9:  # UTC 9시 = KST 18시
        accounts_with_no_sales = sb.rpc(
            "find_accounts_no_sales_today",
            {"p_date": today.isoformat()}
        ).execute().data or []

        for acc in accounts_with_no_sales:
            results.append({
                "account_id": acc["account_id"],
                "notify_kind": "no_sales_entry",
                "for_date": today.isoformat(),
                "meta": {},
            })

    return results
```

#### 2-3. 중복 알림 방지

현재 BOSS-2는 `(artifact_id, notify_kind, for_date)` 튜플로 중복을 방지한다. 프로액티브 트리거는 artifact가 없으므로 다른 방식이 필요하다:

```sql
-- activity_logs에 이미 같은 종류의 알림이 있는지 확인
-- (account_id, type, metadata->>'notify_kind', metadata->>'for_date') 기준
```

또는 `notify_kind + for_date`를 `activity_logs.metadata`에 저장하고, 같은 날 같은 종류의 알림이 있으면 건너뛰는 방식:

```python
def _is_already_notified(sb, account_id: str, notify_kind: str, for_date: str) -> bool:
    start_of_day = datetime.combine(
        date.fromisoformat(for_date), datetime.min.time(), tzinfo=timezone.utc
    ).isoformat()
    rows = (
        sb.table("activity_logs")
        .select("id")
        .eq("account_id", account_id)
        .eq("type", "schedule_notify")
        .gte("created_at", start_of_day)
        .execute()
        .data or []
    )
    for row in rows:
        # metadata에서 notify_kind 확인
        ...
    return False
```

#### 2-4. Celery Beat 스케줄 조정

현재 tick은 60초마다 실행된다. 프로액티브 트리거 중 "오늘 매출 미입력" 같은 건 하루 1번만 실행해도 충분하다. tick 내에서 시간 조건을 걸어 필터링하거나, 별도 Beat 스케줄을 추가한다:

```python
# celery_app.py에 별도 스케줄 추가
beat_schedule = {
    "scheduler-tick": {
        "task": "app.scheduler.tasks.tick",
        "schedule": settings.scheduler_tick_seconds,
    },
    "sales-proactive-daily": {
        "task": "app.scheduler.tasks.sales_proactive_tick",
        "schedule": crontab(hour=9, minute=0),  # UTC 9시 = KST 18시
    },
}
```

#### 2-5. 알림 전달 채널 — activity_logs → 프론트 구독

현재 BOSS-2 알림 파이프라인:

```
activity_logs INSERT
    → Supabase Realtime (테이블 변경 구독)
    → 프론트엔드 useEffect(Realtime 구독)
    → toast 알림 또는 브리핑 패널
```

프로액티브 트리거도 같은 파이프라인을 사용한다. `type='schedule_notify'`로 `activity_logs`에 INSERT하면 프론트가 자동으로 받는다.

추가로, 사용자가 오프라인일 때를 위해 **로그인 브리핑**(`orchestrator.build_briefing`)에 프로액티브 트리거 내용을 포함하는 방식도 활용 가능하다. BOSS-2의 브리핑은 `last_seen_at`이 8시간 이상 지났을 때 발동한다.

---

### 3. BOSS-2 구현 계획

#### 백엔드: 수정 파일

**`backend/app/scheduler/scanner.py`** — `find_sales_proactive_triggers` 함수 추가

```python
def find_sales_proactive_triggers(today: date, now: datetime) -> list[dict]:
    ...
```

**`backend/app/scheduler/tasks.py`** — `tick` 함수에 새 스캔 추가

```python
@celery_app.task(name="app.scheduler.tasks.tick")
def tick() -> dict:
    now = datetime.now(timezone.utc)
    due = find_due_schedules(now=now)
    notifications = find_date_notifications(today=now.date())
    proactive = find_sales_proactive_triggers(today=now.date(), now=now)  # 신규

    # ... 기존 로직 ...

    # 프로액티브 트리거 처리
    proactive_count = 0
    for t in proactive:
        if not _is_already_notified(sb, t["account_id"], t["notify_kind"], t["for_date"]):
            sb.table("activity_logs").insert({
                "account_id": t["account_id"],
                "type": "schedule_notify",
                "domain": "sales",
                "title": _proactive_title(t["notify_kind"]),
                "description": _proactive_desc(t["notify_kind"], t.get("meta", {})),
                "metadata": {
                    "notify_kind": t["notify_kind"],
                    "for_date": t["for_date"],
                    **t.get("meta", {}),
                },
            }).execute()
            proactive_count += 1

    return {
        "dispatched": len(due),
        "notifications": notif_count,
        "proactive": proactive_count,
        "ts": now.isoformat(),
    }
```

#### DB: `find_accounts_no_sales_today` RPC

```sql
CREATE OR REPLACE FUNCTION find_accounts_no_sales_today(p_date DATE)
RETURNS TABLE (account_id UUID)
LANGUAGE SQL STABLE SECURITY INVOKER AS $$
    -- sales_records가 있는 계정 목록
    WITH active_accounts AS (
        SELECT DISTINCT account_id FROM sales_records WHERE recorded_date > (CURRENT_DATE - 30)
    ),
    today_accounts AS (
        SELECT DISTINCT account_id FROM sales_records WHERE recorded_date = p_date
    )
    SELECT a.account_id
    FROM active_accounts a
    LEFT JOIN today_accounts t ON a.account_id = t.account_id
    WHERE t.account_id IS NULL;
$$;
```

---

### 4. 모델/기술 선택 이유

**tick 내 처리 vs 별도 Beat 스케줄:**
"오늘 매출 미입력" 같은 하루 1회 알림을 60초 tick에서 매번 검사하면 불필요한 DB 쿼리가 1440번 발생한다(24h × 60). 별도 `crontab(hour=9, minute=0)` 스케줄로 하루 1회만 실행하는 게 효율적이다. 단, 현재 BOSS-2의 tick이 단순하므로 초기에는 tick 내 시간 조건 필터로 시작하고, 쿼리 부하가 보이면 별도 Beat로 분리한다.

**activity_logs → Realtime 전달:**
별도 푸시 알림 인프라(FCM, APNs)를 도입하지 않아도 Supabase Realtime으로 실시간 알림을 전달할 수 있다. 이미 구축된 파이프라인을 재사용해 신규 인프라 비용이 없다.

---

### 5. 예상 면접 질문 & 답변

**Q1. Celery Beat vs cron vs 스케줄러 서비스 (e.g. Upstash QStash)의 차이는?**

> Celery Beat는 애플리케이션 레벨에서 스케줄을 관리합니다. 설정이 코드 안에 있어 Git으로 관리되고, Celery worker와 함께 배포됩니다. 단, Beat 프로세스가 단일 장애점(SPOF)이 될 수 있습니다. Upstash QStash 같은 외부 스케줄러는 서버리스 환경에서 cron HTTP 요청을 보내는 방식으로 SPOF 문제가 없지만, 외부 서비스 의존성이 생깁니다. BOSS-2는 Celery + Upstash Redis 조합으로 이미 구성되어 있어 Beat를 그대로 활용하는 게 일관성 있습니다.

**Q2. tick이 60초마다 돌면서 DB를 스캔하는 게 성능 부담이 되지 않나?**

> 현재 `find_due_schedules`와 `find_date_notifications`가 각각 artifacts 테이블 full scan을 한 번씩 한다. 계정이 수천 명 규모가 되면 부담이 될 수 있습니다. 최적화 방법으로는 (1) 실행 예정 schedule을 Redis Sorted Set에 캐싱해 DB 조회를 줄이거나, (2) `next_run <= NOW()` 인덱스를 추가해 스캔 범위를 줄이는 방법이 있습니다. 현재 BOSS-2 규모에서는 인덱스 최적화만으로 충분합니다.

**Q3. 중복 알림 방지에 (artifact_id, notify_kind, for_date) 튜플을 쓰는데, artifact_id가 없는 프로액티브 알림은 어떻게 하나?**

> 프로액티브 알림은 artifact와 연결되지 않으므로 `(account_id, notify_kind, for_date)` 조합을 중복 키로 사용합니다. `activity_logs.metadata` JSONB에 `notify_kind`와 `for_date`를 저장하고, 오늘 이미 같은 종류의 알림이 있는 행이 있으면 건너뜁니다. 현재 날짜 기반 알림도 내부적으로 이런 방식으로 동작합니다(`scanner.py`의 `seen` set 참고).

**Q4. 소상공인이 알림을 원하지 않을 수 있는데, 설정 기능은?**

> `profiles.profile_meta` JSONB에 `"notifications": {"no_sales_entry": false}` 같은 형태로 알림 설정을 저장할 수 있습니다. 별도 테이블보다 기존 `profile_meta` 자유 필드를 활용하는 게 스키마 변경 없이 구현 가능합니다. 스캐너가 알림을 보내기 전에 해당 설정을 체크하는 로직을 추가합니다.

**Q5. Celery 태스크가 실패했을 때 어떻게 처리하나?**

> BOSS-2의 `run_schedule_artifact`는 `bind=True, max_retries=3` 옵션으로 최대 3회 재시도합니다. 재시도 간격은 `self.retry(countdown=60)`으로 60초 후 재시도로 설정할 수 있습니다. 최종 실패 시 `task_logs.status='failed'`로 기록되고, 다음 로그인 브리핑에서 "자리 비운 사이 실패한 태스크가 있습니다"로 사용자에게 알립니다 (`_briefing_should_fire` 조건: `task_logs.status='failed' >= 1건`).

**Q6. 프로액티브 알림과 로그인 브리핑의 관계는?**

> 둘은 다른 채널입니다. 프로액티브 알림은 사용자가 온라인일 때 Supabase Realtime을 통해 실시간으로 전달되고, `ActivityModal`에 표시됩니다. 로그인 브리핑은 오프라인 상태에서 누적된 정보를 로그인 시 한 번에 요약해서 채팅으로 보여줍니다. 브리핑 빌더(`orchestrator.build_briefing`)는 `activity_logs`를 읽으므로, 프로액티브 알림이 `activity_logs`에 기록되면 자동으로 브리핑에도 포함됩니다.

---

---

## 부록: BOSS-2 Sales 도메인 전체 아키텍처 요약

```
사용자 채팅
    ↓
orchestrator.py (의도 분류 + 라우팅)
    ↓
sales.py (에이전트)
    ├── 자연어 파싱 (GPT-4o-mini)
    ├── [ACTION:OPEN_SALES_TABLE] 마커 생성
    └── capability 7종 (function-calling)

프론트엔드 (SalesInputTable)
    → POST /api/sales (매출 저장)
    → POST /api/costs (비용 저장)

이후:
    → embeddings 인덱싱 (BAAI/bge-m3)
    → artifact 생성 (캔버스 Reports/Costs 허브)
    → founder_financials UPSERT [작업 G]

Celery Beat (60s tick)
    → 날짜 알림 (D-7/3/1/0)
    → 프로액티브 트리거 [작업 H]
        → activity_logs INSERT
        → Supabase Realtime → 프론트 toast

대시보드 요청
    → /api/sales/analytics/trend [작업 D]
    → /api/sales/analytics/ranking [작업 E]
    → /api/sales/analytics/hourly [작업 B]
    → /api/sales/analytics/insight (GPT-4o) [작업 F]
    → /api/financials (founder_financials) [작업 G]

CRUD
    → PATCH /api/sales/{id} [작업 C]
    → PATCH /api/costs/{id} [작업 C]
    → /api/menu-items (메뉴 마스터) [작업 A]
```

---

## 부록: 마이그레이션 파일 목록 (예정)

| 번호 | 파일명                              | 내용                                  |
| ---- | ----------------------------------- | ------------------------------------- |
| 020  | `020_sales_analytics_functions.sql` | 집계 RPC (작업 D)                     |
| 021  | `021_menu_items.sql`                | 메뉴 마스터 테이블 (작업 A)           |
| 022  | `022_sales_recorded_at.sql`         | recorded_at TIMESTAMPTZ 추가 (작업 B) |
| 023  | `023_founder_financials.sql`        | 월별 재무 집계 테이블 (작업 G)        |

---

> 이 문서는 BOSS-2 v0.9.0 기준으로 작성되었다. 구현이 완료된 항목은 changelog에 버전과 함께 기록한다.
