import io
import uuid
import pytest
from unittest.mock import patch, mock_open
from backend.models.db import User, Follow, Like, SavedPost, post

@pytest.mark.asyncio
async def test_follow_and_unfollow(client, test_user, test_user_2, auth_headers):
    # Follow test_user_2
    res = await client.post(f"/users/{test_user_2.id}/follow", headers=auth_headers)
    assert res.status_code == 200
    assert res.json() == {"message": "User followed", "is_following": True}

    # Unfollow test_user_2
    res_unfollow = await client.post(f"/users/{test_user_2.id}/follow", headers=auth_headers)
    assert res_unfollow.status_code == 200
    assert res_unfollow.json() == {"message": "User unfollowed", "is_following": False}

@pytest.mark.asyncio
async def test_follow_self_fails(client, test_user, auth_headers):
    res = await client.post(f"/users/{test_user.id}/follow", headers=auth_headers)
    assert res.status_code == 400
    assert "You cannot follow yourself" in res.json()["detail"]

@pytest.mark.asyncio
async def test_follow_nonexistent_user(client, auth_headers):
    random_id = uuid.uuid4()
    res = await client.post(f"/users/{random_id}/follow", headers=auth_headers)
    assert res.status_code == 404
    assert res.json()["detail"] == "User not found."

@pytest.mark.asyncio
async def test_follow_unauthorized(client, test_user_2):
    res = await client.post(f"/users/{test_user_2.id}/follow")
    assert res.status_code == 401

@pytest.mark.asyncio
async def test_get_all_users(client, test_user, test_user_2):
    res = await client.get("/users")
    assert res.status_code == 200
    users = res.json()
    assert len(users) >= 2
    names = [u["name"] for u in users]
    assert test_user.name in names
    assert test_user_2.name in names
    assert "email" not in users[0]

