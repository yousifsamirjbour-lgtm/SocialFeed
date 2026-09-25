# Joupro / SocialFeed

Joupro (SocialFeed) is a full-stack social application for sharing posts, following users, and discovering content. It combines a FastAPI API, a React/Vite browser client, and PostgreSQL persistence, with an optional LangGraph-powered web-search agent.

## Project Overview

The backend is built with FastAPI and SQLAlchemy's async database layer. The frontend is a React single-page application served during development by Vite. PostgreSQL stores users, posts, comments, follows, likes, and saved-post relationships.

The API is mounted at `/api` for application endpoints, including `POST /api/search-agent`. In local development, Vite proxies `/api` requests to the FastAPI server on port `8000`.

## Key Features

- Register and authenticate with JWT-backed sessions.
- Publish image and video posts, comment, like, save, and delete content.
- Follow users and browse followers, following lists, and user profiles.
- Search users by email and view profile posts.
- Search the web with a LangGraph ReAct agent using Tavily search and a Groq-hosted language model.
- Render AI responses as GitHub Flavored Markdown, including tables, lists, and links.
- Open rendered source links in a new tab with `noopener noreferrer` protection.
- Upload and crop profile photos; serve uploaded files from the backend.

## Tech Stack

| Area | Technologies |
| --- | --- |
| Backend | Python, FastAPI, SQLAlchemy, asyncpg, FastAPI Users |
| Frontend | React, Vite, react-markdown, remark-gfm |
| AI services | LangGraph, LangChain, Groq, Tavily, LangSmith tracing (optional) |
| Database | PostgreSQL |
| Infrastructure and delivery | Docker, Docker Compose, Terraform, AWS EC2, GitHub Actions |

## Project Structure

```text
.
├── backend/
│   ├── agents/             # LangGraph web-search agent
│   ├── api/                # FastAPI route modules
│   ├── core/               # Authentication, services, image setup
│   ├── models/             # SQLAlchemy models and Pydantic schemas
│   └── main.py             # FastAPI application
├── frontend/
│   ├── src/                # React application, pages, components, styles
│   ├── Dockerfile
│   └── package.json
├── terraform/
│   └── main.tf             # AWS EC2 instance and security group
├── .github/workflows/
│   └── deploy.yml          # Manually dispatched EC2 deployment
├── docker-compose.yml
├── Dockerfile              # Backend container
├── pyproject.toml
└── requirements.txt
```

## Prerequisites

- Python **3.14** for the local environment (`.python-version` and `pyproject.toml`).
- Node.js 20 or later and npm.
- PostgreSQL 15 or later, either installed locally or run with Docker Compose.
- Docker Engine with the Docker Compose plugin for container workflows.
- Terraform and AWS credentials for provisioning the configured EC2 resources.
- Groq and Tavily API credentials to use AI Web Search.

## Environment Variables

Create `backend/.env` locally. Do not commit it: `.env` files are excluded by `.gitignore`. Replace every placeholder with a value from your own account; never put real credentials in this README or source control.

```dotenv
# Required: PostgreSQL connection using the asyncpg SQLAlchemy driver.
# Use localhost when the API runs on your host; use db when it runs in Compose.
DATABASE_URL=postgresql+asyncpg://<user>:<password>@<host>:5432/<database>

# Required by the authentication setup. Generate a long, random value.
JWT_SECRET_KEY=<your-random-secret>

# Required for AI Web Search.
GROQ_API_KEY=<your-groq-api-key>
TAVILY_API_KEY=<your-tavily-api-key>

# Optional: configure if using Cloudinary-backed media features.
CLOUDINARY_CLOUD_NAME=<your-cloud-name>
CLOUDINARY_API_KEY=<your-cloudinary-api-key>
CLOUDINARY_API_SECRET=<your-cloudinary-api-secret>

# Optional: enable LangSmith tracing and provide a key when enabled.
LANGSMITH_TRACING=false
LANGSMITH_API_KEY=<your-langsmith-api-key>
```

Generate a JWT secret locally in PowerShell with:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

The API loads the environment file when started with `--env-file backend/.env`. The Docker Compose API service also reads `backend/.env`. Keep the database host appropriate to where the API process runs: `localhost` for a host process, or the Compose service name `db` for a container.

## Local Setup & Installation

The commands below use Windows PowerShell from the repository root.

### 1. Start PostgreSQL

Use a local PostgreSQL server, or start the database service defined in Compose:

