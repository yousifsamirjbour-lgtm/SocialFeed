import uuid
import pytest
from sqlalchemy import select
from backend.models.db import Comment, CommentLike

@pytest.mark.asyncio
async def test_toggle_comment_like_success(client, sample_comment, auth_headers):
    # Like the comment
    res = await client.post(f"/comments/{sample_comment.id}/like", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["liked"] is True
    assert data["likes_count"] == 1
    assert data["message"] == "Comment liked"

    # Unlike the comment
    res2 = await client.post(f"/comments/{sample_comment.id}/like", headers=auth_headers)
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["liked"] is False
    assert data2["likes_count"] == 0
    assert data2["message"] == "Comment unliked"

@pytest.mark.asyncio
async def test_multiple_users_comment_likes_and_get_comments(client, sample_post, sample_comment, auth_headers, auth_headers_2):
    # User 1 likes comment
    res1 = await client.post(f"/comments/{sample_comment.id}/like", headers=auth_headers)
    assert res1.status_code == 200
    assert res1.json()["likes_count"] == 1

    # User 2 likes comment
    res2 = await client.post(f"/comments/{sample_comment.id}/like", headers=auth_headers_2)
    assert res2.status_code == 200
    assert res2.json()["likes_count"] == 2

    # User 1 views comments
    res_comments_1 = await client.get(f"/posts/{sample_post.id}/comments", headers=auth_headers)
    assert res_comments_1.status_code == 200
    c1 = next(c for c in res_comments_1.json() if c["id"] == str(sample_comment.id))
    assert c1["likes_count"] == 2
    assert c1["is_liked"] is True

    # User 2 views comments
    res_comments_2 = await client.get(f"/posts/{sample_post.id}/comments", headers=auth_headers_2)
    assert res_comments_2.status_code == 200
    c2 = next(c for c in res_comments_2.json() if c["id"] == str(sample_comment.id))
    assert c2["likes_count"] == 2
    assert c2["is_liked"] is True

    # User 1 unlikes comment
    await client.post(f"/comments/{sample_comment.id}/like", headers=auth_headers)

    # User 1 views comments again
    res_comments_1_after = await client.get(f"/posts/{sample_post.id}/comments", headers=auth_headers)
    c1_after = next(c for c in res_comments_1_after.json() if c["id"] == str(sample_comment.id))
    assert c1_after["likes_count"] == 1
    assert c1_after["is_liked"] is False

@pytest.mark.asyncio
async def test_comment_like_not_found(client, auth_headers):
    res = await client.post(f"/comments/{uuid.uuid4()}/like", headers=auth_headers)
    assert res.status_code == 404
    assert res.json()["detail"] == "Comment not found."

@pytest.mark.asyncio
async def test_comment_like_unauthorized(client, sample_comment):
    res = await client.post(f"/comments/{sample_comment.id}/like")
    assert res.status_code == 401

@pytest.mark.asyncio
async def test_delete_comment_cascades_comment_likes(client, db_session, sample_comment, auth_headers):
    # Like the comment first
    await client.post(f"/comments/{sample_comment.id}/like", headers=auth_headers)

    # Verify like exists in db
    like_q = select(CommentLike).where(CommentLike.comment_id == sample_comment.id)
    likes_before = (await db_session.execute(like_q)).scalars().all()
    assert len(likes_before) == 1

    # Delete comment
    del_res = await client.delete(f"/comments/{sample_comment.id}", headers=auth_headers)
    assert del_res.status_code == 204

    # Verify likes are gone from db
    likes_after = (await db_session.execute(like_q)).scalars().all()
    assert len(likes_after) == 0
