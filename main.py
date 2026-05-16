"""
FlowMate — Empathic AI Scheduling Assistant
Backend server powered by FastAPI + Google Gemini
"""

import os
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Depends
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from dotenv import load_dotenv

load_dotenv()

from database import init_db, get_db, User, Event, JournalEntry, CheckinRecord
from auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, oauth2_scheme
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
PORT = int(os.getenv("PORT", 8000))
BASE_DIR = Path(__file__).resolve().parent

# Load system prompt
SYSTEM_PROMPT = (BASE_DIR / "system_prompt.txt").read_text(encoding="utf-8")

# ---------------------------------------------------------------------------
# Gemini setup (lazy — only when not in demo mode)
# ---------------------------------------------------------------------------
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
                "temperature": 0.7,
            },
        )
        print("✅ Gemini API connected (LIVE MODE)")
    except Exception as e:
        print(f"⚠️  Gemini init failed: {e}  — falling back to DEMO MODE")
        DEMO_MODE = True
else:
    print("🧪 Running in DEMO MODE (using pre-built responses)")

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="FlowMate API", version="2.0.0")

# Init DB on startup
init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class UserRegister(BaseModel):
    username: str
    email: str
    password: str

class UserCondition(BaseModel):
    sleep_hours: float
    energy_level: int
    mood: str
    message: str

class CalendarEvent(BaseModel):
    id: str
    title: str
    start: str
    end: str
    is_immovable: bool
    priority: str

class RescheduleRequest(BaseModel):
    current_time: str
    user_condition: UserCondition
    today_events: List[CalendarEvent]

class CheckinRequest(BaseModel):
    sleep_hours: float
    wake_up_time: str
    energy_level: int
    mood: str
    today_events: List[CalendarEvent]

class JournalRequest(BaseModel):
    text: str
    date: Optional[str] = None

# ---------------------------------------------------------------------------
# In-memory fallback (only used before DB is ready)
# ---------------------------------------------------------------------------
_checkin_cache: list = []
_journal_cache: list = []

# ---------------------------------------------------------------------------
# Helper: load/save JSON
# ---------------------------------------------------------------------------
def load_json(filename: str) -> dict:
    with open(BASE_DIR / filename, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(filename: str, data: dict):
    with open(BASE_DIR / filename, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

# ---------------------------------------------------------------------------
# Helper: call Gemini API
# ---------------------------------------------------------------------------
async def call_gemini(payload: dict) -> dict:
    """Send a payload to Gemini and return parsed JSON."""
    if DEMO_MODE or genai_model is None:
        return load_json("demo_response.json")

    try:
        user_input = json.dumps(payload, indent=2, ensure_ascii=False)
        response = genai_model.generate_content(user_input)
        return json.loads(response.text)
    except Exception as e:
        print(f"Gemini error: {e}")
        raise HTTPException(status_code=500, detail=f"AI processing failed: {str(e)}")

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

# ===========================================================================
# AUTH ENDPOINTS
# ===========================================================================

@app.post("/api/auth/register")
def register(data: UserRegister, db: Session = Depends(get_db)):
    """Register a new user."""
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=400, detail="Username sudah digunakan.")
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="Email sudah terdaftar.")
    user = User(
        id=str(uuid.uuid4()),
        username=data.username,
        email=data.email,
        hashed_pw=hash_password(data.password),
    )
    db.add(user)
    db.commit()
    token = create_access_token({"sub": user.id})
    return {"access_token": token, "token_type": "bearer", "username": user.username}

@app.post("/api/auth/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Login with username + password."""
    user = db.query(User).filter(User.username == form.username).first()
    if not user or not verify_password(form.password, user.hashed_pw):
        raise HTTPException(status_code=401, detail="Username atau password salah.")
    token = create_access_token({"sub": user.id})
    return {"access_token": token, "token_type": "bearer", "username": user.username}

class GoogleAuthRequest(BaseModel):
    credential: str

from google.oauth2 import id_token
from google.auth.transport import requests

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "1028741369796-0s022of7t00c0a969l7bkkq70bmsffo1.apps.googleusercontent.com")

