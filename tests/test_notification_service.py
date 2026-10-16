import uuid
import pytest
from datetime import datetime, timezone
from sqlalchemy import select
from backend.models.db import User, post, Comment, Like, SavedPost, CommentLike, Notification
from backend.services.notification_service import (
    get_user_unread_count,
    format_notification_dict,
    notify_post_like,
    remove_post_like_notification,
    notify_comment_like,
    remove_comment_like_notification,
    notify_post_comment,
    remove_comment_notifications,
    notify_post_save,
    remove_post_save_notification
)

@pytest.mark.asyncio
async def test_get_user_unread_count(db_session, test_user):
    # Initially 0
    count = await get_user_unread_count(db_session, test_user.id)
    assert count == 0

    # Add unread notifications
    n1 = Notification(
        recipient_id=test_user.id,
        actor_id=test_user.id,
        type="post_like",
        is_read=False
    )
    n2 = Notification(
        recipient_id=test_user.id,
        actor_id=test_user.id,
        type="comment",
        is_read=False
    )
    n3 = Notification(
        recipient_id=test_user.id,
        actor_id=test_user.id,
        type="post_save",
        is_read=True  # read
    )
    db_session.add_all([n1, n2, n3])
    await db_session.commit()

    count = await get_user_unread_count(db_session, test_user.id)
    assert count == 2

@pytest.mark.asyncio
async def test_notify_post_like_create_and_group_update(db_session, test_user, test_user_2, sample_post):
    # Self-action is suppressed
    await notify_post_like(db_session, sample_post.id, test_user.id)
    notifs = (await db_session.execute(select(Notification))).scalars().all()
    assert len(notifs) == 0

    # Non-existent post is ignored
    fake_post_id = uuid.uuid4()
    await notify_post_like(db_session, fake_post_id, test_user_2.id)
    notifs = (await db_session.execute(select(Notification))).scalars().all()
    assert len(notifs) == 0

    # First like creates new notification
    await notify_post_like(db_session, sample_post.id, test_user_2.id)
    notif = (await db_session.execute(select(Notification))).scalar_one()
    assert notif.recipient_id == test_user.id
    assert notif.actor_id == test_user_2.id
    assert notif.type == "post_like"
    assert notif.is_read is False

    # Mark as read
    notif.is_read = True
    await db_session.commit()

    # Create a 3rd user to test group update of existing notification
    user_3 = User(
        id=uuid.uuid4(),
        email="user3@example.com",
        name="User 3",
        hashed_password="pw",
        is_active=True,
        is_superuser=False,
        is_verified=True
    )
    db_session.add(user_3)
    await db_session.commit()

    # User 3 likes -> updates existing notification
    await notify_post_like(db_session, sample_post.id, user_3.id)
    all_notifs = (await db_session.execute(select(Notification))).scalars().all()
    assert len(all_notifs) == 1
    updated_notif = all_notifs[0]
    assert updated_notif.actor_id == user_3.id
    assert updated_notif.is_read is False

