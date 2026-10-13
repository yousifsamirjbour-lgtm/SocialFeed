import uuid
import pytest
from backend.models.db import Comment

@pytest.mark.asyncio
async def test_create_comment(client, sample_post, auth_headers):
    payload = {"text": "A wonderful comment"}
    res = await client.post(f"/posts/{sample_post.id}/comments", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["text"] == "A wonderful comment"
    assert "id" in data
    assert data["author"]["id"] is not None
    assert data["author"]["name"] is not None
    assert "email" not in data["author"]

    # Post not found
    res_404 = await client.post(f"/posts/{uuid.uuid4()}/comments", json=payload, headers=auth_headers)
    assert res_404.status_code == 404

    # Validation error (missing text)
    res_422 = await client.post(f"/posts/{sample_post.id}/comments", json={}, headers=auth_headers)
    assert res_422.status_code == 422

    # Unauthorized
    assert (await client.post(f"/posts/{sample_post.id}/comments", json=payload)).status_code == 401

@pytest.mark.asyncio
async def test_get_comments(client, sample_post, sample_comment, auth_headers):
    res = await client.get(f"/posts/{sample_post.id}/comments", headers=auth_headers)
    assert res.status_code == 200
    comments = res.json()
    assert len(comments) >= 1
    assert comments[0]["id"] == str(sample_comment.id)
    assert "is_following" in comments[0]["author"]
    assert comments[0]["author"]["name"] is not None
    assert "email" not in comments[0]["author"]

    # Post not found
    res_404 = await client.get(f"/posts/{uuid.uuid4()}/comments", headers=auth_headers)
    assert res_404.status_code == 404

    # Unauthorized
    assert (await client.get(f"/posts/{sample_post.id}/comments")).status_code == 401

@pytest.mark.asyncio
async def test_delete_comment_author_permission(client, db_session, test_user_2, sample_post, auth_headers_2):
    # test_user_2 creates a comment on sample_post (which is owned by test_user)
    comment = Comment(
        id=uuid.uuid4(),
        text="Comment by user 2",
        user_id=test_user_2.id,
        post_id=sample_post.id
    )
    db_session.add(comment)
    await db_session.commit()

    # Comment author (test_user_2) deletes their comment -> 204
    res = await client.delete(f"/comments/{comment.id}", headers=auth_headers_2)
    assert res.status_code == 204

@pytest.mark.asyncio
async def test_delete_comment_post_owner_permission(client, db_session, test_user_2, sample_post, auth_headers):
    # test_user_2 creates a comment on sample_post (owned by test_user)
    comment = Comment(
        id=uuid.uuid4(),
        text="Another comment by user 2",
        user_id=test_user_2.id,
        post_id=sample_post.id
    )
    db_session.add(comment)
    await db_session.commit()

    # Post owner (test_user) can delete comments on their own post -> 204
    res = await client.delete(f"/comments/{comment.id}", headers=auth_headers)
    assert res.status_code == 204

@pytest.mark.asyncio
async def test_delete_comment_forbidden(client, db_session, test_user, test_user_2, sample_post, auth_headers_2):
    # Create a comment by test_user
    comment = Comment(
        id=uuid.uuid4(),
        text="Comment by user 1",
        user_id=test_user.id,
        post_id=sample_post.id
    )
    db_session.add(comment)
    await db_session.commit()

    # test_user_2 (neither comment author nor post owner) tries to delete -> 403
    res = await client.delete(f"/comments/{comment.id}", headers=auth_headers_2)
    assert res.status_code == 403
    assert "You must be the comment author or the post owner" in res.json()["detail"]

    # Not found
    assert (await client.delete(f"/comments/{uuid.uuid4()}", headers=auth_headers_2)).status_code == 404

    # Unauthorized
    assert (await client.delete(f"/comments/{comment.id}")).status_code == 401
