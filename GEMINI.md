# Joupro (SocialFeed) - Project Instructions & Guidelines

## 1. Project Overview

**Joupro (SocialFeed)** is a full-stack social media application with AI-augmented web search capabilities.
- **Backend**: FastAPI with async SQLAlchemy ORM and PostgreSQL persistence.
- **Frontend**: React 19 single-page application built with Vite.
- **AI Agent**: LangGraph-powered ReAct agent using ChatGroq and Tavily search.
- **Infrastructure**: Docker, Docker Compose, Terraform (AWS EC2 `eu-north-1`), and GitHub Actions.
- **Production Host / Domain**: `https://socialfeed.duckdns.org` (EC2 `13.62.51.232`).

---

## 2. Tech Stack & Dependencies

### Backend
- **Runtime**: Python 3.11+ / 3.14 (project requires `>=3.11`).
- **Framework**: FastAPI (`fastapi>=0.139.2`), Uvicorn.
- **Database & ORM**: PostgreSQL, SQLAlchemy 2.0 (`asyncpg`), connection pool configured (`pool_size=10, max_overflow=20`).
- **Authentication**: `fastapi-users` with SQLAlchemy UUID adapter and JWT Bearer strategy.
- **Media Uploads**: Cloudinary API (`cloudinary.uploader` with eager async MP4 conversion for video uploads). Local disk storage for avatars (`uploads/avatars/`).
- **AI / Agentic**: `langgraph`, `langchain-groq` (model: `openai/gpt-oss-20b`), `langchain-tavily` (`TavilySearch`).

### Frontend
- **Framework**: React 19, Vite 6+, JavaScript (ESModules).
- **Styling**: Modular CSS (`App.css`, `index.css`, `SearchAgentPage.css`).
- **Markdown & Rendering**: `react-markdown`, `remark-gfm` (for AI search responses and markdown tables/links).
- **Image Editing**: `react-easy-crop` for profile avatar cropping.
- **HTTP**: Native `fetch` with JWT token storage in `localStorage`.

### DevOps & Infrastructure
- **Containers**: Multi-service `docker-compose.yml` (`api`, `frontend`, `db`).
- **Cloud Infrastructure**: Terraform config in `terraform/main.tf` targeting AWS EC2 (`t3.micro`, security group ports 22, 80, 443, 5173, 8000).
- **CI/CD**: Manual deployment via `.github/workflows/deploy.yml` (`workflow_dispatch` executing SSH pull + compose up).

---

## 3. Architecture & Repository Structure

```text
joupro/
├── backend/
│   ├── agents/
│   │   └── web_search.py        # LangGraph ReAct agent (Groq + Tavily)
│   ├── api/
│   │   ├── comments.py          # Comment CRUD and authorization checks
│   │   ├── posts.py             # Feed, upload, like toggle, save toggle, delete
│   │   ├── search_route.py      # POST /api/search-agent endpoint
│   │   └── users.py             # Profile, follow/unfollow, likers, search, saved/liked
│   ├── core/
│   │   ├── images.py            # Cloudinary client initialization
│   │   ├── services.py          # Post decoration helper (fetch_decorated_posts)
│   │   └── users.py             # FastAPI-Users manager & JWT strategy
│   ├── models/
│   │   ├── db.py                # DeclarativeBase, SQLAlchemy models, engine & session
│   │   └── schemas.py           # Pydantic v2 models & response schemas
│   ├── main.py                  # FastAPI instance, CORS, routers, static files
│   └── .env                     # Local environment variables (DO NOT COMMIT)
├── frontend/
│   ├── src/
│   │   ├── components/          # Navbar, PostCard, modals (Likers, Follow, EditProfile), badges
│   │   ├── pages/               # AuthPage, FeedPage, ProfilePage, SearchPage, SearchAgentPage
│   │   ├── styles/              # App.css, index.css
│   │   ├── App.jsx              # Main routing & state coordinator
│   │   └── main.jsx             # React entry point
│   ├── Dockerfile               # Node 20 dev image
│   ├── package.json
│   └── vite.config.js           # Dev proxy config (/api -> http://api:8000 or localhost)
├── terraform/
│   └── main.tf                  # AWS provider, Security Group & EC2 instance
├── .github/workflows/
│   └── deploy.yml               # Manual SSH-based EC2 deployment
├── docker-compose.yml           # Multi-container orchestration (api, frontend, db)
├── Dockerfile                   # Python backend container
├── main.py                      # Root launcher script for uvicorn
├── pyproject.toml               # Python project dependencies
└── requirements.txt             # Pip dependency list
```

