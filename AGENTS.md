# Repository Guidelines

## Project Structure & Module Organization

FlowMate is a FastAPI app with a static frontend. Backend entrypoints live at the repository root: `main.py` defines the API and static serving, `database.py` contains SQLAlchemy models/session setup, and `auth.py` handles JWT and password helpers. Frontend files are in `static/`: `static/index.html`, `static/css/style.css`, and `static/js/app.js`. Product and planning notes live in `document_requirement/`. Runtime data such as `flowmate.db`, `.env`, and generated cache files should stay out of source changes unless explicitly requested.

## Build, Test, and Development Commands

Create an environment and install dependencies:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Run locally in demo mode:

```bash
cp .env.example .env
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Build and run the containerized app:

```bash
docker compose up --build
```

The Docker service maps host port `8000` to container port `8080`.

## Coding Style & Naming Conventions

Use Python 3.11-compatible code, 4-space indentation, and explicit imports. Keep API schemas as Pydantic `BaseModel` classes in PascalCase, route/helper functions in `snake_case`, and endpoint paths under `/api/...`. Follow the existing style of short docstrings for public helpers and section comments for large modules. Keep frontend changes scoped to `static/js/app.js` and `static/css/style.css`; use descriptive DOM IDs/classes that match existing names.

## Testing Guidelines

No automated test suite is currently committed. For new backend behavior, add tests under `tests/` using `pytest` and FastAPI `TestClient`; name files `test_<feature>.py`. Cover authentication, database writes, and API response shapes for changed endpoints. Until tests exist, verify manually by running `uvicorn` and exercising the relevant API or UI flow.

## Commit & Pull Request Guidelines

Recent history uses short, direct messages, sometimes with Conventional Commit prefixes such as `feat:`. Prefer `feat: add calendar import`, `fix: handle expired token`, or concise Indonesian descriptions when matching existing work. Pull requests should include a brief summary, affected screens/endpoints, linked issue or requirement document when relevant, manual test notes, and screenshots for visible UI changes.

## Security & Configuration Tips

Copy `.env.example` to `.env` for local configuration. Keep `GEMINI_API_KEY`, `SECRET_KEY`, `.env`, and local SQLite databases private. Use `DEMO_MODE=true` for offline development; set `DEMO_MODE=false` only when a valid Gemini key is available.
