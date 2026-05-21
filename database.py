"""
FlowMate — Database Layer (SQLite via SQLAlchemy)
Handles Users, Events, Journal Entries, Check-in History,
Rescue Sessions, Schedule Actions, and Calendar Snapshots.
"""

from sqlalchemy import create_engine, Column, String, Integer, Float, Boolean, DateTime, Text
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime
import uuid

DATABASE_URL = "sqlite:///./flowmate.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class User(Base):
    __tablename__ = "users"
    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username    = Column(String, unique=True, nullable=False, index=True)
    email       = Column(String, unique=True, nullable=False)
    hashed_pw   = Column(String, nullable=True)  # nullable for Google Auth users
    created_at  = Column(DateTime, default=datetime.utcnow)


class Event(Base):
    __tablename__ = "events"
    id            = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id       = Column(String, nullable=False, index=True)
    title         = Column(String, nullable=False)
    start         = Column(String, nullable=False)   # HH:MM
    end           = Column(String, nullable=False)   # HH:MM
    event_date    = Column(String, nullable=False)   # YYYY-MM-DD
    is_immovable  = Column(Boolean, default=False)
    priority      = Column(String, default="medium") # high / medium / low
    created_at    = Column(DateTime, default=datetime.utcnow)


class JournalEntry(Base):
    __tablename__ = "journal_entries"
    id                = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id           = Column(String, nullable=False, index=True)
    text              = Column(Text, nullable=False)
    mood              = Column(String, nullable=True)
    productivity_score = Column(Integer, nullable=True)  # 1-10 estimated productivity
    extracted_entities = Column(Text, nullable=True)     # JSON string: blockers, keywords
    date              = Column(String, nullable=False)   # YYYY-MM-DD
    created_at        = Column(DateTime, default=datetime.utcnow)


class CheckinRecord(Base):
    __tablename__ = "checkin_history"
    id            = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id       = Column(String, nullable=False, index=True)
    type          = Column(String, default="checkin")  # checkin | rescue
    sleep_hours   = Column(Float, nullable=True)
    energy_level  = Column(Integer, nullable=True)
    mood          = Column(String, nullable=True)
    events_before = Column(Integer, nullable=True)
    events_after  = Column(Integer, nullable=True)
    timestamp     = Column(DateTime, default=datetime.utcnow)


class RescueSession(Base):
    """Detailed record of each Debug My Day / rescue invocation."""
    __tablename__ = "rescue_sessions"
    id                   = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id              = Column(String, nullable=True, index=True)  # nullable for guest/demo
    situation_text       = Column(Text, nullable=True)
    mood                 = Column(String, nullable=True)
    energy_level         = Column(Integer, nullable=True)
    damage_score         = Column(Integer, nullable=True)   # 0-100
    damage_level         = Column(String, nullable=True)    # low/medium/high/critical
    recovery_score_before = Column(Integer, nullable=True)
    recovery_score_after  = Column(Integer, nullable=True)
    ai_summary           = Column(Text, nullable=True)
    mode                 = Column(String, default="demo")   # demo | live
    events_before_count  = Column(Integer, nullable=True)
    events_after_count   = Column(Integer, nullable=True)
    created_at           = Column(DateTime, default=datetime.utcnow)


class ScheduleAction(Base):
    """Persists each individual action taken by the recovery scheduler."""
    __tablename__ = "schedule_actions"
    id                = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    rescue_session_id = Column(String, nullable=False, index=True)
    user_id           = Column(String, nullable=True, index=True)
    action_type       = Column(String, nullable=False)  # move | defer | cancel | add_recovery | preserve
    event_title       = Column(String, nullable=True)
    old_start         = Column(String, nullable=True)   # HH:MM or None
    old_end           = Column(String, nullable=True)
    new_start         = Column(String, nullable=True)
    new_end           = Column(String, nullable=True)
    reason            = Column(Text, nullable=True)
    created_at        = Column(DateTime, default=datetime.utcnow)


class CalendarSnapshot(Base):
    """Raw event snapshot at the time of a rescue or check-in call."""
    __tablename__ = "calendar_snapshots"
    id              = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id         = Column(String, nullable=True, index=True)
    source          = Column(String, default="demo")   # demo | gcal | manual
    raw_events_json = Column(Text, nullable=False)     # JSON-encoded list of events
    created_at      = Column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Init DB
# ---------------------------------------------------------------------------

def init_db():
    """Create all tables that do not yet exist (non-destructive)."""
    Base.metadata.create_all(bind=engine)


def get_db():
    """FastAPI dependency: yields a DB session and closes it after."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
