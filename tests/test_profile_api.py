from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import main
from database import Base, User


def build_client(tmp_path: Path):
    db_path = tmp_path / 'test_profile.db'
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    db = TestingSessionLocal()
    user = User(
        id='user-1',
        username='flow_user',
        email='flow@example.com',
        hashed_pw='hashed',
        display_name='Flow User',
        default_wake_time='07:00',
        default_sleep_hours=7.5,
        timezone='Asia/Jakarta',
        focus_mode_enabled=False,
    )
    db.add(user)
    db.commit()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    def override_get_current_user():
        return db.query(User).filter(User.id == 'user-1').first()

    main.app.dependency_overrides[main.get_db] = override_get_db
    main.app.dependency_overrides[main.get_current_user] = override_get_current_user

    client = TestClient(main.app)
    return client, db


def teardown_client(db):
    main.app.dependency_overrides.clear()
    db.close()


def test_get_profile_returns_live_user_preferences(tmp_path):
    client, db = build_client(tmp_path)
    try:
        response = client.get('/api/profile')
        assert response.status_code == 200
        payload = response.json()
        assert payload['display_name'] == 'Flow User'
        assert payload['email'] == 'flow@example.com'
        assert payload['default_wake_time'] == '07:00'
        assert payload['default_sleep_hours'] == 7.5
        assert payload['timezone'] == 'Asia/Jakarta'
        assert payload['focus_mode_enabled'] is False
    finally:
        teardown_client(db)


def test_patch_profile_updates_and_normalizes_blank_values(tmp_path):
    client, db = build_client(tmp_path)
    try:
        response = client.patch(
            '/api/profile',
            json={
                'display_name': '  Naya  ',
                'default_wake_time': '',
                'default_sleep_hours': 8,
                'timezone': '  ',
                'focus_mode_enabled': True,
            },
        )
        assert response.status_code == 200
        payload = response.json()['profile']
        assert payload['display_name'] == 'Naya'
        assert payload['default_wake_time'] == '07:00'
        assert payload['default_sleep_hours'] == 8
        assert payload['timezone'] == 'Asia/Jakarta'
        assert payload['focus_mode_enabled'] is True
    finally:
        teardown_client(db)
