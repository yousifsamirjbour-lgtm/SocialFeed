import uuid
import pytest
from unittest.mock import MagicMock
from backend.models.db import Conversation, DirectMessage, Notification
from backend.services.conversation_service import (
    get_canonical_user_ids,
    get_or_create_conversation,
    get_user_conversations,
    get_conversation_by_id,
    delete_conversation,
    get_conversation_messages,
    send_message,
    mark_conversation_as_read
)

@pytest.mark.asyncio
async def test_canonical_user_ids():
    u1 = uuid.uuid4()
    u2 = uuid.uuid4()
    c1, c2 = get_canonical_user_ids(u1, u2)
    c3, c4 = get_canonical_user_ids(u2, u1)
    assert c1 == c3
    assert c2 == c4
    assert str(c1) < str(c2)

    with pytest.raises(Exception):
        get_canonical_user_ids(u1, u1)

@pytest.mark.asyncio
async def test_create_and_idempotent_conversation(client, test_user, test_user_2, auth_headers, auth_headers_2):
    # 1. User 1 creates conversation with User 2
    res = await client.post(
        "/api/conversations",
        json={"recipient_id": str(test_user_2.id)},
        headers=auth_headers
    )
    assert res.status_code == 200
    data = res.json()
    assert data["participant"]["id"] == str(test_user_2.id)
    assert data["participant"]["name"] == test_user_2.name
    conv_id = data["id"]

    # 2. User 2 gets/creates conversation with User 1 -> returns same conversation ID
    res2 = await client.post(
        "/api/conversations",
        json={"recipient_id": str(test_user.id)},
        headers=auth_headers_2
    )
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["id"] == conv_id
    assert data2["participant"]["id"] == str(test_user.id)

@pytest.mark.asyncio
async def test_create_conversation_edge_cases(client, test_user, auth_headers):
    # Self conversation error
    res_self = await client.post(
        "/api/conversations",
        json={"recipient_id": str(test_user.id)},
        headers=auth_headers
    )
    assert res_self.status_code == 400

    # Non-existent recipient
    res_nonexistent = await client.post(
        "/api/conversations",
        json={"recipient_id": str(uuid.uuid4())},
        headers=auth_headers
    )
    assert res_nonexistent.status_code == 404

@pytest.mark.asyncio
async def test_list_conversations(client, test_user, test_user_2, auth_headers):
    # Create conversation
    await client.post(
        "/api/conversations",
        json={"recipient_id": str(test_user_2.id)},
        headers=auth_headers
    )

    # List conversations for User 1
    res = await client.get("/api/conversations", headers=auth_headers)
    assert res.status_code == 200
    convs = res.json()
    assert len(convs) >= 1
    assert any(c["participant"]["id"] == str(test_user_2.id) for c in convs)

@pytest.mark.asyncio
async def test_send_and_retrieve_messages(client, test_user, test_user_2, auth_headers, auth_headers_2):
    # 1. Create conversation
    c_res = await client.post(
        "/api/conversations",
        json={"recipient_id": str(test_user_2.id)},
        headers=auth_headers
    )
    conv_id = c_res.json()["id"]

    # 2. Send text message
    m_res = await client.post(
        f"/api/conversations/{conv_id}/messages",
        data={"text": "Hello User 2! How are you?"},
        headers=auth_headers
    )
    assert m_res.status_code == 200
    msg = m_res.json()
    assert msg["text"] == "Hello User 2! How are you?"
    assert msg["sender_id"] == str(test_user.id)
    assert msg["is_read"] is False

    # 3. Retrieve messages
    h_res = await client.get(
        f"/api/conversations/{conv_id}/messages",
        headers=auth_headers_2
    )
    assert h_res.status_code == 200
    history = h_res.json()
    assert len(history["messages"]) == 1
    assert history["messages"][0]["text"] == "Hello User 2! How are you?"

    # 4. Check unread count for User 2 in list
    l_res = await client.get("/api/conversations", headers=auth_headers_2)
    assert l_res.status_code == 200
    target_conv = next(c for c in l_res.json() if c["id"] == conv_id)
    assert target_conv["unread_count"] == 1
    assert target_conv["last_message_text"] == "Hello User 2! How are you?"

@pytest.mark.asyncio
async def test_send_empty_message_fails(client, test_user, test_user_2, auth_headers):
    c_res = await client.post(
        "/api/conversations",
        json={"recipient_id": str(test_user_2.id)},
        headers=auth_headers
    )
    conv_id = c_res.json()["id"]

    res = await client.post(
        f"/api/conversations/{conv_id}/messages",
        data={"text": "   "},
        headers=auth_headers
    )
    assert res.status_code == 400

