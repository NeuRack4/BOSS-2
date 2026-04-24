"""직원 관리 CRUD — /api/employees, /api/work-records."""
from __future__ import annotations

import calendar
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core.supabase import get_supabase

router = APIRouter(prefix="/api/employees", tags=["employees"])


# ── Pydantic models ──────────────────────────────────────────

class EmployeeCreate(BaseModel):
    account_id: str
    name: str
    employment_type: str  # 초단시간 | 시급제 | 월급제
    hourly_rate: Optional[int] = None
    monthly_salary: Optional[int] = None
    pay_day: Optional[int] = None
    phone: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    hire_date: Optional[str] = None  # YYYY-MM-DD


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    employment_type: Optional[str] = None
    hourly_rate: Optional[int] = None
    monthly_salary: Optional[int] = None
    pay_day: Optional[int] = None
    phone: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    hire_date: Optional[str] = None
    status: Optional[str] = None


class WorkRecordCreate(BaseModel):
    account_id: str
    work_date: str          # YYYY-MM-DD
    hours_worked: float = 0
    overtime_hours: float = 0
    night_hours: float = 0
    holiday_hours: float = 0
    memo: Optional[str] = None


class WorkRecordUpdate(BaseModel):
    hours_worked: Optional[float] = None
    overtime_hours: Optional[float] = None
    night_hours: Optional[float] = None
    holiday_hours: Optional[float] = None
    memo: Optional[str] = None


# ── Employee CRUD ─────────────────────────────────────────────

@router.get("")
async def list_employees(
    account_id: str = Query(...),
    status: str = Query("active"),
):
    sb = get_supabase()
    q = (
        sb.table("employees")
        .select("*")
        .eq("account_id", account_id)
        .order("name")
    )
    if status != "all":
        q = q.eq("status", status)
    res = q.execute()
    return {"data": res.data}


@router.post("")
async def create_employee(body: EmployeeCreate):
    sb = get_supabase()
    payload = body.model_dump(exclude={"account_id"}, exclude_none=True)
    payload["account_id"] = body.account_id
    res = sb.table("employees").insert(payload).execute()
    if not res.data:
        raise HTTPException(status_code=400, detail="직원 생성 실패")
    return {"data": res.data[0]}


@router.get("/{employee_id}")
async def get_employee(employee_id: str, account_id: str = Query(...)):
    sb = get_supabase()
    res = (
        sb.table("employees")
        .select("*")
        .eq("id", employee_id)
        .eq("account_id", account_id)
        .maybe_single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="직원을 찾을 수 없어요")
    return {"data": res.data}


@router.patch("/{employee_id}")
async def update_employee(
    employee_id: str,
    body: EmployeeUpdate,
    account_id: str = Query(...),
):
    sb = get_supabase()
    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="수정할 항목이 없어요")
    res = (
        sb.table("employees")
        .update(payload)
        .eq("id", employee_id)
        .eq("account_id", account_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="직원을 찾을 수 없어요")
    return {"data": res.data[0]}


@router.delete("/{employee_id}")
async def delete_employee(employee_id: str, account_id: str = Query(...)):
    sb = get_supabase()
    sb.table("employees").delete().eq("id", employee_id).eq("account_id", account_id).execute()
    return {"ok": True}


# ── Work Records ──────────────────────────────────────────────

@router.get("/{employee_id}/work-records")
async def list_work_records(
    employee_id: str,
    account_id: str = Query(...),
    month: Optional[str] = Query(None),  # YYYY-MM
):
    sb = get_supabase()
    q = (
        sb.table("work_records")
        .select("*")
        .eq("employee_id", employee_id)
        .eq("account_id", account_id)
    )
    if month:
        y, m = int(month[:4]), int(month[5:7])
        last_day = calendar.monthrange(y, m)[1]
        q = q.gte("work_date", f"{month}-01").lte("work_date", f"{month}-{last_day:02d}")
    res = q.order("work_date").execute()
    return {"data": res.data}


@router.post("/{employee_id}/work-records")
async def create_work_record(employee_id: str, body: WorkRecordCreate):
    sb = get_supabase()
    payload = {
        "employee_id": employee_id,
        "account_id": body.account_id,
        "work_date": body.work_date,
        "hours_worked": body.hours_worked,
        "overtime_hours": body.overtime_hours,
        "night_hours": body.night_hours,
        "holiday_hours": body.holiday_hours,
        "memo": body.memo,
    }
    res = (
        sb.table("work_records")
        .upsert(payload, on_conflict="employee_id,work_date")
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=400, detail="근무 기록 저장 실패")
    return {"data": res.data[0]}


# ── Work Record by ID (cross-employee) ───────────────────────

work_router = APIRouter(prefix="/api/work-records", tags=["employees"])


@work_router.patch("/{record_id}")
async def update_work_record(
    record_id: str,
    body: WorkRecordUpdate,
    account_id: str = Query(...),
):
    sb = get_supabase()
    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="수정할 항목이 없어요")
    res = (
        sb.table("work_records")
        .update(payload)
        .eq("id", record_id)
        .eq("account_id", account_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="기록을 찾을 수 없어요")
    return {"data": res.data[0]}


@work_router.delete("/{record_id}")
async def delete_work_record(record_id: str, account_id: str = Query(...)):
    sb = get_supabase()
    sb.table("work_records").delete().eq("id", record_id).eq("account_id", account_id).execute()
    return {"ok": True}
