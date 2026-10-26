# brainbyts

AI-powered lecture summarization and learning assistant built with FastAPI and React.

brainbyts converts lecture sources into structured study material and interactive practice:
- Topic-structured summaries
- Retrieval-grounded contextual chat
- Solver chat with optional image input
- MCQ generation with explanations
- Exportable PDF revision sheet

## Video Explanation

Project walkthrough video:
- [Watch or download the video explanation](./docs/video-explanation.mp4)

## Highlights

- Multiple input modes: YouTube lecture URL, pasted text, text file, PDF
- User-selectable AI provider: Gemini through the backend or Ollama directly from the browser
- Session-based learning workflow: summarize -> chat -> MCQ -> PDF
- JWT authentication with MongoDB-backed user profiles
- Responsive frontend built with Vite + TailwindCSS + Framer Motion

## Tech Stack

- Backend: FastAPI, Pydantic, PyJWT, MongoDB (PyMongo)
- Frontend: React 18, Vite, TailwindCSS, Framer Motion
- AI Integration: Google Gemini, optional Ollama local model
- Document Export: ReportLab

## Architecture

- `backend/` exposes REST APIs for summarization, chat, MCQ, PDF export, and auth.
- `frontend/` provides the single-page learning interface.
- Session state for lecture context is held in backend memory with TTL.
- Auth users are persisted in MongoDB.

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+ and npm
- MongoDB connection string (for auth endpoints)
- Gemini API key in Settings or configured on the backend
- Optional: Ollama installed on the same computer as the browser for local inference

### 1) Backend setup (`http://localhost:8000`)

```bash
cd backend
python -m venv .venv

# Windows (PowerShell)
.venv\Scripts\Activate.ps1
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
```

Set values in `backend/.env`, then run:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 2) Frontend setup (`http://localhost:3000`)

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## Gemini BYOK

Open Settings from the navbar and save a Gemini API key for the current browser session. The key is stored in session storage, sent only with Gemini generation requests to the configured backend, and is not persisted by the backend. Use this only with a backend you trust, and use HTTPS when deployed. If no browser-session key is set, the backend can use `GEMINI_API_KEY` from its environment.

## Use Local Ollama

The provider selector offers Gemini and Ollama. In Ollama mode, the browser contacts the user's Ollama instance directly at the configured local URL (default `http://127.0.0.1:11434`). Prompts, transcripts used for generation, images, and generated answers are not sent to the app backend by the Ollama generation calls. The selected URL and model are saved in browser local storage.

Install Ollama, download at least one model, and start Ollama with the exact origin of the website allowed. For local development on the default Vite port:

```bash
ollama pull qwen2.5-coder:7b
OLLAMA_ORIGINS="http://localhost:3000" ollama serve
```

In PowerShell:

```powershell
ollama pull qwen2.5-coder:7b
$env:OLLAMA_ORIGINS = "http://localhost:3000"
ollama serve
```

If Ollama is already running as a desktop app or service, stop it first and configure `OLLAMA_ORIGINS` for that process before restarting. Open the website, select **Ollama (local)**, expand **Ollama setup**, check the connection, and select one of the models listed as installed. If Vite uses another port, or the site is deployed, allow that exact origin instead, including its scheme and port. Do not use `*` for a public website.

For a deployed HTTPS website, the visitor's browser still connects to Ollama on that visitor's computer; the remote app backend cannot reach it. Browser local-network permission and mixed-content policies can block that connection in some browser/deployment combinations. The UI reports connection/CORS failures, but users may need to grant browser permission or use a compatible browser. Ollama mode does not silently fall back to Gemini.

YouTube caption extraction and video metadata still use the app backend. Caption retrieval uses the `youtube-transcript-api` v1 instance API (`YouTubeTranscriptApi().fetch(...)`) with the watch-page fallback. Once captions reach the browser, Ollama generation happens locally. Pasted text and uploaded document text go directly from the browser to Ollama. Local PDF export opens a print view so the user can save it as PDF without uploading local model output.

## Environment Variables

### Backend (`backend/.env`)

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=models/gemini-2.5-flash
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
SESSION_TTL_MINUTES=240
JWT_SECRET=replace_with_secure_random_secret
JWT_EXP_MINUTES=10080
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
MONGO_DB_NAME=edu_simplify
ALLOW_IN_MEMORY_AUTH_FALLBACK=false
```

### Frontend (`frontend/.env`)

```env
VITE_API_BASE_URL=http://localhost:8000
```

## API Overview

- `GET /health` - service health check
- `POST /extract_captions` - extract transcript from YouTube URL
- `POST /video_meta` - fetch YouTube title/thumbnail/channel metadata
- `POST /summarize` - generate structured notes from transcript text
- `POST /chat` - contextual Q&A against lecture summary and chunks
- `POST /solver_chat` - solver assistant (supports base64 image data URL)
- `POST /mcq` - generate lecture-grounded MCQs
- `GET /pdf?session_id=...` - download summary and MCQ PDF
- `POST /auth/register` - register user
- `POST /auth/login` - sign in and get JWT
- `GET /auth/me` - validate JWT and fetch user profile

## Provider Routing

- Gemini generation requests go to the FastAPI backend, which calls Gemini.
- Ollama generation requests go directly from the browser to the selected local Ollama model.
- Selecting either provider does not trigger an automatic fallback to the other provider.

## Docker (Backend)

```bash
cd backend
docker build -t edu-simplify-api .
docker run --rm -p 8000:8000 --env-file .env edu-simplify-api
```

## Build Validation

```bash
# Backend
cd backend
python -m compileall app

# Frontend
cd ../frontend
npm run build
```

## Project Structure

```text
backend/
  app/
    api/
    core/
    models/
    services/
    main.py
  .env.example
  requirements.txt
  Dockerfile

frontend/
  src/
    components/
    context/
    hooks/
    pages/
    services/
  .env.example
  package.json
  vite.config.js
  tailwind.config.js

sample/
  sample_corpus.txt

docs/
  video-explanation.mp4
```

## License

This project is licensed under the MIT License. See `LICENSE`.
