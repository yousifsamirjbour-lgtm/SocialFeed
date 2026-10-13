import io
import uuid
import pytest
from unittest.mock import patch
from backend.models.db import post, Follow

@pytest.mark.asyncio
async def test_upload_image_success(client, auth_headers):
    mock_cloudinary_result = {
        "secure_url": "https://res.cloudinary.com/test/image/upload/v12345/test.jpg",
        "public_id": "test_public_id"
    }

    with patch("backend.api.posts.uploader.upload", return_value=mock_cloudinary_result):
        file_content = b"fake image content bytes"
        files = {"file": ("test.png", io.BytesIO(file_content), "image/png")}
        data = {"caption": "Hello test image"}

        res = await client.post("/upload", files=files, data=data, headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["message"] == "Upload successful"
        assert "post_id" in res.json()

@pytest.mark.asyncio
async def test_upload_video_success(client, auth_headers):
    mock_cloudinary_result = {
        "secure_url": "https://res.cloudinary.com/test/video/upload/v12345/test.mp4",
        "public_id": "test_video_id"
    }

    with patch("backend.api.posts.uploader.upload", return_value=mock_cloudinary_result):
        file_content = b"fake video content bytes"
        files = {"file": ("test.mp4", io.BytesIO(file_content), "video/mp4")}
        data = {"caption": "Hello test video"}

        res = await client.post("/upload", files=files, data=data, headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["message"] == "Upload successful"

@pytest.mark.asyncio
async def test_upload_empty_file_fails(client, auth_headers):
    files = {"file": ("empty.jpg", io.BytesIO(b""), "image/jpeg")}
    res = await client.post("/upload", files=files, headers=auth_headers)
    assert res.status_code == 400
    assert "0 bytes" in res.json()["detail"]

@pytest.mark.asyncio
async def test_upload_unsupported_mimetype_fails(client, auth_headers):
    files = {"file": ("bad.txt", io.BytesIO(b"some text"), "text/plain")}
    res = await client.post("/upload", files=files, headers=auth_headers)
    assert res.status_code == 415
    assert "Unsupported file type" in res.json()["detail"]

@pytest.mark.asyncio
async def test_upload_file_too_large(client, auth_headers, monkeypatch):
    # Temporarily set MAX_BYTES low to test 413
    monkeypatch.setattr("backend.api.posts.MAX_BYTES", 10)
    files = {"file": ("big.jpg", io.BytesIO(b"longer than 10 bytes content"), "image/jpeg")}
    res = await client.post("/upload", files=files, headers=auth_headers)
    assert res.status_code == 413
    assert "File too large" in res.json()["detail"]

@pytest.mark.asyncio
async def test_upload_unauthorized(client):
    files = {"file": ("test.jpg", io.BytesIO(b"bytes"), "image/jpeg")}
    res = await client.post("/upload", files=files)
    assert res.status_code == 401

@pytest.mark.asyncio
async def test_toggle_like(client, sample_post, auth_headers):
    # Like
    res = await client.post(f"/posts/{sample_post.id}/like", headers=auth_headers)
    assert res.status_code == 200
    assert res.json() == {"message": "Post liked", "liked": True}

    # Unlike
    res_unlike = await client.post(f"/posts/{sample_post.id}/like", headers=auth_headers)
    assert res_unlike.status_code == 200
    assert res_unlike.json() == {"message": "Post unliked", "liked": False}

    # Post not found
    res_404 = await client.post(f"/posts/{uuid.uuid4()}/like", headers=auth_headers)
    assert res_404.status_code == 404

    # Unauthorized
    assert (await client.post(f"/posts/{sample_post.id}/like")).status_code == 401

@pytest.mark.asyncio
async def test_toggle_save(client, sample_post, auth_headers):
    # Save
    res = await client.post(f"/posts/{sample_post.id}/save", headers=auth_headers)
    assert res.status_code == 200
    assert res.json() == {"message": "Post saved", "is_saved": True}

    # Unsave
    res_unsave = await client.post(f"/posts/{sample_post.id}/save", headers=auth_headers)
    assert res_unsave.status_code == 200
    assert res_unsave.json() == {"message": "Post unsaved", "is_saved": False}

    # Post not found
    res_404 = await client.post(f"/posts/{uuid.uuid4()}/save", headers=auth_headers)
    assert res_404.status_code == 404

    # Unauthorized
    assert (await client.post(f"/posts/{sample_post.id}/save")).status_code == 401

@pytest.mark.asyncio
async def test_get_feed(client, db_session, test_user, test_user_2, sample_post, auth_headers):
    # Global feed
    res = await client.get("/feed?limit=10&offset=0", headers=auth_headers)
    assert res.status_code == 200
    feed = res.json()
    assert len(feed) >= 1
    assert feed[0]["id"] == str(sample_post.id)
    assert feed[0]["owner"]["name"] == test_user.name
    assert "email" not in feed[0]["owner"]

    # Following-only feed when not following anyone
    res_following_empty = await client.get("/feed?following_only=true", headers=auth_headers)
    assert res_following_empty.status_code == 200
    assert res_following_empty.json() == []

    # Now create follow relation and a post by test_user_2
    follow = Follow(follower_id=test_user.id, followed_id=test_user_2.id)
    post2 = post(
        id=uuid.uuid4(),
        caption="Post by followed user",
        url="https://res.cloudinary.com/test/image/upload/p2.jpg",
        file_type="image/jpeg",
        file_name="p2",
        user_id=test_user_2.id
    )
    db_session.add_all([follow, post2])
    await db_session.commit()

    res_following = await client.get("/feed?following_only=true", headers=auth_headers)
    assert res_following.status_code == 200
    following_feed = res_following.json()
    assert len(following_feed) == 1
    assert following_feed[0]["id"] == str(post2.id)

    # Unauthorized
    assert (await client.get("/feed")).status_code == 401

@pytest.mark.asyncio
async def test_delete_post_permissions(client, sample_post, auth_headers, auth_headers_2):
    # Forbidden: other user cannot delete post
    res_forbidden = await client.delete(f"/posts/{sample_post.id}", headers=auth_headers_2)
    assert res_forbidden.status_code == 403
    assert "Forbidden" in res_forbidden.json()["detail"]

    # Success: owner deletes post
    res_delete = await client.delete(f"/posts/{sample_post.id}", headers=auth_headers)
    assert res_delete.status_code == 200
    assert res_delete.json() == {"message": "Post successfully deleted."}

    # Not found on subsequent delete
    res_404 = await client.delete(f"/posts/{sample_post.id}", headers=auth_headers)
    assert res_404.status_code == 404

    # Unauthorized
    assert (await client.delete(f"/posts/{sample_post.id}")).status_code == 401