```powershell
docker compose up -d db
```

Configure `DATABASE_URL` in `backend/.env` with credentials and a database that exist in your PostgreSQL service. When using the Compose database from the host, connect through `localhost`; when the API is containerized, use `db` as the hostname.

### 2. Create the backend environment

Create `backend/.env` using the template above, then create and activate a virtual environment:

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m ensurepip --upgrade
python -m pip install --upgrade pip
```

The checked-in `requirements.txt` is UTF-16 encoded. Convert it to a temporary UTF-8 file before passing it to pip:

```powershell
Get-Content .\requirements.txt -Raw -Encoding Unicode | Set-Content .\requirements.utf8.txt -Encoding utf8
python -m pip install -r .\requirements.utf8.txt
Remove-Item .\requirements.utf8.txt
```

The current Python dependency manifests do not include the packages imported by `backend/agents/web_search.py`. Install those for local AI Web Search:

```powershell
python -m pip install langchain langgraph langchain-groq langchain-tavily
```

The AI packages should be added to the project's dependency manifests before producing a backend image; see [Docker](#docker) below.

### 3. Install the frontend

```powershell
Push-Location .\frontend
npm install
Pop-Location
```

## Running the Application

Start the backend in one PowerShell terminal from the repository root:

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn backend.main:app --reload --env-file backend/.env
```

Start the frontend in a second terminal:

```powershell
Set-Location .\frontend
npm run dev
```

Open the Vite URL shown in the terminal, typically `http://localhost:5173`. The FastAPI server listens on `http://localhost:8000`; its interactive API documentation is available at `http://localhost:8000/docs`. Vite proxies frontend `/api` requests to the backend during development.

Useful frontend checks:

```powershell
Push-Location .\frontend
npm run lint
npm run build
Pop-Location
```

## Infrastructure & CI/CD Strategy

### Terraform

`terraform/main.tf` configures AWS in `eu-north-1` and defines:

- One `t3.micro` EC2 instance for the application host.
- One security group attached to an existing VPC.
- Inbound rules for SSH, HTTP, HTTPS, Vite on port `5173`, and the API on port `8000`.

Terraform does not provision PostgreSQL, a load balancer, or a managed database. The database is defined separately in Docker Compose. The security group currently permits inbound access from `0.0.0.0/0`, including SSH and application development ports; restrict these rules to trusted addresses and production requirements before deployment. Terraform state files can contain sensitive infrastructure details and must remain private.

With AWS credentials configured and the referenced VPC available, review changes before applying:

```powershell
Set-Location .\terraform
terraform init
terraform plan
terraform apply
```

### Docker

The root `Dockerfile` builds the FastAPI service. `frontend/Dockerfile` builds a Node/Vite development container. `docker-compose.yml` defines API, frontend, and PostgreSQL services, maps their ports, and stores PostgreSQL data in a named volume.

There are currently configuration gaps to resolve before relying on a full container build:

- `pyproject.toml` and `.python-version` require Python 3.14, while the API `Dockerfile` uses Python 3.11.
- The backend dependency manifests do not list `langchain`, `langgraph`, `langchain-groq`, or `langchain-tavily`; the API Dockerfile only installs `requirements.txt`, but the API imports the search agent at startup.
- `requirements.txt` is UTF-16 encoded, while the Dockerfile passes it directly to pip. Normalize it to UTF-8 and keep the Docker build input aligned with the local dependency manifest.
- `frontend/Dockerfile` declares port `3000`, but Vite's development server and Compose port mapping use `5173`.

Align the Python base image, dependency manifests, requirements encoding, and frontend port declaration before running `docker compose up --build` as a deployment workflow. Also ensure the API container's `DATABASE_URL` uses the Compose database hostname `db` and that credentials match the database service configuration.

### GitHub Actions

`.github/workflows/deploy.yml` defines a **manual deployment workflow**, not an automatic push or pull-request pipeline. It runs on `workflow_dispatch` and:

1. Checks out the repository on an Ubuntu runner.
2. Connects to the configured EC2 host over SSH using `appleboy/ssh-action`.
3. Pulls `main` in `/home/ubuntu/SocialFeed`.
4. Runs `sudo docker compose up -d --build` on the EC2 instance.

Configure the repository Actions secrets `EC2_HOST` and `EC2_SSH_KEY` for this workflow. The workflow does not currently run automated tests or build and publish container images; those steps would need to be added separately if desired.