@pytest.mark.asyncio
async def test_remove_post_like_notification_multi_and_single(db_session, test_user, test_user_2, sample_post):
    # Edge case: non-existent post or self-unlike does nothing
    await remove_post_like_notification(db_session, uuid.uuid4(), test_user_2.id)
    await remove_post_like_notification(db_session, sample_post.id, test_user.id)

    # Edge case: no existing notification in database does nothing
    await remove_post_like_notification(db_session, sample_post.id, test_user_2.id)

    # Setup: 2 users like sample_post
    user_3 = User(
        id=uuid.uuid4(),
        email="user3@example.com",
        name="User 3",
        hashed_password="pw",
        is_active=True,
        is_superuser=False,
        is_verified=True
    )
    db_session.add(user_3)

    like_2 = Like(user_id=test_user_2.id, post_id=sample_post.id, created_at=datetime.now(timezone.utc))
    like_3 = Like(user_id=user_3.id, post_id=sample_post.id, created_at=datetime.now(timezone.utc))
    db_session.add_all([like_2, like_3])
    await db_session.commit()

    # Notify likes
    await notify_post_like(db_session, sample_post.id, test_user_2.id)
    await notify_post_like(db_session, sample_post.id, user_3.id)

    # User 3 unlikes: remove like_3 from DB then call remove_post_like_notification
    await db_session.delete(like_3)
    await db_session.commit()

    await remove_post_like_notification(db_session, sample_post.id, user_3.id)
    # Remaining like from test_user_2 keeps notification updated
    notif = (await db_session.execute(select(Notification))).scalar_one_or_none()
    assert notif is not None
    assert notif.actor_id == test_user_2.id

    # User 2 unlikes: remove like_2 from DB then call remove_post_like_notification
    await db_session.delete(like_2)
    await db_session.commit()

    await remove_post_like_notification(db_session, sample_post.id, test_user_2.id)
    # No likes remain -> notification is completely deleted
    deleted_notif = (await db_session.execute(select(Notification))).scalar_one_or_none()
    assert deleted_notif is None

@pytest.mark.asyncio
async def test_notify_comment_like_and_remove(db_session, test_user, test_user_2, sample_post):
    # Create a comment on sample_post by test_user
    comm = Comment(
        id=uuid.uuid4(),
        text="A nice comment",
        user_id=test_user.id,
        post_id=sample_post.id
    )
    db_session.add(comm)
    await db_session.commit()

    # Self comment-like is suppressed
    await notify_comment_like(db_session, comm.id, test_user.id)
    notifs = (await db_session.execute(select(Notification))).scalars().all()
    assert len(notifs) == 0

    # Non-existent comment is ignored
    await notify_comment_like(db_session, uuid.uuid4(), test_user_2.id)

    # User 2 likes comment -> creates notification
    c_like_2 = CommentLike(user_id=test_user_2.id, comment_id=comm.id, created_at=datetime.now(timezone.utc))
    db_session.add(c_like_2)
    await db_session.commit()

    await notify_comment_like(db_session, comm.id, test_user_2.id)
    notif = (await db_session.execute(select(Notification))).scalar_one()
    assert notif.type == "comment_like"
    assert notif.actor_id == test_user_2.id
    assert notif.recipient_id == test_user.id

    # User 3 also likes comment -> updates existing notification
    user_3 = User(
        id=uuid.uuid4(),
        email="user3@example.com",
        name="User 3",
        hashed_password="pw",
        is_active=True,
        is_superuser=False,
        is_verified=True
    )
    db_session.add(user_3)
    c_like_3 = CommentLike(user_id=user_3.id, comment_id=comm.id, created_at=datetime.now(timezone.utc))
    db_session.add(c_like_3)
    await db_session.commit()

    await notify_comment_like(db_session, comm.id, user_3.id)
    notifs = (await db_session.execute(select(Notification))).scalars().all()
    assert len(notifs) == 1
    assert notifs[0].actor_id == user_3.id

    # Remove comment like: edge case of non-existent comment or self unlike does nothing
    await remove_comment_like_notification(db_session, uuid.uuid4(), user_3.id)
    await remove_comment_like_notification(db_session, comm.id, test_user.id)

    # User 3 unlikes -> updates notification to User 2
    await db_session.delete(c_like_3)
    await db_session.commit()
    await remove_comment_like_notification(db_session, comm.id, user_3.id)

    notif = (await db_session.execute(select(Notification))).scalar_one()
    assert notif.actor_id == test_user_2.id

    # User 2 unlikes -> deletes notification completely
    await db_session.delete(c_like_2)
    await db_session.commit()
    await remove_comment_like_notification(db_session, comm.id, test_user_2.id)

    assert (await db_session.execute(select(Notification))).scalar_one_or_none() is None

    # Edge case: calling remove when no notification exists does nothing
    await remove_comment_like_notification(db_session, comm.id, test_user_2.id)

