"""
FlowMate backend aligned to the Schedule Debugger PRD.
"""

import json
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth import create_access_token, get_current_user, hash_password, verify_password
from database import (
    CalendarSnapshot,
    CheckinRecord,
    Event,
    JournalEntry,
    RescueSession,
    ScheduleAction,
    User,
    get_db,
    init_db,
)

load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GOOGLE_CLIENT_ID = os.getenv(
    "GOOGLE_CLIENT_ID",
    "1028741369796-0s022of7t00c0a969l7bkkq70bmsffo1.apps.googleusercontent.com",
)
PORT = int(os.getenv("PORT", 8000))
BASE_DIR = Path(__file__).resolve().parent
SYSTEM_PROMPT = (BASE_DIR / "system_prompt.txt").read_text(encoding="utf-8")

OPTIONAL_KEYWORDS = {"gym", "olahraga", "workout", "jalan sore", "hangout", "nongkrong"}
HEAVY_KEYWORDS = {
    "robotika",
    "coding",
    "deep",
    "project",
    "proyek",
    "praktikum",
    "laporan",
    "belajar",
    "thesis",
    "skripsi",
}
RECOVERY_TITLES = {"Recovery Block", "Makan & Recovery", "Power Nap", "Short Break"}

genai_model = None
if not DEMO_MODE and GEMINI_API_KEY:
    try:
        import google.generativeai as genai

        genai.configure(api_key=GEMINI_API_KEY)
        genai_model = genai.GenerativeModel(
            model_name="gemini-2.5-flash",
            system_instruction=SYSTEM_PROMPT,
            generation_config={
                "response_mime_type": "application/json",
                "temperature": 0.4,
            },
        )
        print("Gemini live mode enabled")
    except Exception as exc:
        print(f"Gemini init failed: {exc}. Falling back to the local recovery planner.")
else:
    print("Running with local recovery planner until Gemini is configured")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="FlowMate API", version="2.0.0")
init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class UserRegister(BaseModel):
    username: str
    email: str
    password: str


class GoogleAuthRequest(BaseModel):
    credential: str


class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    default_wake_time: Optional[str] = None
    default_sleep_hours: Optional[float] = Field(default=None, ge=1, le=16)
    timezone: Optional[str] = None
    focus_mode_enabled: Optional[bool] = None


class CalendarEvent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    start: str
    end: str
    is_immovable: bool = False
    priority: str = "medium"
    date: Optional[str] = None
    status: Optional[str] = None
    label: Optional[str] = None
    reason: Optional[str] = None


class RescueRequest(BaseModel):
    situation: str
    energy_level: int = Field(ge=1, le=10)
    mood: str = "overwhelmed"
    current_time: Optional[str] = None
    mode: str = "live"
    today_events: List[CalendarEvent] = Field(default_factory=list)


class ValidateScheduleRequest(BaseModel):
    original_events: List[CalendarEvent] = Field(default_factory=list)
    new_schedule: List[CalendarEvent] = Field(default_factory=list)
    energy_level: int = Field(ge=1, le=10)


class ApplyScheduleRequest(BaseModel):
    session_id: Optional[str] = None
    new_schedule: List[CalendarEvent]


class CheckinRequest(BaseModel):
    sleep_hours: float = Field(ge=0, le=24)
    wake_up_time: str
    energy_level: int = Field(ge=1, le=10)
    mood: str
    top_priority: str = ""
    today_events: List[CalendarEvent] = Field(default_factory=list)


class JournalRequest(BaseModel):
    text: str
    date: Optional[str] = None


class GcalSyncRequest(BaseModel):
    access_token: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def clamp(value: int, min_value: int, max_value: int) -> int:
    return max(min_value, min(max_value, value))


def parse_hhmm(value: str) -> int:
    hour, minute = value.split(":")
    return int(hour) * 60 + int(minute)


