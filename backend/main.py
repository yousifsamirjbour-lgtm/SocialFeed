import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from backend.models.db import create_db_and_tables
from backend.models.schemas import UserRead, UserCreate
from backend.core.users import auth_backend, fastapi_users
from backend.api.posts import router as posts_router
from backend.api.comments import router as comments_router
from backend.api.users import router as users_router
from backend.api.search_route import router as search_router
from backend.api.ai_studio import router as ai_studio_router
from backend.api.chat import router as chat_router
from backend.api.audio import router as audio_router
from backend.api.voice import router as voice_router
from backend.api.notifications import router as notifications_router
from backend.api.conversations import router as conversations_router
@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_db_and_tables()
    yield

app = FastAPI(title="Joupro API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", 
        "http://127.0.0.1:5173",
        "http://13.62.51.232:5173",
        "https://socialfeed.duckdns.org"
    ], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Authentication Routers
app.include_router(
    fastapi_users.get_auth_router(auth_backend),
    prefix="/auth/jwt",
    tags=["Auth"]
)
app.include_router(
    fastapi_users.get_register_router(UserRead, UserCreate),
    prefix="/auth",
    tags=["Auth"]
)

# Feature Routers
app.include_router(posts_router)
app.include_router(comments_router)
app.include_router(users_router)
app.include_router(search_router)
app.include_router(search_router, prefix="/api")
app.include_router(ai_studio_router)
app.include_router(ai_studio_router, prefix="/api")
app.include_router(chat_router)
app.include_router(chat_router, prefix="/api")
app.include_router(audio_router)
app.include_router(audio_router, prefix="/api")
app.include_router(voice_router)
app.include_router(voice_router, prefix="/api")
app.include_router(notifications_router)
app.include_router(notifications_router, prefix="/api")
app.include_router(conversations_router)
app.include_router(conversations_router, prefix="/api")

# Static Files
os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")