@app.post("/api/auth/google")
def google_login(data: GoogleAuthRequest, db: Session = Depends(get_db)):
    """Login or register via Google Sign-In."""
    try:
        idinfo = id_token.verify_oauth2_token(data.credential, requests.Request(), GOOGLE_CLIENT_ID)
        email = idinfo['email']
        name = idinfo.get('name', email.split('@')[0])
        
        user = db.query(User).filter(User.email == email).first()
        if not user:
            # Create user if it doesn't exist
            user = User(
                id=str(uuid.uuid4()),
                username=name.replace(" ", "_").lower() + "_" + str(uuid.uuid4())[:4],
                email=email,
                hashed_pw=None # No password for Google users
            )
            db.add(user)
            db.commit()
            
        token = create_access_token({"sub": user.id})
        return {"access_token": token, "token_type": "bearer", "username": user.username}
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Google token")

@app.get("/api/auth/me")
def me(current_user: User = Depends(get_current_user)):
    """Get current logged-in user info."""
    return {"id": current_user.id, "username": current_user.username, "email": current_user.email}

class GcalSyncRequest(BaseModel):
    access_token: str

import requests as pyrequests

@app.post("/api/sync-gcal")
def sync_gcal(
    data: GcalSyncRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    token = data.access_token
    if not token:
        raise HTTPException(status_code=400, detail="No token provided")
    
    from datetime import timedelta
    # Get events for 7 days
    today = datetime.now()
    end_date = today + timedelta(days=7)
    today_start = today.replace(hour=0, minute=0, second=0).isoformat() + "Z"
    today_end = end_date.replace(hour=23, minute=59, second=59).isoformat() + "Z"
    
    headers = {"Authorization": f"Bearer {token}"}
    params = {
        "timeMin": today_start,
        "timeMax": today_end,
        "singleEvents": True,
        "orderBy": "startTime"
    }
    
    resp = pyrequests.get("https://www.googleapis.com/calendar/v3/calendars/primary/events", headers=headers, params=params)
    if resp.status_code != 200:
        raise HTTPException(status_code=resp.status_code, detail="Failed to fetch from Google Calendar")
    
    gcal_data = resp.json()
    new_events_count = 0
    today_str = today.strftime("%Y-%m-%d")
    
    for item in gcal_data.get("items", []):
        title = item.get("summary", "Busy")
        start_time = item.get("start", {}).get("dateTime")
        end_time = item.get("end", {}).get("dateTime")
        
        # skip all-day events for now
        if not start_time or not end_time:
            continue 
        
        try:
            # parse 2026-05-16T14:00:00+07:00 -> Date & Time
            event_date_str = start_time.split("T")[0]
            start_hm = start_time.split("T")[1][:5]
            end_hm = end_time.split("T")[1][:5]
            
            # Avoid duplicate exactly matched by title and start time
            exists = db.query(Event).filter(
                Event.user_id == current_user.id,
                Event.event_date == event_date_str,
                Event.title == "[GCal] " + title,
                Event.start == start_hm
            ).first()
            
            if not exists:
                db_event = Event(
                    id=str(uuid.uuid4()),
                    user_id=current_user.id,
                    title="[GCal] " + title,
                    start=start_hm,
                    end=end_hm,
                    event_date=event_date_str,
                    is_immovable=True, 
                    priority="high"
                )
                db.add(db_event)
                new_events_count += 1
        except Exception:
            continue

    db.commit()
    return {"status": "success", "synced_count": new_events_count}

# ===========================================================================
# EVENTS ENDPOINTS (now persisted in SQLite)
# ===========================================================================

@app.get("/api/events")
def get_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today = datetime.now().strftime("%Y-%m-%d")
    all_events = db.query(Event).filter(Event.user_id == current_user.id).all()
    
    today_events = [e for e in all_events if e.event_date == today]
    
    return {
        "today_events": [
            {"id": e.id, "title": e.title, "start": e.start, "end": e.end,
             "is_immovable": e.is_immovable, "priority": e.priority, "date": e.event_date}
            for e in today_events
        ],
        "all_events": [
            {"id": e.id, "title": e.title, "start": e.start, "end": e.end,
             "is_immovable": e.is_immovable, "priority": e.priority, "date": e.event_date}
            for e in all_events
        ]
    }

@app.post("/api/events")
def add_event(
    event: CalendarEvent,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today = datetime.now().strftime("%Y-%m-%d")
    db_event = Event(
        id=event.id or str(uuid.uuid4()),
        user_id=current_user.id,
        title=event.title,
        start=event.start,
        end=event.end,
        event_date=today,
        is_immovable=event.is_immovable,
        priority=event.priority,
    )
    db.add(db_event)
    db.commit()
    return {"status": "success", "event": db_event.id}

@app.delete("/api/events/{event_id}")
def delete_event(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    event = db.query(Event).filter(Event.id == event_id, Event.user_id == current_user.id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event tidak ditemukan.")
    db.delete(event)
    db.commit()
    return {"status": "deleted"}

# ===========================================================================
# RESCHEDULE (Panic Button)
# ===========================================================================

@app.post("/api/reschedule")
async def reschedule(
    request: RescheduleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """The Panic Button — let AI reschedule the rest of your day."""
    result = await call_gemini(request.dict())

    # Persist the rescue record
    record = CheckinRecord(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        type="rescue",
        energy_level=request.user_condition.energy_level,
        mood=request.user_condition.mood,
        events_before=len(request.today_events),
        events_after=len(result.get("new_schedule", [])),
    )
    db.add(record)

    # Apply new schedule to DB (replace today's events with AI result)
    new_schedule = result.get("new_schedule", [])
    if new_schedule:
        today = datetime.now().strftime("%Y-%m-%d")
        # Remove all existing today's events
        db.query(Event).filter(
            Event.user_id == current_user.id,
            Event.event_date == today
        ).delete()
        # Insert rescheduled events
        for ev in new_schedule:
            db.add(Event(
                id=str(uuid.uuid4()),
                user_id=current_user.id,
                title=ev.get("title", "Untitled"),
                start=ev.get("start", "09:00"),
                end=ev.get("end", "10:00"),
                event_date=today,
                is_immovable=ev.get("is_immovable", False),
                priority=ev.get("priority", "medium"),
            ))
    db.commit()
    return result

# ===========================================================================
# CHECK-IN
# ===========================================================================

@app.post("/api/checkin")
async def morning_checkin(
    request: CheckinRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    payload = {
        "current_time": request.wake_up_time,
        "user_condition": {
            "sleep_hours": request.sleep_hours,
            "energy_level": request.energy_level,
            "mood": request.mood,
            "message": f"Aku baru bangun jam {request.wake_up_time}. Tidurku {request.sleep_hours} jam.",
        },
        "today_events": [e.dict() for e in request.today_events],
    }
    result = await call_gemini(payload)
    record = CheckinRecord(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        type="checkin",
        sleep_hours=request.sleep_hours,
        energy_level=request.energy_level,
        mood=request.mood,
    )
    db.add(record)
    db.commit()
    return result

# ===========================================================================
# JOURNAL
# ===========================================================================

@app.post("/api/journal")
async def save_journal(
    entry: JournalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    analysis = {
        "mood": "netral",
        "productivity": 5,
        "blockers": [],
        "insight": "Terima kasih sudah menulis hari ini. Terus semangat!"
    }
    if not DEMO_MODE and genai_model is not None:
        try:
            prompt = f"""Analyze this journal entry in Indonesian. 
            Return JSON: {{"mood":"...","productivity":N,"blockers":[...],"insight":"..."}}
            Journal: {entry.text}"""
            response = genai_model.generate_content(prompt)
            analysis = json.loads(response.text)
        except Exception:
            pass

    record = JournalEntry(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        text=entry.text,
        mood=analysis.get("mood"),
        date=entry.date or datetime.now().strftime("%Y-%m-%d"),
    )
    db.add(record)
    db.commit()
    return {"status": "saved", "analysis": analysis}

@app.get("/api/journal")
def get_journal(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    entries = db.query(JournalEntry).filter(
        JournalEntry.user_id == current_user.id
    ).order_by(JournalEntry.created_at.desc()).limit(30).all()
    return {"entries": [
        {"id": e.id, "text": e.text, "mood": e.mood, "date": e.date}
        for e in entries
    ]}

# ===========================================================================
# DASHBOARD ANALYTICS
# ===========================================================================

@app.get("/api/dashboard")
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    records = db.query(CheckinRecord).filter(CheckinRecord.user_id == current_user.id).all()
    avg_energy = (
        round(sum(r.energy_level for r in records if r.energy_level) / len(records), 1)
        if records else 0
    )
    return {
        "total_reschedules": sum(1 for r in records if r.type == "rescue"),
        "total_checkins": sum(1 for r in records if r.type == "checkin"),
        "avg_energy": avg_energy,
        "checkin_history": [
            {"type": r.type, "mood": r.mood, "energy_level": r.energy_level,
             "timestamp": r.timestamp.isoformat()}
            for r in records[-30:]
        ],
    }

@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "DEMO" if DEMO_MODE else "LIVE"}

# ---------------------------------------------------------------------------
# Serve frontend
# ---------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

@app.get("/")
async def root():
    return FileResponse(str(BASE_DIR / "static" / "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
