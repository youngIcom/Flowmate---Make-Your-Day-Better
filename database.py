"""
FlowMate — Database Layer (SQLite via SQLAlchemy)
Handles Users, Events, Journal Entries, and Check-in History.
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
    hashed_pw   = Column(String, nullable=True) # Now nullable for Google Auth
    created_at  = Column(DateTime, default=datetime.utcnow)


class Event(Base):
    __tablename__ = "events"
    id            = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id       = Column(String, nullable=False, index=True)
    title         = Column(String, nullable=False)
    start         = Column(String, nullable=False)   # HH:MM
    end           = Column(String, nullable=False)
    event_date    = Column(String, nullable=False)   # YYYY-MM-DD
    is_immovable  = Column(Boolean, default=False)
    priority      = Column(String, default="medium") # high / medium / low
    created_at    = Column(DateTime, default=datetime.utcnow)


class JournalEntry(Base):
    __tablename__ = "journal_entries"
    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = Column(String, nullable=False, index=True)
    text       = Column(Text, nullable=False)
    mood       = Column(String, nullable=True)
    date       = Column(String, nullable=False)  # YYYY-MM-DD
    created_at = Column(DateTime, default=datetime.utcnow)


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


# ---------------------------------------------------------------------------
# Init DB
# ---------------------------------------------------------------------------

def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    """FastAPI dependency: yields a DB session and closes it after."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
