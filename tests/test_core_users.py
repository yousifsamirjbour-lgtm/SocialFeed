import uuid
import pytest
from unittest.mock import MagicMock, AsyncMock
from backend.models.db import User
from backend.core.users import UserManager, get_jwt_strategy, SECRET

@pytest.mark.asyncio
async def test_user_manager_lifecycle_hooks():
    mock_user_db = MagicMock()
    manager = UserManager(mock_user_db)
    user = User(id=uuid.uuid4(), email="hook_user@example.com")

    # Call on_after_register
    await manager.on_after_register(user)

    # Call on_after_forgot_password
    await manager.on_after_forgot_password(user, "test-token")

    # Call on_after_request_verify
    await manager.on_after_request_verify(user, "verify-token")

    assert manager.reset_password_token_secret == SECRET
    assert manager.verification_token_secret == SECRET

@pytest.mark.asyncio
async def test_jwt_strategy_token_flow(test_user):
    strategy = get_jwt_strategy()
    token = await strategy.write_token(test_user)
    assert token is not None
    assert isinstance(token, str)

    # Decode / read token back using user manager
    mock_user_db = MagicMock()
    mock_user_db.get = AsyncMock(return_value=test_user)
    manager = UserManager(mock_user_db)
    user_from_token = await strategy.read_token(token, manager)
    assert user_from_token is not None
    assert user_from_token.id == test_user.id
