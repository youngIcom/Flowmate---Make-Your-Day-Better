"""
FlowMate — Empathic AI Scheduling Assistant
Backend server powered by FastAPI + Google Gemini
"""

import os
import json
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

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
app = FastAPI(title="FlowMate API", version="1.0.0")

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
# In-memory storage (replaced by Firestore in production)
# ---------------------------------------------------------------------------
journal_entries: list = []
checkin_history: list = []
user_events: list = []  # Real user events — starts empty

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

@app.post("/api/reschedule")
async def reschedule(request: RescheduleRequest):
    """The Panic Button — reschedule the rest of the day."""
    result = await call_gemini(request.dict())
    # Save to history
    checkin_history.append({
        "type": "rescue",
        "timestamp": datetime.now().isoformat(),
        "energy_level": request.user_condition.energy_level,
        "mood": request.user_condition.mood,
        "events_before": len(request.today_events),
        "events_after": len(result.get("new_schedule", [])),
    })
    return result

@app.post("/api/checkin")
async def morning_checkin(request: CheckinRequest):
    """Smart Morning Check-in — adjust today based on how you slept."""
    payload = {
        "current_time": request.wake_up_time,
        "user_condition": {
            "sleep_hours": request.sleep_hours,
            "energy_level": request.energy_level,
            "mood": request.mood,
            "message": f"Aku baru bangun jam {request.wake_up_time}. Tidurku {request.sleep_hours} jam. Mood: {request.mood}.",
        },
        "today_events": [e.dict() for e in request.today_events],
    }
    result = await call_gemini(payload)
    # Save to history
    checkin_history.append({
        "type": "checkin",
        "timestamp": datetime.now().isoformat(),
        "energy_level": request.energy_level,
        "mood": request.mood,
        "sleep_hours": request.sleep_hours,
    })
    return result

@app.post("/api/journal")
async def save_journal(entry: JournalRequest):
    """Save a journal entry and get AI insights."""
    record = {
        "text": entry.text,
        "date": entry.date or datetime.now().strftime("%Y-%m-%d"),
        "timestamp": datetime.now().isoformat(),
    }

    # Get AI analysis of the journal entry
    if not DEMO_MODE and genai_model is not None:
        try:
            analysis_prompt = f"""Analyze this journal entry from a user. Extract mood, productivity level (1-10), 
            main blockers, and provide one supportive insight. Respond in Indonesian. 
            Return JSON with: {{"mood": "...", "productivity": N, "blockers": ["..."], "insight": "..."}}
            
            Journal: {entry.text}"""
            response = genai_model.generate_content(analysis_prompt)
            record["analysis"] = json.loads(response.text)
        except Exception:
            record["analysis"] = {
                "mood": "netral",
                "productivity": 5,
                "blockers": [],
                "insight": "Terima kasih sudah menulis hari ini. Terus semangat!"
            }
    else:
        record["analysis"] = {
            "mood": "lelah tapi semangat",
            "productivity": 6,
            "blockers": ["kurang tidur", "tugas menumpuk"],
            "insight": "Kamu sudah berani jujur tentang kondisimu hari ini — itu langkah pertama yang bagus. Coba tidur 30 menit lebih awal malam ini."
        }

    journal_entries.append(record)
    return {"status": "saved", "entry": record}

@app.get("/api/journal")
async def get_journal():
    """Retrieve all journal entries."""
    return {"entries": journal_entries}

@app.get("/api/dashboard")
async def get_dashboard():
    """Get dashboard analytics data."""
    return {
        "checkin_history": checkin_history,
        "journal_entries": journal_entries,
        "total_reschedules": sum(1 for c in checkin_history if c["type"] == "rescue"),
        "total_checkins": sum(1 for c in checkin_history if c["type"] == "checkin"),
        "avg_energy": (
            round(sum(c["energy_level"] for c in checkin_history) / len(checkin_history), 1)
            if checkin_history else 0
        ),
    }

@app.get("/api/events")
async def get_events():
    """Get all user-created events."""
    return {"today_events": user_events}

@app.post("/api/events")
async def add_event(event: CalendarEvent):
    """Add a new event created by the user."""
    user_events.append(event.model_dump() if hasattr(event, "model_dump") else event.dict())
    return {"status": "success", "event": event}

@app.delete("/api/events/{event_id}")
async def delete_event(event_id: str):
    """Delete an event by ID."""
    global user_events
    user_events = [e for e in user_events if e["id"] != event_id]
    return {"status": "deleted"}

@app.get("/api/health")
async def health():
    return {"status": "ok", "mode": "DEMO" if DEMO_MODE else "LIVE"}

# ---------------------------------------------------------------------------
# Serve frontend static files
# ---------------------------------------------------------------------------
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

@app.get("/")
async def root():
    return FileResponse(str(BASE_DIR / "static" / "index.html"))

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
