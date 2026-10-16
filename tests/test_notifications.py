import uuid
import json
import pytest
from httpx import AsyncClient
from backend.models.db import post, Comment, Like, SavedPost, CommentLike, Notification

@pytest.mark.asyncio
async def test_post_comment_creates_notification(client, sample_post, test_user, test_user_2, auth_headers_2, auth_headers):
    # test_user_2 comments on test_user's post
    comment_res = await client.post(
        f"/posts/{sample_post.id}/comments",
        json={"text": "Awesome shot!"},
        headers=auth_headers_2
    )
    assert comment_res.status_code == 200

    # test_user (post owner) checks notifications
    notifs_res = await client.get("/notifications", headers=auth_headers)
    assert notifs_res.status_code == 200
    data = notifs_res.json()
    assert data["unread_count"] == 1
    assert len(data["notifications"]) == 1

    n = data["notifications"][0]
    assert n["type"] == "comment"
    assert n["actor"]["id"] == str(test_user_2.id)
    assert n["actor"]["name"] == test_user_2.name
    assert n["post_id"] == str(sample_post.id)
    assert n["comment_text"] == "Awesome shot!"
    assert n["is_read"] is False

@pytest.mark.asyncio
async def test_self_action_suppresses_notification(client, sample_post, auth_headers):
    # test_user comments on their own post
    await client.post(
        f"/posts/{sample_post.id}/comments",
        json={"text": "My own comment on my own post"},
        headers=auth_headers
    )
    # test_user likes their own post
    await client.post(f"/posts/{sample_post.id}/like", headers=auth_headers)
    # test_user saves their own post
    await client.post(f"/posts/{sample_post.id}/save", headers=auth_headers)

    # Notifications must be 0
    notifs_res = await client.get("/notifications", headers=auth_headers)
    assert notifs_res.status_code == 200
    assert notifs_res.json()["unread_count"] == 0
    assert len(notifs_res.json()["notifications"]) == 0

@pytest.mark.asyncio
async def test_post_like_groups_and_re_alerts_on_new_liker(client, sample_post, auth_headers, auth_headers_2):
    # test_user_2 likes test_user's post
    await client.post(f"/posts/{sample_post.id}/like", headers=auth_headers_2)

    notifs_res = await client.get("/notifications", headers=auth_headers)
    data = notifs_res.json()
    assert data["unread_count"] == 1
    n = data["notifications"][0]
    assert n["type"] == "post_like"
    assert n["actors_count"] == 1
    assert n["is_read"] is False

    # test_user marks notification as read
    read_res = await client.post(f"/notifications/{n['id']}/read", headers=auth_headers)
    assert read_res.status_code == 200
    assert read_res.json()["unread_count"] == 0

    # User unlikes the post -> notification is deleted
    await client.post(f"/posts/{sample_post.id}/like", headers=auth_headers_2)
    after_unlike = await client.get("/notifications", headers=auth_headers)
    assert len(after_unlike.json()["notifications"]) == 0
    assert after_unlike.json()["unread_count"] == 0

@pytest.mark.asyncio
async def test_comment_like_and_unlike_notification(client, sample_post, sample_comment, test_user, test_user_2, auth_headers, auth_headers_2):
    # sample_comment is authored by test_user. test_user_2 likes it.
    like_res = await client.post(f"/comments/{sample_comment.id}/like", headers=auth_headers_2)
    assert like_res.status_code == 200

    # test_user checks notifications
    notifs_res = await client.get("/notifications", headers=auth_headers)
    data = notifs_res.json()
    assert data["unread_count"] == 1
    n = data["notifications"][0]
    assert n["type"] == "comment_like"
    assert n["comment_id"] == str(sample_comment.id)
    assert n["actor"]["id"] == str(test_user_2.id)

    # test_user_2 unlikes comment -> notification is removed
    unlike_res = await client.post(f"/comments/{sample_comment.id}/like", headers=auth_headers_2)
    assert unlike_res.status_code == 200

    notifs_res_2 = await client.get("/notifications", headers=auth_headers)
    assert len(notifs_res_2.json()["notifications"]) == 0
    assert notifs_res_2.json()["unread_count"] == 0