@pytest.mark.asyncio
async def test_notify_post_save_and_remove(db_session, test_user, test_user_2, sample_post):
    # Self save is suppressed
    await notify_post_save(db_session, sample_post.id, test_user.id)
    assert len((await db_session.execute(select(Notification))).scalars().all()) == 0

    # Non-existent post is ignored
    await notify_post_save(db_session, uuid.uuid4(), test_user_2.id)

    # User 2 saves post -> creates notification
    s2 = SavedPost(user_id=test_user_2.id, post_id=sample_post.id, created_at=datetime.now(timezone.utc))
    db_session.add(s2)
    await db_session.commit()

    await notify_post_save(db_session, sample_post.id, test_user_2.id)
    notif = (await db_session.execute(select(Notification))).scalar_one()
    assert notif.type == "post_save"
    assert notif.actor_id == test_user_2.id

    # User 3 saves post -> updates existing notification
    user_3 = User(
        id=uuid.uuid4(),
        email="user3@example.com",
        name="User 3",
        hashed_password="pw",
        is_active=True,
        is_superuser=False,
        is_verified=True
    )
    db_session.add(user_3)
    s3 = SavedPost(user_id=user_3.id, post_id=sample_post.id, created_at=datetime.now(timezone.utc))
    db_session.add(s3)
    await db_session.commit()

    await notify_post_save(db_session, sample_post.id, user_3.id)
    notifs = (await db_session.execute(select(Notification))).scalars().all()
    assert len(notifs) == 1
    assert notifs[0].actor_id == user_3.id

    # Remove post save: edge cases
    await remove_post_save_notification(db_session, uuid.uuid4(), user_3.id)
    await remove_post_save_notification(db_session, sample_post.id, test_user.id)

    # User 3 unsaves -> updates notification to User 2
    await db_session.delete(s3)
    await db_session.commit()
    await remove_post_save_notification(db_session, sample_post.id, user_3.id)

    notif = (await db_session.execute(select(Notification))).scalar_one()
    assert notif.actor_id == test_user_2.id

    # User 2 unsaves -> deletes notification completely
    await db_session.delete(s2)
    await db_session.commit()
    await remove_post_save_notification(db_session, sample_post.id, test_user_2.id)

    assert (await db_session.execute(select(Notification))).scalar_one_or_none() is None

    # Edge case: calling remove when notification doesn't exist
    await remove_post_save_notification(db_session, sample_post.id, test_user_2.id)

@pytest.mark.asyncio
async def test_notify_post_comment_and_remove_comment(db_session, test_user, test_user_2, sample_post):
    # Self-comment is suppressed
    self_comm = Comment(
        id=uuid.uuid4(),
        text="My own comment",
        user_id=test_user.id,
        post_id=sample_post.id
    )
    db_session.add(self_comm)
    await db_session.commit()
    await notify_post_comment(db_session, self_comm)
    assert len((await db_session.execute(select(Notification))).scalars().all()) == 0

    # User 2 comments -> creates notification
    user2_comm = Comment(
        id=uuid.uuid4(),
        text="Great shot!",
        user_id=test_user_2.id,
        post_id=sample_post.id
    )
    db_session.add(user2_comm)
    await db_session.commit()

    await notify_post_comment(db_session, user2_comm)
    notif = (await db_session.execute(select(Notification))).scalar_one()
    assert notif.type == "comment"
    assert notif.extra_data == {"text": "Great shot!"}

    # Also add a comment_like notification for user2_comm
    comm_like_notif = Notification(
        recipient_id=test_user_2.id,
        actor_id=test_user.id,
        type="comment_like",
        post_id=sample_post.id,
        comment_id=user2_comm.id,
        is_read=False
    )
    db_session.add(comm_like_notif)
    await db_session.commit()

    # Now delete comment: remove_comment_notifications should clean up both
    await remove_comment_notifications(db_session, user2_comm.id)
    remaining = (await db_session.execute(
        select(Notification).where(Notification.comment_id == user2_comm.id)
    )).scalars().all()
    assert len(remaining) == 0

