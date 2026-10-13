import pytest
from backend.models.db import User

@pytest.mark.asyncio
async def test_signup_with_name_email_password_success(client):
    payload = {
        "name": "Alex Mercer",
        "email": "alex.mercer@gmail.com",
        "password": "StrongPassword123!"
    }
    res = await client.post("/auth/register", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "Alex Mercer"
    assert data["email"] == "alex.mercer@gmail.com"
    assert "id" in data

@pytest.mark.asyncio
async def test_signup_missing_name_fails(client):
    payload = {
        "email": "noname@gmail.com",
        "password": "StrongPassword123!"
    }
    res = await client.post("/auth/register", json=payload)
    assert res.status_code == 422

@pytest.mark.asyncio
async def test_signup_short_name_fails(client):
    payload = {
        "name": "A",
        "email": "shortname@gmail.com",
        "password": "StrongPassword123!"
    }
    res = await client.post("/auth/register", json=payload)
    assert res.status_code == 422

@pytest.mark.asyncio
async def test_signup_whitespace_padded_name_trims_properly(client):
    payload = {
        "name": "   Jane Doe   ",
        "email": "janedoe@gmail.com",
        "password": "StrongPassword123!"
    }
    res = await client.post("/auth/register", json=payload)
    assert res.status_code == 201
    assert res.json()["name"] == "Jane Doe"

@pytest.mark.asyncio
async def test_signup_long_name_fails(client):
    payload = {
        "name": "A" * 51,
        "email": "longname@gmail.com",
        "password": "StrongPassword123!"
    }
    res = await client.post("/auth/register", json=payload)
    assert res.status_code == 422

@pytest.mark.asyncio
async def test_signup_duplicate_email_fails(client, test_user):
    payload = {
        "name": "Duplicate User",
        "email": test_user.email,
        "password": "StrongPassword123!"
    }
    res = await client.post("/auth/register", json=payload)
    assert res.status_code == 400
    assert "REGISTER_USER_ALREADY_EXISTS" in res.json().get("detail", "")

@pytest.mark.asyncio
async def test_signup_invalid_email_fails(client):
    payload = {
        "name": "Valid Name",
        "email": "not-an-email",
        "password": "StrongPassword123!"
    }
    res = await client.post("/auth/register", json=payload)
    assert res.status_code == 422

@pytest.mark.asyncio
async def test_login_with_email_and_password_only(client, db_session):
    # Register user first
    signup_payload = {
        "name": "Login User",
        "email": "loginuser@gmail.com",
        "password": "MySecretPassword123!"
    }
    reg_res = await client.post("/auth/register", json=signup_payload)
    assert reg_res.status_code == 201

    # Login with standard OAuth2 form (username = email, password = password, no name)
    login_data = {
        "username": "loginuser@gmail.com",
        "password": "MySecretPassword123!"
    }
    login_res = await client.post("/auth/jwt/login", data=login_data)
    assert login_res.status_code == 200
    token_data = login_res.json()
    assert "access_token" in token_data
    assert token_data["token_type"] == "bearer"

    # Use token to call GET /users/me and verify identity
    headers = {"Authorization": f"Bearer {token_data['access_token']}"}
    me_res = await client.get("/users/me", headers=headers)
    assert me_res.status_code == 200
    me_data = me_res.json()
    assert me_data["name"] == "Login User"
    assert me_data["email"] == "loginuser@gmail.com"

@pytest.mark.asyncio
async def test_public_author_and_search_never_leak_email(client, test_user, sample_post, sample_comment, auth_headers):
    # 1. Feed owner schema
    feed_res = await client.get("/feed", headers=auth_headers)
    assert feed_res.status_code == 200
    feed_posts = feed_res.json()
    assert len(feed_posts) >= 1
    post_owner = feed_posts[0]["owner"]
    assert post_owner["name"] == test_user.name
    assert "email" not in post_owner

    # 2. Comments author schema
    comment_res = await client.get(f"/posts/{sample_post.id}/comments", headers=auth_headers)
    assert comment_res.status_code == 200
    comments = comment_res.json()
    assert len(comments) >= 1
    comment_author = comments[0]["author"]
    assert comment_author["name"] == test_user.name
    assert "email" not in comment_author

    # 3. User search schema
    search_res = await client.get(f"/users/search?q={test_user.name[:4]}", headers=auth_headers)
    assert search_res.status_code == 200
    search_users = search_res.json()
    assert len(search_users) >= 1
    matched_user = search_users[0]
    assert matched_user["name"] == test_user.name
    assert "email" not in matched_user

    # 4. Profile view schema
    profile_res = await client.get(f"/users/{test_user.id}/profile", headers=auth_headers)
    assert profile_res.status_code == 200
    profile_data = profile_res.json()
    assert profile_data["name"] == test_user.name
    assert "email" not in profile_data