def format_hhmm(minutes: int) -> str:
    minutes = max(0, min(23 * 60 + 59, minutes))
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def ceil_to_step(minutes: int, step: int = 15) -> int:
    return ((minutes + step - 1) // step) * step


def event_duration(event: Dict[str, Any]) -> int:
    return max(15, parse_hhmm(event["end"]) - parse_hhmm(event["start"]))


def normalize_priority(priority: Optional[str]) -> str:
    if priority in {"high", "medium", "low"}:
        return priority
    return "medium"


def normalize_event(event: Dict[str, Any], fallback_date: str) -> Dict[str, Any]:
    normalized = {
        "id": event.get("id") or str(uuid.uuid4()),
        "title": event.get("title", "Untitled Event").strip() or "Untitled Event",
        "start": event.get("start", "09:00"),
        "end": event.get("end", "10:00"),
        "is_immovable": bool(event.get("is_immovable", False)),
        "priority": normalize_priority(event.get("priority")),
        "date": event.get("date") or fallback_date,
        "status": event.get("status"),
        "label": event.get("label"),
        "reason": event.get("reason"),
    }
    if parse_hhmm(normalized["end"]) <= parse_hhmm(normalized["start"]):
        end_minutes = min(parse_hhmm(normalized["start"]) + 60, 23 * 60)
        normalized["end"] = format_hhmm(end_minutes)
    return normalized


def sort_events(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(events, key=lambda item: (item.get("date", ""), parse_hhmm(item["start"]), parse_hhmm(item["end"])))


def has_overlap(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    if a.get("date") != b.get("date"):
        return False
    return parse_hhmm(a["start"]) < parse_hhmm(b["end"]) and parse_hhmm(b["start"]) < parse_hhmm(a["end"])


def find_overlap_count(events: List[Dict[str, Any]]) -> int:
    overlaps = 0
    ordered = sort_events(events)
    for index in range(len(ordered) - 1):
        if has_overlap(ordered[index], ordered[index + 1]):
            overlaps += 1
    return overlaps


def classify_event(event: Dict[str, Any]) -> str:
    title = event["title"].lower()
    if event["is_immovable"]:
        return "fixed"
    if title in {name.lower() for name in RECOVERY_TITLES}:
        return "recovery"
    if event["priority"] == "low" or any(keyword in title for keyword in OPTIONAL_KEYWORDS):
        return "optional"
    if any(keyword in title for keyword in HEAVY_KEYWORDS) or event["priority"] == "high":
        return "heavy"
    return "flexible"


def next_date_str(date_str: str) -> str:
    return (datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")


def today_str() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def get_user_timezone_name(user: Optional[User]) -> str:
    timezone_name = (getattr(user, "timezone", None) or "Asia/Jakarta").strip()
    return timezone_name or "Asia/Jakarta"


def get_user_timezone(user: Optional[User]) -> ZoneInfo:
    try:
        return ZoneInfo(get_user_timezone_name(user))
    except Exception:
        return ZoneInfo("Asia/Jakarta")


def demo_calendar_for_date(date_str: str) -> List[Dict[str, Any]]:
    return [
        {
            "id": "evt-1",
            "title": "Morning Run & Gym",
            "start": "07:00",
            "end": "08:00",
            "is_immovable": False,
            "priority": "low",
            "date": date_str,
        },
        {
            "id": "evt-2",
            "title": "Belajar Deep Learning",
            "start": "09:00",
            "end": "11:00",
            "is_immovable": False,
            "priority": "high",
            "date": date_str,
        },
        {
            "id": "evt-3",
            "title": "Kuliah Sistem Kontrol",
            "start": "14:00",
            "end": "16:00",
            "is_immovable": True,
            "priority": "high",
            "date": date_str,
        },
        {
            "id": "evt-4",
            "title": "Tugas Robotika",
            "start": "16:15",
            "end": "18:15",
            "is_immovable": False,
            "priority": "high",
            "date": date_str,
        },
        {
            "id": "evt-5",
            "title": "Meeting Kelompok",
            "start": "17:30",
            "end": "18:30",
            "is_immovable": False,
            "priority": "medium",
            "date": date_str,
        },
        {
            "id": "evt-6",
            "title": "Olahraga Ringan / Jalan Sore",
            "start": "19:00",
            "end": "19:45",
            "is_immovable": False,
            "priority": "low",
            "date": date_str,
        },
    ]


def serialize_event_model(event: Event) -> Dict[str, Any]:
    return {
        "id": event.id,
        "title": event.title,
        "start": event.start,
        "end": event.end,
        "is_immovable": event.is_immovable,
        "priority": event.priority,
        "date": event.event_date,
    }


def get_user_events_for_today(db: Session, user: User) -> List[Dict[str, Any]]:
    records = (
        db.query(Event)
        .filter(Event.user_id == user.id, Event.event_date == today_str())
        .order_by(Event.start.asc())
        .all()
    )
    return [serialize_event_model(record) for record in records]


def serialize_profile(user: User) -> Dict[str, Any]:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name or user.username,
        "email": user.email,
        "default_wake_time": user.default_wake_time or "07:00",
        "default_sleep_hours": user.default_sleep_hours or 7.5,
        "timezone": user.timezone or "Asia/Jakarta",
        "focus_mode_enabled": bool(user.focus_mode_enabled),
    }


def get_all_user_events(db: Session, user: User) -> List[Dict[str, Any]]:
    records = db.query(Event).filter(Event.user_id == user.id).order_by(Event.event_date.asc(), Event.start.asc()).all()
    return [serialize_event_model(record) for record in records]


def resolve_today_events(
    request_events: List[CalendarEvent],
    db: Session,
    current_user: Optional[User],
) -> List[Dict[str, Any]]:
    fallback_date = today_str()
    if request_events:
        return sort_events([normalize_event(event.model_dump(), fallback_date) for event in request_events])
    if current_user:
        user_events = get_user_events_for_today(db, current_user)
        if user_events:
            return sort_events([normalize_event(event, fallback_date) for event in user_events])
    return []


def get_time_context(request_time: Optional[str]) -> str:
    if request_time:
        return request_time
    now = datetime.now()
    return f"{now.hour:02d}:{now.minute:02d}"


def build_damage_assessment(events: List[Dict[str, Any]], current_minutes: int, energy_level: int) -> Dict[str, Any]:
    missed_events = [event for event in events if parse_hhmm(event["end"]) <= current_minutes]
    overlap_count = find_overlap_count(events)
    remaining_high_priority = sum(
        1 for event in events if parse_hhmm(event["end"]) > current_minutes and normalize_priority(event["priority"]) == "high"
    )
    fixed_remaining = sum(
        1 for event in events if parse_hhmm(event["end"]) > current_minutes and event["is_immovable"]
    )
    available_minutes = max(0, 23 * 60 - current_minutes)
    low_energy_penalty = max(0, 5 - energy_level) * 8
    urgency_penalty = remaining_high_priority * 7
    missed_penalty = len(missed_events) * 14
    overlap_penalty = overlap_count * 18
    pressure_penalty = 8 if available_minutes < 240 else 0
    fixed_pressure = fixed_remaining * 5
    score = clamp(18 + missed_penalty + overlap_penalty + low_energy_penalty + urgency_penalty + pressure_penalty + fixed_pressure, 0, 100)

    if score >= 80:
        level = "critical"
    elif score >= 60:
        level = "high"
    elif score >= 35:
        level = "medium"
    else:
        level = "low"

    summary_parts = []
    if missed_events:
        summary_parts.append(f"{len(missed_events)} event sudah terlewat")
    if overlap_count:
        summary_parts.append(f"{overlap_count} konflik overlap terdeteksi")
    if energy_level <= 4:
        summary_parts.append("energi rendah butuh recovery block")
    if remaining_high_priority:
        summary_parts.append(f"{remaining_high_priority} prioritas tinggi masih harus diamankan")
    summary = ". ".join(summary_parts) if summary_parts else "Jadwal masih relatif aman, hanya perlu penyesuaian ringan."

    return {
        "score": score,
        "level": level,
        "missed_events": len(missed_events),
        "overlap_count": overlap_count,
        "summary": summary,
    }


def get_event_color_label(status: str, event: Dict[str, Any]) -> str:
    if status == "recovery":
        return "Recovery Block"
    if status == "deferred":
        return "Deferred"
    if event["is_immovable"]:
        return "Fixed"
    if status == "moved":
        return "Moved"
    if status == "canceled":
        return "Optional"
    return "Feasible"


def build_recovery_blocks(current_minutes: int, energy_level: int, next_fixed_start: Optional[int]) -> List[Dict[str, Any]]:
    if energy_level >= 5:
        return []

    blocks: List[Dict[str, Any]] = []
    first_block_start = ceil_to_step(current_minutes + 10)
    first_block_end = first_block_start + 30
    if next_fixed_start is None or first_block_end <= next_fixed_start - 10:
        blocks.append(
            {
                "id": str(uuid.uuid4()),
                "title": "Makan & Recovery",
                "start": format_hhmm(first_block_start),
                "end": format_hhmm(first_block_end),
                "is_immovable": False,
                "priority": "medium",
                "status": "recovery",
                "label": "Recovery Block",
                "reason": "Energi rendah, jadi sistem menambahkan recovery block agar sisa hari tetap realistis.",
            }
        )

    second_block_start = max(first_block_end + 45, 18 * 60)
    second_block_end = second_block_start + 20
    if second_block_end <= 22 * 60:
        blocks.append(
            {
                "id": str(uuid.uuid4()),
                "title": "Short Break",
                "start": format_hhmm(second_block_start),
                "end": format_hhmm(second_block_end),
                "is_immovable": False,
                "priority": "low",
                "status": "recovery",
                "label": "Recovery Block",
                "reason": "Break singkat ditambahkan untuk mencegah tugas berat beruntun.",
            }
        )
    return blocks


def find_open_slot(
    blocked: List[Tuple[int, int]],
    duration: int,
    earliest: int,
    latest_end: int = 23 * 60,
) -> Optional[Tuple[int, int]]:
    cursor = ceil_to_step(earliest)
    occupied = sorted(blocked)
    for start, end in occupied:
        if cursor + duration <= start:
            return cursor, cursor + duration
        if cursor < end:
            cursor = ceil_to_step(end)
    if cursor + duration <= latest_end:
        return cursor, cursor + duration
    return None


def insert_blocked(blocked: List[Tuple[int, int]], event: Dict[str, Any]) -> None:
    blocked.append((parse_hhmm(event["start"]), parse_hhmm(event["end"])))
    blocked.sort()


def build_fallback_plan(payload: Dict[str, Any], today_events: List[Dict[str, Any]]) -> Dict[str, Any]:
    today = today_str()
    current_time = get_time_context(payload.get("current_time"))
    current_minutes = parse_hhmm(current_time)
    energy_level = int(payload.get("energy_level") or payload.get("user_condition", {}).get("energy_level", 5))
    mood = payload.get("mood") or payload.get("user_condition", {}).get("mood", "overwhelmed")
    situation = payload.get("situation") or payload.get("user_condition", {}).get("message", "")

    original_events = sort_events([normalize_event(event, today) for event in today_events])
    damage = build_damage_assessment(original_events, current_minutes, energy_level)
    recovery_score_before = clamp(100 - damage["score"], 5, 92)

    future_fixed = [
        event for event in original_events if event["is_immovable"] and parse_hhmm(event["end"]) > current_minutes
    ]
    next_fixed_start = min((parse_hhmm(event["start"]) for event in future_fixed), default=None)
    recovery_blocks = build_recovery_blocks(current_minutes, energy_level, next_fixed_start)

    new_schedule: List[Dict[str, Any]] = []
    blocked: List[Tuple[int, int]] = []
    schedule_actions: List[Dict[str, Any]] = []
    decision_log: List[str] = []
    risk_flags: List[str] = []
    preserved_fixed = 0
    tasks_moved = 0
    conflicts_removed = damage["overlap_count"]
    recovery_blocks_added = 0

    for event in future_fixed:
        preserved = {**event, "status": "preserved", "label": "Fixed"}
        new_schedule.append(preserved)
        insert_blocked(blocked, preserved)
        preserved_fixed += 1
        decision_log.append(f"{event['title']} dipertahankan karena event ini wajib.")

    for event in original_events:
        if event["is_immovable"] and parse_hhmm(event["end"]) <= current_minutes:
            risk_flags.append(f"Event wajib '{event['title']}' sudah lewat dan tidak bisa dipulihkan.")

    for block in recovery_blocks:
        new_schedule.append({**block, "date": today})
        insert_blocked(blocked, block)
        schedule_actions.append(
            {
                "action": "add_recovery",
                "event_title": block["title"],
                "from": None,
                "to": f"{block['start']}-{block['end']}",
                "reason": block["reason"],
            }
        )
        decision_log.append(block["reason"])
        recovery_blocks_added += 1

    deferred_events: List[Dict[str, Any]] = []

    for event in original_events:
        if event["is_immovable"]:
            continue

        classification = classify_event(event)
        start_minutes = parse_hhmm(event["start"])
        end_minutes = parse_hhmm(event["end"])
        duration = event_duration(event)

        if end_minutes <= current_minutes and classification == "optional":
            schedule_actions.append(
                {
                    "action": "cancel",
                    "event_title": event["title"],
                    "from": f"{event['start']}-{event['end']}",
                    "to": None,
                    "reason": "Aktivitas opsional yang sudah terlewat dibatalkan agar energi fokus ke yang penting.",
                }
            )
            decision_log.append(f"{event['title']} dibatalkan karena opsional dan waktunya sudah lewat.")
            continue

        if classification == "optional" and energy_level <= 4:
            schedule_actions.append(
                {
                    "action": "cancel",
                    "event_title": event["title"],
                    "from": f"{event['start']}-{event['end']}",
                    "to": None,
                    "reason": "Aktivitas opsional dikorbankan dulu agar event wajib dan tugas prioritas tetap aman.",
                }
            )
            decision_log.append(f"{event['title']} dibatalkan untuk memberi ruang pada tugas yang lebih penting.")
            continue

        earliest = max(current_minutes + 10, start_minutes if start_minutes > current_minutes else current_minutes + 20)
        if classification == "heavy" and energy_level <= 4:
            earliest = max(earliest, 18 * 60)

        slot = find_open_slot(blocked, duration, earliest)
        if not slot and classification in {"flexible", "heavy", "optional"}:
            tomorrow_date = next_date_str(today)
            deferred = {
                **event,
                "date": tomorrow_date,
                "start": event["start"] if start_minutes >= 7 * 60 else "09:00",
                "end": event["end"] if end_minutes <= 22 * 60 else format_hhmm(parse_hhmm(event["start"]) + duration),
                "status": "deferred",
                "label": "Deferred",
                "reason": "Dipindahkan ke besok karena slot hari ini tidak lagi realistis.",
            }
            deferred_events.append(deferred)
            schedule_actions.append(
                {
                    "action": "defer",
                    "event_title": event["title"],
                    "from": f"{event['start']}-{event['end']}",
                    "to": f"besok {deferred['start']}-{deferred['end']}",
                    "reason": deferred["reason"],
                }
            )
            decision_log.append(f"{event['title']} digeser ke besok karena hari ini sudah terlalu padat.")
            continue

        if slot:
            slot_start, slot_end = slot
            updated = {
                **event,
                "start": format_hhmm(slot_start),
                "end": format_hhmm(slot_end),
                "status": "moved" if slot_start != start_minutes else "preserved",
                "label": get_event_color_label("moved" if slot_start != start_minutes else "preserved", event),
                "reason": "Disusun ulang agar tidak overlap dan lebih cocok dengan energi tersisa.",
            }
            new_schedule.append(updated)
            insert_blocked(blocked, updated)
            if updated["status"] == "moved":
                tasks_moved += 1
                schedule_actions.append(
                    {
                        "action": "move",
                        "event_title": event["title"],
                        "from": f"{event['start']}-{event['end']}",
                        "to": f"{updated['start']}-{updated['end']}",
                        "reason": updated["reason"],
                    }
                )
                decision_log.append(f"{event['title']} dipindahkan ke {updated['start']} agar jadwal akhir tidak overlap.")
            else:
                decision_log.append(f"{event['title']} tetap dipertahankan karena slotnya masih realistis.")

    new_schedule.extend(deferred_events)
    new_schedule = sort_events(new_schedule)

    validation = validate_schedule(original_events, new_schedule, energy_level)
    recovery_score_after = clamp(
        recovery_score_before + 18 + preserved_fixed * 5 + recovery_blocks_added * 6 + conflicts_removed * 8 - len(validation["issues"]) * 7,
        recovery_score_before + 5,
        98,
    )

    summary = (
        f"Recovery plan dibuat untuk menyelamatkan {preserved_fixed} event wajib, "
        f"mengurangi {conflicts_removed} konflik, dan menambahkan {recovery_blocks_added} blok recovery."
    )
    energy_state = "low" if energy_level <= 4 else "medium" if energy_level <= 7 else "high"
    energy_message = {
        "low": "Energi sedang rendah. Jadwal akhir diperlunak dan diberi recovery block.",
        "medium": "Energi cukup. FlowMate tetap menahan context switching berlebihan.",
        "high": "Energi cukup kuat. FlowMate menjaga prioritas tinggi tetap fokus.",
    }[energy_state]

    return {
        "session_id": str(uuid.uuid4()),
        "summary": summary,
        "mode": "live",
        "situation": situation,
        "mood": mood,
        "before_schedule": original_events,
        "new_schedule": new_schedule,
        "damage_assessment": damage,
        "energy_assessment": {
            "level": energy_state,
            "score": energy_level * 10,
            "message": energy_message,
        },
        "schedule_actions": schedule_actions,
        "decision_log": decision_log,
        "recovery_score_before": recovery_score_before,
        "recovery_score_after": recovery_score_after,
        "risk_flags": sorted(set(risk_flags + validation["issues"])),
        "stats": {
            "fixed_events_preserved": preserved_fixed,
            "conflicts_removed": conflicts_removed,
            "tasks_moved": tasks_moved,
            "recovery_blocks_added": recovery_blocks_added,
            "deferred_count": len([event for event in new_schedule if event.get("status") == "deferred"]),
        },
    }


def validate_schedule(
    original_events: List[Dict[str, Any]],
    new_schedule: List[Dict[str, Any]],
    energy_level: int,
) -> Dict[str, Any]:
    issues: List[str] = []
    schedule_today = [event for event in sort_events(new_schedule) if event.get("date") == today_str() and event.get("status") != "canceled"]
    overlap_count = find_overlap_count(schedule_today)
    if overlap_count:
        issues.append("Final schedule masih memiliki overlap.")

    original_fixed_titles = {event["title"] for event in original_events if event["is_immovable"]}
    new_fixed_titles = {event["title"] for event in new_schedule if event.get("status") != "deferred"}
    missing_fixed = original_fixed_titles - new_fixed_titles
    if missing_fixed:
        issues.append(f"Event wajib hilang dari jadwal akhir: {', '.join(sorted(missing_fixed))}.")

    if energy_level <= 4:
        has_recovery = any(event.get("status") == "recovery" for event in new_schedule)
        if not has_recovery:
            issues.append("Energi rendah tetapi recovery block belum ditambahkan.")

    invalid_durations = [event["title"] for event in new_schedule if event_duration(event) < 15 or event_duration(event) > 240]
    if invalid_durations:
        issues.append(f"Durasi event tidak wajar: {', '.join(invalid_durations)}.")

    return {
        "valid": len(issues) == 0,
        "issues": issues,
        "overlap_count": overlap_count,
    }


def normalize_live_plan(parsed: Dict[str, Any], fallback_plan: Dict[str, Any]) -> Dict[str, Any]:
    required_keys = {
        "summary",
        "damage_assessment",
        "energy_assessment",
        "schedule_actions",
        "new_schedule",
        "decision_log",
        "recovery_score_before",
        "recovery_score_after",
        "risk_flags",
    }
    if not required_keys.issubset(parsed.keys()):
        return fallback_plan

    raw_schedule = parsed.get("new_schedule") or []
    if not isinstance(raw_schedule, list) or not raw_schedule:
        return fallback_plan

    normalized_schedule = []
    status_map = {
        "kept": "preserved",
        "keep": "preserved",
        "removed": "canceled",
        "add": "recovery",
        "added": "recovery",
    }
    for event in raw_schedule:
        if not isinstance(event, dict) or not event.get("title") or not event.get("start") or not event.get("end"):
            return fallback_plan
        normalized = normalize_event(event, today_str())
        normalized_status = status_map.get(str(normalized.get("status", "")).lower(), normalized.get("status"))
        if normalized_status:
            normalized["status"] = normalized_status
            normalized["label"] = get_event_color_label(normalized_status, normalized)
        normalized_schedule.append(normalized)

    merged = {
        **fallback_plan,
        **parsed,
        "before_schedule": fallback_plan["before_schedule"],
        "new_schedule": sort_events(normalized_schedule),
        "session_id": str(uuid.uuid4()),
    }
    validation = validate_schedule(
        fallback_plan["before_schedule"],
        merged["new_schedule"],
        int(fallback_plan["energy_assessment"]["score"] / 10),
    )
    merged["risk_flags"] = sorted(set((merged.get("risk_flags") or []) + validation["issues"]))
    return merged


async def generate_plan(payload: Dict[str, Any], today_events: List[Dict[str, Any]]) -> Dict[str, Any]:
    fallback_plan = build_fallback_plan(payload, today_events)
    if DEMO_MODE or genai_model is None:
        return fallback_plan

    try:
        gemini_payload = {
            "summary_goal": "Return structured JSON only for FlowMate rescue planning.",
            "product_rules": {
                "fixed_events_must_be_preserved": True,
                "no_overlap": True,
                "add_recovery_block_if_energy_low": payload.get("energy_level", 5) <= 4,
                "do_not_apply_changes_without_approval": True,
            },
            "user_context": payload,
            "today_events": today_events,
        }
        response = genai_model.generate_content(json.dumps(gemini_payload, ensure_ascii=False))
        parsed = json.loads(response.text)
        if not isinstance(parsed, dict):
            return fallback_plan
        return normalize_live_plan(parsed, fallback_plan)
    except Exception as exc:
        print(f"Gemini failed, using fallback planner: {exc}")
        return fallback_plan


def normalize_journal_analysis(analysis: Dict[str, Any]) -> Dict[str, Any]:
    blockers = analysis.get("blockers", [])
    if isinstance(blockers, str):
        blockers = [blockers]
    elif not isinstance(blockers, list):
        blockers = []

    productivity = analysis.get("productivity", 5)
    try:
        productivity = int(float(productivity))
    except (TypeError, ValueError):
        productivity = 5

    return {
        "mood": str(analysis.get("mood") or "netral"),
        "productivity": max(1, min(10, productivity)),
        "blockers": [str(item) for item in blockers if str(item).strip()],
        "insight": str(analysis.get("insight") or "Terus amati pola energimu agar schedule-mu makin realistis."),
    }


def analyze_journal_text(text: str) -> Dict[str, Any]:
    lowered = text.lower()
    mood = "netral"
    if any(keyword in lowered for keyword in {"capek", "lelah", "burnout", "stuck", "cemas"}):
        mood = "berat"
    elif any(keyword in lowered for keyword in {"senang", "lega", "produktif", "beres"}):
        mood = "positif"

    blockers = []
    for keyword, label in {
        "deadline": "deadline pressure",
        "ngantuk": "kurang tidur",
        "rapat": "meeting overload",
        "robotika": "tugas robotika",
        "fokus": "gangguan fokus",
    }.items():
        if keyword in lowered:
            blockers.append(label)

    productivity = 7 if mood == "positif" else 4 if mood == "berat" else 5
    insight = (
        "Kamu tampak butuh jadwal yang lebih ringan besok pagi."
        if mood == "berat"
        else "Pola harimu cukup stabil. Pertahankan satu fokus utama per sesi."
    )
    return normalize_journal_analysis({
        "mood": mood,
        "productivity": productivity,
        "blockers": blockers,
        "insight": insight,
    })


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
@app.post("/api/auth/register")
def register(data: UserRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=400, detail="Username sudah digunakan.")
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email sudah terdaftar.")

    user = User(
        id=str(uuid.uuid4()),
        username=data.username,
        email=data.email,
        hashed_pw=hash_password(data.password),
        display_name=data.username,
    )
    db.add(user)
    db.commit()

    token = create_access_token({"sub": user.id})
    return {"access_token": token, "token_type": "bearer", "username": user.username}


@app.post("/api/auth/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form.username).first()
    if not user or not user.hashed_pw or not verify_password(form.password, user.hashed_pw):
        raise HTTPException(status_code=401, detail="Username atau password salah.")
    token = create_access_token({"sub": user.id})
    return {"access_token": token, "token_type": "bearer", "username": user.username}


@app.post("/api/auth/google")
def google_login(data: GoogleAuthRequest, db: Session = Depends(get_db)):
    from google.auth.transport import requests
    from google.oauth2 import id_token

    try:
        idinfo = id_token.verify_oauth2_token(data.credential, requests.Request(), GOOGLE_CLIENT_ID)
        email = idinfo["email"]
        name = idinfo.get("name", email.split("@")[0])
        user = db.query(User).filter(User.email == email).first()
        if not user:
            user = User(
                id=str(uuid.uuid4()),
                username=name.replace(" ", "_").lower() + "_" + str(uuid.uuid4())[:4],
                email=email,
                hashed_pw=None,
                display_name=name,
            )
            db.add(user)
            db.commit()
        token = create_access_token({"sub": user.id})
        return {"access_token": token, "token_type": "bearer", "username": user.username}
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Google token")


@app.get("/api/auth/me")
def me(current_user: User = Depends(get_current_user)):
    return serialize_profile(current_user)


@app.get("/api/public-config")
def get_public_config():
    return {"google_client_id": GOOGLE_CLIENT_ID}


@app.get("/api/profile")
def get_profile(current_user: User = Depends(get_current_user)):
    return serialize_profile(current_user)


@app.patch("/api/profile")
def update_profile(
    payload: ProfileUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    updates = payload.model_dump(exclude_none=True)

    if "display_name" in updates:
        current_user.display_name = updates["display_name"].strip() or current_user.username
    if "default_wake_time" in updates:
        current_user.default_wake_time = updates["default_wake_time"] or "07:00"
    if "default_sleep_hours" in updates:
        current_user.default_sleep_hours = updates["default_sleep_hours"] or 7.5
    if "timezone" in updates:
        current_user.timezone = updates["timezone"].strip() or "Asia/Jakarta"
    if "focus_mode_enabled" in updates:
        current_user.focus_mode_enabled = bool(updates["focus_mode_enabled"])

    if not current_user.display_name:
        current_user.display_name = current_user.username
    if not current_user.default_wake_time:
        current_user.default_wake_time = "07:00"
    if not current_user.default_sleep_hours:
        current_user.default_sleep_hours = 7.5
    if not current_user.timezone:
        current_user.timezone = "Asia/Jakarta"

    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return {"status": "updated", "profile": serialize_profile(current_user)}


# ---------------------------------------------------------------------------
# Schedule endpoints
# ---------------------------------------------------------------------------
@app.get("/api/events")
def get_events(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    today_events = get_user_events_for_today(db, current_user)
    all_events = get_all_user_events(db, current_user)
    return {"today_events": today_events, "all_events": all_events}


@app.post("/api/events")
def add_event(event: CalendarEvent, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    normalized = normalize_event(event.model_dump(), today_str())
    db_event = Event(
        id=normalized["id"],
        user_id=current_user.id,
        title=normalized["title"],
        start=normalized["start"],
        end=normalized["end"],
        event_date=normalized["date"],
        is_immovable=normalized["is_immovable"],
        priority=normalized["priority"],
    )
    db.add(db_event)
    db.commit()
    return {"status": "success", "event": db_event.id}


@app.delete("/api/events/{event_id}")
def delete_event(event_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    event = db.query(Event).filter(Event.id == event_id, Event.user_id == current_user.id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event tidak ditemukan.")
    db.delete(event)
    db.commit()
    return {"status": "deleted"}


@app.post("/api/rescue")
async def rescue_schedule(
    request: RescueRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today_events = resolve_today_events(request.today_events, db, current_user)
    payload = {
        "situation": request.situation,
        "energy_level": request.energy_level,
        "mood": request.mood,
        "current_time": request.current_time or get_time_context(None),
        "mode": "live",
        "user_profile": {
            "default_wake_time": current_user.default_wake_time or "07:00",
            "default_sleep_hours": current_user.default_sleep_hours or 7.5,
            "timezone": current_user.timezone or "Asia/Jakarta",
        },
    }
    result = await generate_plan(payload, today_events)

    session_id = result.get("session_id") or str(uuid.uuid4())
    damage = result.get("damage_assessment", {})

    db.add(
        CalendarSnapshot(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            source="live",
            raw_events_json=json.dumps(today_events, ensure_ascii=False),
        )
    )

    db.add(
        RescueSession(
            id=session_id,
            user_id=current_user.id,
            situation_text=request.situation,
            mood=request.mood,
            energy_level=request.energy_level,
            damage_score=damage.get("score"),
            damage_level=damage.get("level"),
            recovery_score_before=result.get("recovery_score_before"),
            recovery_score_after=result.get("recovery_score_after"),
            ai_summary=result.get("summary"),
            mode="live",
            events_before_count=len(today_events),
            events_after_count=len(result.get("new_schedule", [])),
        )
    )

    for action in result.get("schedule_actions", []):
        from_raw = action.get("from") or ""
        to_raw = action.get("to") or ""
        old_start = old_end = new_start = new_end = None
        if "-" in from_raw:
            parts = from_raw.split("-")
            old_start, old_end = parts[0].strip(), parts[-1].strip()
        if "-" in to_raw:
            parts = to_raw.split("-")
            new_start, new_end = parts[0].strip().split()[-1], parts[-1].strip()
        db.add(
            ScheduleAction(
                id=str(uuid.uuid4()),
                rescue_session_id=session_id,
                user_id=current_user.id,
                action_type=action.get("action", "unknown"),
                event_title=action.get("event_title"),
                old_start=old_start,
                old_end=old_end,
                new_start=new_start,
                new_end=new_end,
                reason=action.get("reason"),
            )
        )

    db.add(
        CheckinRecord(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            type="rescue",
            energy_level=request.energy_level,
            mood=request.mood,
            events_before=len(today_events),
            events_after=len(result.get("new_schedule", [])),
        )
    )

    db.commit()
    return result


@app.post("/api/validate-schedule")
def validate_schedule_endpoint(
    request: ValidateScheduleRequest,
    current_user: User = Depends(get_current_user),
):
    original_events = [normalize_event(event.model_dump(), today_str()) for event in request.original_events]
    new_schedule = [normalize_event(event.model_dump(), event.date or today_str()) for event in request.new_schedule]
    return validate_schedule(original_events, new_schedule, request.energy_level)


@app.post("/api/apply-schedule")
def apply_schedule(
    request: ApplyScheduleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    normalized = [normalize_event(event.model_dump(), today_str()) for event in request.new_schedule]


    today = today_str()

    # --- Save undo snapshot BEFORE replacing events ---
    existing_today = db.query(Event).filter(
        Event.user_id == current_user.id, Event.event_date == today
    ).all()
    undo_snapshot = [serialize_event_model(ev) for ev in existing_today]
    db.add(
        CalendarSnapshot(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            source="undo_snapshot",
            raw_events_json=json.dumps(undo_snapshot, ensure_ascii=False),
        )
    )

    db.query(Event).filter(Event.user_id == current_user.id, Event.event_date == today).delete(synchronize_session=False)
    for event in normalized:
        if event.get("status") == "canceled":
            continue
        db.add(
            Event(
                id=event["id"],
                user_id=current_user.id,
                title=event["title"],
                start=event["start"],
                end=event["end"],
                event_date=event["date"],
                is_immovable=event["is_immovable"],
                priority=event["priority"],
            )
        )
    db.commit()
    return {"status": "applied", "applied_count": len(normalized)}


@app.post("/api/undo-schedule")
def undo_schedule(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Restore the most recent undo snapshot for today's schedule."""
    snapshot = (
        db.query(CalendarSnapshot)
        .filter(
            CalendarSnapshot.user_id == current_user.id,
            CalendarSnapshot.source == "undo_snapshot",
        )
        .order_by(CalendarSnapshot.created_at.desc())
        .first()
    )
    if not snapshot:
        raise HTTPException(status_code=404, detail="Tidak ada snapshot untuk di-undo.")

    events = json.loads(snapshot.raw_events_json)
    today = today_str()
    db.query(Event).filter(Event.user_id == current_user.id, Event.event_date == today).delete(synchronize_session=False)
    for event in events:
        db.add(
            Event(
                id=event.get("id", str(uuid.uuid4())),
                user_id=current_user.id,
                title=event["title"],
                start=event["start"],
                end=event["end"],
                event_date=event.get("date", today),
                is_immovable=event.get("is_immovable", False),
                priority=event.get("priority", "medium"),
            )
        )
    # Remove used snapshot so next undo goes to the previous one
    db.delete(snapshot)
    db.commit()
    return {"status": "undone", "restored_count": len(events)}


@app.post("/api/reschedule")
async def legacy_reschedule(
    request: RescueRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await rescue_schedule(request, db, current_user)


# ---------------------------------------------------------------------------
# Morning check-in, journal, dashboard
# ---------------------------------------------------------------------------
@app.post("/api/checkin")
async def morning_checkin(
    request: CheckinRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today_events = resolve_today_events(request.today_events, db, current_user)
    payload = {
        "situation": f"Check-in pagi. Top priority: {request.top_priority or 'belum diisi'}.",
        "energy_level": request.energy_level,
        "mood": request.mood,
        "current_time": request.wake_up_time,
        "mode": "live",
        "user_profile": {
            "default_wake_time": current_user.default_wake_time or "07:00",
            "default_sleep_hours": current_user.default_sleep_hours or 7.5,
            "timezone": current_user.timezone or "Asia/Jakarta",
        },
    }
    result = await generate_plan(payload, today_events)
    result["checkin"] = {
        "sleep_hours": request.sleep_hours,
        "wake_up_time": request.wake_up_time,
        "top_priority": request.top_priority,
    }

    db.add(
        CalendarSnapshot(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            source="live",
            raw_events_json=json.dumps(today_events, ensure_ascii=False),
        )
    )
    db.add(
        CheckinRecord(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            type="checkin",
            sleep_hours=request.sleep_hours,
            energy_level=request.energy_level,
            mood=request.mood,
        )
    )

    db.commit()
    return result


@app.post("/api/journal")
async def save_journal(
    entry: JournalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    analysis = analyze_journal_text(entry.text)
    if not DEMO_MODE and genai_model is not None:
        try:
            prompt = (
                'Analyze this journal entry in Indonesian and return JSON with keys '
                '"mood", "productivity", "blockers", "insight".\n'
                f"Journal: {entry.text}"
            )
            response = genai_model.generate_content(prompt)
            candidate = json.loads(response.text)
            if isinstance(candidate, dict):
                analysis = normalize_journal_analysis({**analysis, **candidate})
        except Exception:
            pass

    entry_id = str(uuid.uuid4())
    entry_date = entry.date or today_str()
    # Serialize extracted entities (blockers + insight) as JSON for persistence
    extracted_entities_json = json.dumps(
        {"blockers": analysis.get("blockers", []), "insight": analysis.get("insight", "")},
        ensure_ascii=False,
    )

    saved_entry = {
        "id": entry_id,
        "text": entry.text,
        "mood": analysis.get("mood"),
        "date": entry_date,
        "analysis": analysis,
    }

    record = JournalEntry(
        id=entry_id,
        user_id=current_user.id,
        text=entry.text,
        mood=analysis.get("mood"),
        productivity_score=analysis.get("productivity"),
        extracted_entities=extracted_entities_json,
        date=entry_date,
    )
    db.add(record)
    db.commit()

    return {"status": "saved", "entry": saved_entry, "analysis": analysis}


@app.get("/api/journal")
def get_journal(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):

    entries = (
        db.query(JournalEntry)
        .filter(JournalEntry.user_id == current_user.id)
        .order_by(JournalEntry.created_at.desc())
        .limit(30)
        .all()
    )
    return {
        "entries": [
            {"id": entry.id, "text": entry.text, "mood": entry.mood, "date": entry.date}
            for entry in entries
        ]
    }


@app.get("/api/journal/weekly-insight")
def get_weekly_insight(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Analyze journal entries from the last 7 days and return weekly patterns."""
    seven_days_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

    entries = (
        db.query(JournalEntry)
        .filter(
            JournalEntry.user_id == current_user.id,
            JournalEntry.date >= seven_days_ago,
        )
        .order_by(JournalEntry.date.asc())
        .all()
    )
    mood_list = [e.mood for e in entries if e.mood]
    productivity_list = [e.productivity_score for e in entries if e.productivity_score]
    all_blockers: List[str] = []
    for entry in entries:
        if entry.extracted_entities:
            try:
                parsed = json.loads(entry.extracted_entities)
                all_blockers.extend(parsed.get("blockers", []))
            except Exception:
                pass

    if not entries:
        return {"entries_count": 0, "message": "Belum ada jurnal dalam 7 hari terakhir.", "patterns": []}

    # Mood frequency analysis
    mood_counts: Dict[str, int] = {}
    for mood in mood_list:
        mood_counts[mood] = mood_counts.get(mood, 0) + 1
    dominant_mood = max(mood_counts, key=mood_counts.get) if mood_counts else "netral"

    # Productivity trend
    avg_productivity = round(sum(productivity_list) / len(productivity_list), 1) if productivity_list else 5.0

    # Blocker frequency
    blocker_counts: Dict[str, int] = {}
    for blocker in all_blockers:
        blocker_counts[blocker] = blocker_counts.get(blocker, 0) + 1
    top_blockers = sorted(blocker_counts.items(), key=lambda x: x[1], reverse=True)[:3]

    # Build patterns
    patterns: List[str] = []
    if dominant_mood == "berat":
        patterns.append("Kamu sering merasa berat minggu ini. Pertimbangkan mengurangi beban jadwal besok.")
    elif dominant_mood == "positif":
        patterns.append("Energi positif mendominasi minggu ini. Pertahankan rutinitas yang sedang berjalan!")
    if avg_productivity < 5:
        patterns.append(f"Rata-rata produktivitas minggu ini {avg_productivity}/10. Coba kurangi context switching.")
    elif avg_productivity >= 7:
        patterns.append(f"Produktivitas rata-rata {avg_productivity}/10 — kamu sedang dalam flow yang baik!")
    if top_blockers:
        blocker_names = ", ".join(b[0] for b in top_blockers)
        patterns.append(f"Blocker yang paling sering muncul: {blocker_names}.")
    if len(entries) < 3:
        patterns.append("Tulis jurnal lebih sering untuk mendapatkan insight yang lebih akurat.")

    # Use Gemini for richer insight if live mode
    gemini_insight = None
    if not DEMO_MODE and genai_model is not None and entries:
        try:
            combined_text = " | ".join([e.text[:120] for e in entries[-5:]])
            prompt = (
                f"Berdasarkan {len(entries)} entri jurnal 7 hari terakhir seorang mahasiswa Indonesia:\"{combined_text}\""
                f" Mood dominan: {dominant_mood}. Rata-rata produktivitas: {avg_productivity}/10."
                f" Berikan 1 kalimat insight personal dalam bahasa Indonesia yang actionable."
            )
            response = genai_model.generate_content(prompt)
            gemini_insight = response.text.strip().strip('"')
        except Exception:
            pass

    return {
        "entries_count": len(entries),
        "date_range": f"{seven_days_ago} → {today_str()}",
        "dominant_mood": dominant_mood,
        "mood_distribution": mood_counts,
        "avg_productivity": avg_productivity,
        "top_blockers": [b[0] for b in top_blockers],
        "patterns": patterns,
        "gemini_insight": gemini_insight,
        "message": gemini_insight or (patterns[0] if patterns else "Terus menulis jurnal untuk mendapat insight!"),
    }


@app.get("/api/dashboard")
def get_dashboard(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    records = db.query(CheckinRecord).filter(CheckinRecord.user_id == current_user.id).all()
    journals = db.query(JournalEntry).filter(JournalEntry.user_id == current_user.id).all()
    rescue_sessions = (
        db.query(RescueSession)
        .filter(RescueSession.user_id == current_user.id)
        .order_by(RescueSession.created_at.desc())
        .all()
    )

    rescue_records = [record for record in records if record.type == "rescue"]
    energy_values = [record.energy_level for record in records if record.energy_level is not None]
    avg_energy = round(sum(energy_values) / len(energy_values), 1) if energy_values else 0

    preserved_rates = []
    for record in rescue_records:
        if record.events_before:
            preserved_rates.append(round((record.events_after or 0) / record.events_before * 100))

    # Compute avg_recovery_improvement from dedicated RescueSession table
    recovery_improvements = [
        s.recovery_score_after - s.recovery_score_before
        for s in rescue_sessions
        if s.recovery_score_before is not None and s.recovery_score_after is not None
    ]
    avg_recovery_improvement = (
        round(sum(recovery_improvements) / len(recovery_improvements), 1)
        if recovery_improvements
        else 0
    )

    avg_damage_score = (
        round(sum(s.damage_score for s in rescue_sessions if s.damage_score is not None)
              / len([s for s in rescue_sessions if s.damage_score is not None]), 1)
        if any(s.damage_score is not None for s in rescue_sessions)
        else 0
    )

    return {
        "total_rescues": len(rescue_records),
        "total_checkins": sum(1 for record in records if record.type == "checkin"),
        "avg_energy": avg_energy,
        "rescued_days": len(rescue_records),
        "fixed_event_preservation_rate": round(sum(preserved_rates) / len(preserved_rates), 1) if preserved_rates else 100,
        "avg_recovery_improvement": avg_recovery_improvement,
        "avg_damage_score": avg_damage_score,
        "checkin_history": [
            {
                "type": record.type,
                "mood": record.mood,
                "energy_level": record.energy_level,
                "timestamp": record.timestamp.isoformat(),
            }
            for record in records[-30:]
        ],
        "journal_entries": [
            {
                "mood": entry.mood,
                "date": entry.date,
                "productivity_score": entry.productivity_score,
            }
            for entry in journals[-30:]
        ],
    }


# ---------------------------------------------------------------------------
# Google Calendar sync
# ---------------------------------------------------------------------------
@app.post("/api/sync-gcal")
def sync_gcal(data: GcalSyncRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    import requests as pyrequests

    token = data.access_token
    if not token:
        raise HTTPException(status_code=400, detail="No token provided")

    sync_timezone = get_user_timezone(current_user)
    start = datetime.now(sync_timezone).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    target_date = start.strftime("%Y-%m-%d")
    params = {
        "timeMin": start.isoformat(),
        "timeMax": end.isoformat(),
        "singleEvents": True,
        "orderBy": "startTime",
    }
    headers = {"Authorization": f"Bearer {token}"}
    response = pyrequests.get(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        headers=headers,
        params=params,
        timeout=20,
    )
    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail="Failed to fetch from Google Calendar")

    synced = 0
    skipped_all_day_count = 0
    for item in response.json().get("items", []):
        start_payload = item.get("start", {})
        end_payload = item.get("end", {})
        start_time = start_payload.get("dateTime")
        end_time = end_payload.get("dateTime")
        if not start_time or not end_time:
            if start_payload.get("date") or end_payload.get("date"):
                skipped_all_day_count += 1
            continue

        try:
            start_dt = datetime.fromisoformat(start_time.replace("Z", "+00:00")).astimezone(sync_timezone)
            end_dt = datetime.fromisoformat(end_time.replace("Z", "+00:00")).astimezone(sync_timezone)
        except ValueError:
            continue

        event_date = start_dt.strftime("%Y-%m-%d")
        if event_date != target_date:
            continue

        start_hm = start_dt.strftime("%H:%M")
        end_hm = end_dt.strftime("%H:%M")
        title = "[GCal] " + item.get("summary", "Busy")

        exists = (
            db.query(Event)
            .filter(
                Event.user_id == current_user.id,
                Event.event_date == event_date,
                Event.title == title,
                Event.start == start_hm,
            )
            .first()
        )
        if exists:
            continue

        db.add(
            Event(
                id=str(uuid.uuid4()),
                user_id=current_user.id,
                title=title,
                start=start_hm,
                end=end_hm,
                event_date=event_date,
                is_immovable=True,
                priority="high",
            )
        )
        synced += 1

    db.commit()

    if synced > 0:
        all_gcal_events = get_all_user_events(db, current_user)
        db.add(
            CalendarSnapshot(
                id=str(uuid.uuid4()),
                user_id=current_user.id,
                source="gcal",
                raw_events_json=json.dumps(all_gcal_events, ensure_ascii=False),
            )
        )
        db.commit()

    return {
        "status": "success",
        "synced_count": synced,
        "skipped_all_day_count": skipped_all_day_count,
        "target_date": target_date,
        "timezone": get_user_timezone_name(current_user),
    }


# ---------------------------------------------------------------------------
# Analytics endpoints (RescueSession, ScheduleAction, CalendarSnapshot)
# ---------------------------------------------------------------------------
@app.get("/api/rescue-history")
def get_rescue_history(
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the N most recent rescue sessions with their schedule actions."""
    sessions = (
        db.query(RescueSession)
        .filter(RescueSession.user_id == current_user.id)
        .order_by(RescueSession.created_at.desc())
        .limit(limit)
        .all()
    )
    result = []
    for session in sessions:
        actions = (
            db.query(ScheduleAction)
            .filter(ScheduleAction.rescue_session_id == session.id)
            .all()
        )
        result.append(
            {
                "id": session.id,
                "situation_text": session.situation_text,
                "mood": session.mood,
                "energy_level": session.energy_level,
                "damage_score": session.damage_score,
                "damage_level": session.damage_level,
                "recovery_score_before": session.recovery_score_before,
                "recovery_score_after": session.recovery_score_after,
                "ai_summary": session.ai_summary,
                "mode": session.mode,
                "events_before_count": session.events_before_count,
                "events_after_count": session.events_after_count,
                "created_at": session.created_at.isoformat(),
                "actions": [
                    {
                        "action_type": a.action_type,
                        "event_title": a.event_title,
                        "old_start": a.old_start,
                        "old_end": a.old_end,
                        "new_start": a.new_start,
                        "new_end": a.new_end,
                        "reason": a.reason,
                    }
                    for a in actions
                ],
            }
        )
    return {"sessions": result, "total": len(result)}


# ---------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "DEMO" if DEMO_MODE else "LIVE"}


app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse(str(BASE_DIR / "static" / "favicon_flowmate" / "favicon.ico"))


@app.get("/site.webmanifest", include_in_schema=False)
async def site_webmanifest():
    return FileResponse(
        str(BASE_DIR / "static" / "site.webmanifest"),
        media_type="application/manifest+json",
    )


@app.get("/")
async def root():
    return FileResponse(str(BASE_DIR / "static" / "index.html"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
