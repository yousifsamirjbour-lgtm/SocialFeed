import uuid
import pytest
from sqlalchemy import select
from backend.models.db import post, Comment, Like, Follow, SavedPost
from backend.core.services import fetch_decorated_posts

@pytest.mark.asyncio
async def test_fetch_decorated_posts_logic(db_session, test_user, test_user_2):
    # Post owned by test_user_2
    p = post(
        id=uuid.uuid4(),
        caption="Decorated test post",
        url="https://res.cloudinary.com/test/image/upload/dec.jpg",
        file_type="image/jpeg",
        file_name="dec_id",
        user_id=test_user_2.id
    )
    db_session.add(p)
    await db_session.commit()

    # Add 2 comments
    c1 = Comment(id=uuid.uuid4(), text="C1", user_id=test_user.id, post_id=p.id)
    c2 = Comment(id=uuid.uuid4(), text="C2", user_id=test_user_2.id, post_id=p.id)
    
    # Add 1 like by test_user
    l1 = Like(user_id=test_user.id, post_id=p.id)

    # Save by test_user
    s1 = SavedPost(user_id=test_user.id, post_id=p.id)

    # test_user follows test_user_2
    f1 = Follow(follower_id=test_user.id, followed_id=test_user_2.id)

    db_session.add_all([c1, c2, l1, s1, f1])
    await db_session.commit()

    # Query using fetch_decorated_posts for test_user
    base_query = select(post).where(post.id == p.id)
    decorated = await fetch_decorated_posts(db_session, test_user.id, base_query)

    assert len(decorated) == 1
    post_item = decorated[0]
    assert post_item.comment_count == 2
    assert post_item.like_count == 1
    assert post_item.is_liked is True
    assert post_item.is_saved is True
    assert post_item.owner.is_following is True

    # Query for test_user_2 (who did not like or save the post, and does not follow test_user_2)
    decorated_for_user_2 = await fetch_decorated_posts(db_session, test_user_2.id, base_query)
    assert len(decorated_for_user_2) == 1
    p2 = decorated_for_user_2[0]
    assert p2.comment_count == 2
    assert p2.like_count == 1
    assert p2.is_liked is False
    assert p2.is_saved is False
    assert p2.owner.is_following is False
