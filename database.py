"""
FlowMate — Database Layer (SQLite via SQLAlchemy)
Handles Users, Events, Journal Entries, Check-in History,
Rescue Sessions, Schedule Actions, and Calendar Snapshots.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Text, create_engine, inspect
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = "sqlite:///./flowmate.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String, unique=True, nullable=False, index=True)
    email = Column(String, unique=True, nullable=False)
    hashed_pw = Column(String, nullable=True)
    display_name = Column(String, nullable=True)
    default_wake_time = Column(String, nullable=True, default="07:00")
    default_sleep_hours = Column(Float, nullable=True, default=7.5)
    timezone = Column(String, nullable=True, default="Asia/Jakarta")
    focus_mode_enabled = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Event(Base):
    __tablename__ = "events"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, index=True)
    title = Column(String, nullable=False)
    start = Column(String, nullable=False)
    end = Column(String, nullable=False)
    event_date = Column(String, nullable=False)
    is_immovable = Column(Boolean, default=False)
    priority = Column(String, default="medium")
    created_at = Column(DateTime, default=datetime.utcnow)


class JournalEntry(Base):
    __tablename__ = "journal_entries"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, index=True)
    text = Column(Text, nullable=False)
    mood = Column(String, nullable=True)
    productivity_score = Column(Integer, nullable=True)
    extracted_entities = Column(Text, nullable=True)
    date = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class CheckinRecord(Base):
    __tablename__ = "checkin_history"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, index=True)
    type = Column(String, default="checkin")
    sleep_hours = Column(Float, nullable=True)
    energy_level = Column(Integer, nullable=True)
    mood = Column(String, nullable=True)
    events_before = Column(Integer, nullable=True)
    events_after = Column(Integer, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)


class RescueSession(Base):
    __tablename__ = "rescue_sessions"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=True, index=True)
    situation_text = Column(Text, nullable=True)
    mood = Column(String, nullable=True)
    energy_level = Column(Integer, nullable=True)
    damage_score = Column(Integer, nullable=True)
    damage_level = Column(String, nullable=True)
    recovery_score_before = Column(Integer, nullable=True)
    recovery_score_after = Column(Integer, nullable=True)
    ai_summary = Column(Text, nullable=True)
    mode = Column(String, default="live")
    events_before_count = Column(Integer, nullable=True)
    events_after_count = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ScheduleAction(Base):
    __tablename__ = "schedule_actions"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    rescue_session_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=True, index=True)
    action_type = Column(String, nullable=False)
    event_title = Column(String, nullable=True)
    old_start = Column(String, nullable=True)
    old_end = Column(String, nullable=True)
    new_start = Column(String, nullable=True)
    new_end = Column(String, nullable=True)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class CalendarSnapshot(Base):
    __tablename__ = "calendar_snapshots"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=True, index=True)
    source = Column(String, default="live")
    raw_events_json = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


# ---------------------------------------------------------------------------
# Init DB
# ---------------------------------------------------------------------------
def ensure_user_profile_columns():
    inspector = inspect(engine)
    existing_columns = {column["name"] for column in inspector.get_columns("users")}
    ddl_statements = {
        "display_name": "ALTER TABLE users ADD COLUMN display_name VARCHAR",
        "default_wake_time": "ALTER TABLE users ADD COLUMN default_wake_time VARCHAR DEFAULT '07:00'",
        "default_sleep_hours": "ALTER TABLE users ADD COLUMN default_sleep_hours FLOAT DEFAULT 7.5",
        "timezone": "ALTER TABLE users ADD COLUMN timezone VARCHAR DEFAULT 'Asia/Jakarta'",
        "focus_mode_enabled": "ALTER TABLE users ADD COLUMN focus_mode_enabled BOOLEAN DEFAULT 0",
    }
    with engine.begin() as connection:
        for column_name, ddl in ddl_statements.items():
            if column_name not in existing_columns:
                connection.exec_driver_sql(ddl)

        connection.exec_driver_sql(
            "UPDATE users SET display_name = COALESCE(display_name, username), "
            "default_wake_time = COALESCE(default_wake_time, '07:00'), "
            "default_sleep_hours = COALESCE(default_sleep_hours, 7.5), "
            "timezone = COALESCE(timezone, 'Asia/Jakarta'), "
            "focus_mode_enabled = COALESCE(focus_mode_enabled, 0)"
        )


def init_db():
    """Create all tables that do not yet exist, then run lightweight migrations."""
    Base.metadata.create_all(bind=engine)
    ensure_user_profile_columns()


def get_db():
    """FastAPI dependency: yields a DB session and closes it after."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