@pytest.mark.asyncio
async def test_send_attachment(client, test_user, test_user_2, auth_headers, monkeypatch):
    c_res = await client.post(
        "/api/conversations",
        json={"recipient_id": str(test_user_2.id)},
        headers=auth_headers
    )
    conv_id = c_res.json()["id"]

    # Mock Cloudinary uploader.upload
    mock_upload = MagicMock(return_value={
        "secure_url": "https://res.cloudinary.com/test-cloud/image/upload/sample_doc.pdf",
        "public_id": "sample_doc_id"
    })
    from backend.core import images
    monkeypatch.setattr(images.uploader, "upload", mock_upload)

    file_content = b"%PDF-1.4 test dummy pdf content"
    files = {"file": ("test_doc.pdf", file_content, "application/pdf")}
    res = await client.post(
        f"/api/conversations/{conv_id}/messages",
        data={"text": "Here is the project spec"},
        files=files,
        headers=auth_headers
    )
    assert res.status_code == 200
    data = res.json()
    assert data["attachment_url"] == "https://res.cloudinary.com/test-cloud/image/upload/sample_doc.pdf"
    assert data["attachment_name"] == "test_doc.pdf"
    assert data["attachment_type"] == "application/pdf"
    assert data["text"] == "Here is the project spec"

@pytest.mark.asyncio
async def test_mark_conversation_read(client, test_user, test_user_2, auth_headers, auth_headers_2):
    # 1. Create conversation and send message from User 1 to User 2
    c_res = await client.post(
        "/api/conversations",
        json={"recipient_id": str(test_user_2.id)},
        headers=auth_headers
    )
    conv_id = c_res.json()["id"]

    await client.post(
        f"/api/conversations/{conv_id}/messages",
        data={"text": "Unread message"},
        headers=auth_headers
    )

    # 2. User 2 marks as read
    r_res = await client.patch(
        f"/api/conversations/{conv_id}/read",
        headers=auth_headers_2
    )
    assert r_res.status_code == 200
    assert r_res.json()["marked_read"] >= 1

    # 3. Check unread count is now 0
    l_res = await client.get("/api/conversations", headers=auth_headers_2)
    target = next(c for c in l_res.json() if c["id"] == conv_id)
    assert target["unread_count"] == 0

@pytest.mark.asyncio
async def test_conversation_access_control_and_delete(client, test_user, test_user_2, auth_headers, auth_headers_2, db_session):
    # Create third user
    user_3 = test_user_2  # test_user_2 is participant; create user 3
    from backend.models.db import User
    u3 = User(
        id=uuid.uuid4(),
        email="user3@example.com",
        name="User Three",
        hashed_password="pw",
        is_active=True
    )
    db_session.add(u3)
    await db_session.commit()
    from backend.core.users import get_jwt_strategy
    token3 = await (get_jwt_strategy()).write_token(u3)
    auth3 = {"Authorization": f"Bearer {token3}"}

    # 1. User 1 and User 2 conversation
    c_res = await client.post(
        "/api/conversations",
        json={"recipient_id": str(test_user_2.id)},
        headers=auth_headers
    )
    conv_id = c_res.json()["id"]

    # 2. User 3 tries to get messages -> 403 Forbidden
    g_res = await client.get(f"/api/conversations/{conv_id}/messages", headers=auth3)
    assert g_res.status_code == 403

    # 3. User 3 tries to delete -> 403 Forbidden
    d_res = await client.delete(f"/api/conversations/{conv_id}", headers=auth3)
    assert d_res.status_code == 403

    # 4. User 1 deletes conversation -> 200 OK
    del_res = await client.delete(f"/api/conversations/{conv_id}", headers=auth_headers)
    assert del_res.status_code == 200

    # 5. Subsequent access returns 404
    check_res = await client.get(f"/api/conversations/{conv_id}", headers=auth_headers)
    assert check_res.status_code == 404

@pytest.mark.asyncio
async def test_chat_notification_integration(client, test_user, test_user_2, auth_headers, auth_headers_2):
    # 1. Create conversation and send message from User 1 to User 2
    c_res = await client.post(
        "/api/conversations",
        json={"recipient_id": str(test_user_2.id)},
        headers=auth_headers
    )
    conv_id = c_res.json()["id"]

    await client.post(
        f"/api/conversations/{conv_id}/messages",
        data={"text": "Check out this notification!"},
        headers=auth_headers
    )

    # 2. Check User 2 notifications
    n_res = await client.get("/api/notifications", headers=auth_headers_2)
    assert n_res.status_code == 200
    data = n_res.json()
    chat_notif = next((n for n in data["notifications"] if n["type"] == "chat_message"), None)
    assert chat_notif is not None
    assert chat_notif["actor"]["id"] == str(test_user.id)
    assert chat_notif["extra_data"]["conversation_id"] == conv_id
    assert chat_notif["extra_data"]["text"] == "Check out this notification!"