@pytest.mark.asyncio
async def test_get_user_profile(client, test_user, test_user_2, auth_headers, sample_post):
    # View test_user profile
    res = await client.get(f"/users/{test_user.id}/profile", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == test_user.name
    assert "email" not in data
    assert data["followers_count"] == 0
    assert data["following_count"] == 0
    assert "posts" in data

    # 404 for non-existent profile
    res_404 = await client.get(f"/users/{uuid.uuid4()}/profile", headers=auth_headers)
    assert res_404.status_code == 404

    # 401 for unauthorized
    res_401 = await client.get(f"/users/{test_user.id}/profile")
    assert res_401.status_code == 401

@pytest.mark.asyncio
async def test_search_users(client, test_user, auth_headers):
    # Empty query
    res_empty = await client.get("/users/search?q=  ", headers=auth_headers)
    assert res_empty.status_code == 200
    assert res_empty.json() == []

    # Valid search query by name
    res = await client.get("/users/search?q=Test", headers=auth_headers)
    assert res.status_code == 200
    results = res.json()
    assert len(results) >= 1
    assert any(u["name"] == test_user.name for u in results)
    assert "email" not in results[0]

    # Unauthorized
    res_unauth = await client.get("/users/search?q=test")
    assert res_unauth.status_code == 401

@pytest.mark.asyncio
async def test_get_followers_and_following(client, db_session, test_user, test_user_2, auth_headers):
    # Create follow relationship: test_user follows test_user_2
    follow = Follow(follower_id=test_user.id, followed_id=test_user_2.id)
    db_session.add(follow)
    await db_session.commit()

    # Get followers of test_user_2
    res_followers = await client.get(f"/users/{test_user_2.id}/followers", headers=auth_headers)
    assert res_followers.status_code == 200
    followers = res_followers.json()
    assert len(followers) == 1
    assert followers[0]["id"] == str(test_user.id)
    assert followers[0]["name"] == test_user.name
    assert "email" not in followers[0]

    # Get following of test_user
    res_following = await client.get(f"/users/{test_user.id}/following", headers=auth_headers)
    assert res_following.status_code == 200
    following = res_following.json()
    assert len(following) == 1
    assert following[0]["id"] == str(test_user_2.id)
    assert following[0]["name"] == test_user_2.name
    assert "email" not in following[0]

    # Empty followers
    res_empty = await client.get(f"/users/{test_user.id}/followers", headers=auth_headers)
    assert res_empty.status_code == 200
    assert res_empty.json() == []

    # Unauthorized
    res_unauth = await client.get(f"/users/{test_user.id}/followers")
    assert res_unauth.status_code == 401

@pytest.mark.asyncio
async def test_get_post_likers(client, db_session, test_user, sample_post, auth_headers):
    # Add like
    like = Like(user_id=test_user.id, post_id=sample_post.id)
    db_session.add(like)
    await db_session.commit()

    # Fetch likers
    res = await client.get(f"/posts/{sample_post.id}/likes", headers=auth_headers)
    assert res.status_code == 200
    likers = res.json()
    assert len(likers) == 1
    assert likers[0]["id"] == str(test_user.id)
    assert likers[0]["name"] == test_user.name
    assert "email" not in likers[0]

    # Post not found
    res_404 = await client.get(f"/posts/{uuid.uuid4()}/likes", headers=auth_headers)
    assert res_404.status_code == 404

    # Unauthorized
    res_401 = await client.get(f"/posts/{sample_post.id}/likes")
    assert res_401.status_code == 401

@pytest.mark.asyncio
async def test_get_saved_and_liked_posts(client, db_session, test_user, sample_post, auth_headers):
    # Save and like post
    saved = SavedPost(user_id=test_user.id, post_id=sample_post.id)
    like = Like(user_id=test_user.id, post_id=sample_post.id)
    db_session.add_all([saved, like])
    await db_session.commit()

    # Get saved
    res_saved = await client.get("/users/me/saved", headers=auth_headers)
    assert res_saved.status_code == 200
    assert len(res_saved.json()) >= 1
    assert res_saved.json()[0]["id"] == str(sample_post.id)

    # Get liked
    res_liked = await client.get("/users/me/liked", headers=auth_headers)
    assert res_liked.status_code == 200
    assert len(res_liked.json()) >= 1
    assert res_liked.json()[0]["id"] == str(sample_post.id)

    # Get liked-posts alias
    res_alias = await client.get("/users/me/liked-posts", headers=auth_headers)
    assert res_alias.status_code == 200
    assert len(res_alias.json()) >= 1

    # Unauthorized
    assert (await client.get("/users/me/saved")).status_code == 401
    assert (await client.get("/users/me/liked")).status_code == 401
    assert (await client.get("/users/me/liked-posts")).status_code == 401

@pytest.mark.asyncio
async def test_update_profile(client, test_user, auth_headers, tmp_path, monkeypatch):
    # 1. Update bio
    res_bio = await client.patch(
        "/users/me/profile",
        data={"bio": "Updated bio text"},
        headers=auth_headers
    )
    assert res_bio.status_code == 200
    assert res_bio.json()["bio"] == "Updated bio text"

    # 2. Upload avatar safely with mocked file I/O so disk is never touched
    monkeypatch.setattr("backend.api.users.os.makedirs", lambda path, exist_ok=True: None)

    fake_file = io.BytesIO(b"fake image avatar bytes")
    files = {"file": ("avatar.jpg", fake_file, "image/jpeg")}
    with patch("builtins.open", mock_open()), \
         patch("backend.api.users.shutil.copyfileobj"):
        res_photo = await client.patch(
            "/users/me/profile",
            files=files,
            headers=auth_headers
        )
    assert res_photo.status_code == 200
    assert res_photo.json()["profile_picture_url"] is not None

    # 3. Remove photo
    res_remove = await client.patch(
        "/users/me/profile",
        data={"remove_photo": "true"},
        headers=auth_headers
    )
    assert res_remove.status_code == 200
    assert res_remove.json()["profile_picture_url"] is None

    # Unauthorized
    res_unauth = await client.patch("/users/me/profile", data={"bio": "nope"})
    assert res_unauth.status_code == 401