---

## 4. Key Data Models & Database Patterns

- **`User`** (`backend/models/db.py`):
  - Table: `users` (inherits `SQLAlchemyBaseUserTableUUID`).
  - Fields: `id` (UUID), `email`, `hashed_password`, `bio`, `profile_picture_url`, `created_at`.
- **`post`** (`backend/models/db.py`):
  - Table: `posts` (Notice class name is lowercase `post`).
  - Fields: `id` (UUID), `caption`, `url`, `file_type`, `file_name`, `created_at`, `user_id`.
  - Relationships: `owner`, `likes`, `comments`, `saves`.
- **`Like`** & **`SavedPost`**:
  - Tables: `likes`, `saved_posts` with composite primary key `(user_id, post_id)` and cascade deletion.
- **`Follow`**:
  - Table: `follows` with composite primary key `(follower_id, followed_id)`.
- **`Comment`**:
  - Table: `comments` with `id` (UUID), `text`, `user_id`, `post_id`, `created_at`.
  - Deletion rule: Only comment author OR post owner can delete comments.

### Post Decoration Pattern (`fetch_decorated_posts`)
When querying posts for feeds or profile views, use `fetch_decorated_posts` in `backend/core/services.py`:
- Injects correlated subqueries for `comment_count` and `like_count`.
- Eager-loads relationships using `selectinload` (`likes`, `comments`, `owner`, `saves`).
- Resolves boolean flags dynamically: `is_liked`, `is_saved`, and `owner.is_following`.

---

## 5. Development Guidelines & Conventions

### Python / FastAPI
- Always use **async** functions for routes and database operations (`async def`, `await session.execute()`).
- Use dependency injection:
  - `session: AsyncSession = Depends(get_async_session)`
  - `user: User = Depends(current_active_user)`
- Always wrap external or flaky API calls (Groq, Tavily, Cloudinary) in structured try/except blocks with informative `HTTPException` responses.
- Respect existing model naming conventions (e.g. `post` model class name in `db.py`).
- Keep SQLAlchemy relationship updates and transactions atomic (`session.add`, `session.delete`, `await session.commit()`).

### React / Frontend
- State management is primarily centralized in `App.jsx` and passed down via props to pages and modal components.
- Keep components responsive and clean: reuse `UserBadge`, `ProfileAvatar`, and `PostCard`.
- In `SearchAgentPage`: ensure external markdown source links always open with `target="_blank"` and `rel="noopener noreferrer"`.
- Use the Vite proxy configuration (`/api`) rather than hardcoding hostnames for local development.

### Security & Environment
- Never commit secrets or hardcode keys. The `.env` file in `backend/.env` requires:
  - `DATABASE_URL` (format: `postgresql+asyncpg://...`)
  - `JWT_SECRET_KEY`
  - `GROQ_API_KEY`
  - `TAVILY_API_KEY`
  - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- Ensure CORS in `backend/main.py` permits authorized origins (`localhost:5173`, `socialfeed.duckdns.org`).

---

## 6. Common Development Commands

### Backend Commands (PowerShell)
```powershell
# Activate virtual environment
.\.venv\Scripts\Activate.ps1

# Run development server with auto-reload
uvicorn backend.main:app --reload --env-file backend/.env

# Or run via root main.py
python main.py
```

### Frontend Commands
```powershell
cd frontend
npm install
npm run dev      # Start Vite dev server on http://localhost:5173
npm run lint     # Run ESLint
npm run build    # Production build
```

### Docker & Database
```powershell
# Start PostgreSQL database only
docker compose up -d db

# Start all services
docker compose up --build
```