@pytest.mark.asyncio
async def test_post_save_and_unsave_notification(client, sample_post, auth_headers, auth_headers_2):
    # test_user_2 saves test_user's post
    save_res = await client.post(f"/posts/{sample_post.id}/save", headers=auth_headers_2)
    assert save_res.status_code == 200

    notifs_res = await client.get("/notifications", headers=auth_headers)
    data = notifs_res.json()
    assert data["unread_count"] == 1
    n = data["notifications"][0]
    assert n["type"] == "post_save"
    assert n["post_id"] == str(sample_post.id)

    # test_user_2 unsaves post -> notification is removed
    unsave_res = await client.post(f"/posts/{sample_post.id}/save", headers=auth_headers_2)
    assert unsave_res.status_code == 200

    notifs_res_2 = await client.get("/notifications", headers=auth_headers)
    assert len(notifs_res_2.json()["notifications"]) == 0

@pytest.mark.asyncio
async def test_delete_comment_removes_notifications(client, sample_post, auth_headers, auth_headers_2):
    # test_user_2 comments on sample_post
    c_res = await client.post(
        f"/posts/{sample_post.id}/comments",
        json={"text": "Temporary comment"},
        headers=auth_headers_2
    )
    comment_id = c_res.json()["id"]

    # Verify notification created for test_user
    notifs = (await client.get("/notifications", headers=auth_headers)).json()
    assert notifs["unread_count"] == 1

    # test_user_2 deletes their comment
    del_res = await client.delete(f"/comments/{comment_id}", headers=auth_headers_2)
    assert del_res.status_code == 204

    # Verify notification is removed
    notifs_after = (await client.get("/notifications", headers=auth_headers)).json()
    assert notifs_after["unread_count"] == 0
    assert len(notifs_after["notifications"]) == 0

@pytest.mark.asyncio
async def test_mark_all_read(client, sample_post, auth_headers, auth_headers_2):
    # Create two notifications
    await client.post(f"/posts/{sample_post.id}/comments", json={"text": "Comment 1"}, headers=auth_headers_2)
    await client.post(f"/posts/{sample_post.id}/save", headers=auth_headers_2)

    notifs = (await client.get("/notifications", headers=auth_headers)).json()
    assert notifs["unread_count"] == 2

    # Mark all read
    read_all_res = await client.post("/notifications/read-all", headers=auth_headers)
    assert read_all_res.status_code == 200
    assert read_all_res.json()["unread_count"] == 0

    unread_res = await client.get("/notifications/unread-count", headers=auth_headers)
    assert unread_res.json()["unread_count"] == 0

@pytest.mark.asyncio
async def test_stream_ticket_and_auth_security(client, auth_headers):
    # 1. Generate single-use ticket
    ticket_res = await client.post("/notifications/ticket", headers=auth_headers)
    assert ticket_res.status_code == 200
    ticket = ticket_res.json()["ticket"]
    assert len(ticket) >= 32

    # 2. Consume ticket via stream
    async with client.stream("GET", f"/notifications/stream?ticket={ticket}") as res:
        assert res.status_code == 200
        assert "text/event-stream" in res.headers["content-type"]
        assert res.headers.get("x-accel-buffering") == "no"
        async for line in res.aiter_lines():
            if "status" in line or "connected" in line:
                break

    # 3. Ticket is single-use: consuming again must return 401
    reuse_res = await client.get(f"/notifications/stream?ticket={ticket}")
    assert reuse_res.status_code == 401

@pytest.mark.asyncio
async def test_stream_with_bearer_authorization_header(client, auth_headers):
    # Fetch-based SSE reader with Authorization header
    async with client.stream("GET", "/notifications/stream", headers=auth_headers) as res:
        assert res.status_code == 200
        assert "text/event-stream" in res.headers["content-type"]
        assert res.headers.get("x-accel-buffering") == "no"
        async for line in res.aiter_lines():
            if "status" in line or "connected" in line:
                break