@pytest.mark.asyncio
async def test_format_notification_dict_all_branches_and_fallbacks(db_session, test_user, test_user_2, sample_post):
    # 1. Fallback when actor is None and post is None
    n_orphan = Notification(
        id=uuid.uuid4(),
        recipient_id=test_user.id,
        actor_id=None,
        type="post_like",
        post_id=None,
        is_read=False,
        created_at=None,
        updated_at=None
    )
    payload_orphan = await format_notification_dict(db_session, n_orphan)
    assert payload_orphan["actor"]["name"] == "User"
    assert payload_orphan["actor"]["profile_picture_url"] is None
    assert payload_orphan["post_url"] is None
    assert payload_orphan["post_file_type"] is None
    assert payload_orphan["actors_count"] == 1
    assert payload_orphan["created_at"] is not None
    assert payload_orphan["updated_at"] is not None

    # 2. Comment notification with fallback to comment.text when extra_data has no text
    c = Comment(
        id=uuid.uuid4(),
        text="Fallback comment text from relationship",
        user_id=test_user_2.id,
        post_id=sample_post.id
    )
    db_session.add(c)
    await db_session.commit()

    n_comm = Notification(
        id=uuid.uuid4(),
        recipient_id=test_user.id,
        actor_id=test_user_2.id,
        type="comment",
        post_id=sample_post.id,
        comment_id=c.id,
        extra_data=None,  # No extra data
        is_read=False
    )
    n_comm.actor = test_user_2
    n_comm.post = sample_post
    n_comm.comment = c

    payload_comm = await format_notification_dict(db_session, n_comm)
    assert payload_comm["comment_text"] == "Fallback comment text from relationship"
    assert payload_comm["actor"]["name"] == "Other User"
    assert payload_comm["post_url"] == sample_post.url

    # 3. Actors count for post_like with multiple likers
    user_3 = User(
        id=uuid.uuid4(),
        email="user3@example.com",
        name="User 3",
        hashed_password="pw",
        is_active=True,
        is_superuser=False,
        is_verified=True
    )
    db_session.add(user_3)
    l1 = Like(user_id=test_user_2.id, post_id=sample_post.id)
    l2 = Like(user_id=user_3.id, post_id=sample_post.id)
    db_session.add_all([l1, l2])
    await db_session.commit()

    n_like = Notification(
        id=uuid.uuid4(),
        recipient_id=test_user.id,
        actor_id=user_3.id,
        type="post_like",
        post_id=sample_post.id,
        is_read=False
    )
    n_like.actor = user_3
    n_like.post = sample_post
    payload_like = await format_notification_dict(db_session, n_like)
    assert payload_like["actors_count"] == 2

    # 4. Actors count for comment_like with multiple likers
    cl1 = CommentLike(user_id=test_user_2.id, comment_id=c.id)
    cl2 = CommentLike(user_id=user_3.id, comment_id=c.id)
    db_session.add_all([cl1, cl2])
    await db_session.commit()

    n_clike = Notification(
        id=uuid.uuid4(),
        recipient_id=test_user.id,
        actor_id=user_3.id,
        type="comment_like",
        post_id=sample_post.id,
        comment_id=c.id,
        is_read=False
    )
    n_clike.actor = user_3
    n_clike.comment = c
    payload_clike = await format_notification_dict(db_session, n_clike)
    assert payload_clike["actors_count"] == 2

    # 5. Actors count for post_save with multiple savers
    s1 = SavedPost(user_id=test_user_2.id, post_id=sample_post.id)
    s2 = SavedPost(user_id=user_3.id, post_id=sample_post.id)
    db_session.add_all([s1, s2])
    await db_session.commit()

    n_save = Notification(
        id=uuid.uuid4(),
        recipient_id=test_user.id,
        actor_id=user_3.id,
        type="post_save",
        post_id=sample_post.id,
        is_read=False
    )
    n_save.actor = user_3
    n_save.post = sample_post
    payload_save = await format_notification_dict(db_session, n_save)
    assert payload_save["actors_count"] == 2
