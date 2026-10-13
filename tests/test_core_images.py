import cloudinary
from backend.core.images import uploader

def test_cloudinary_uploader_configuration():
    assert uploader is not None
    config = cloudinary.config()
    assert config.cloud_name == "test-cloud"
    assert config.api_key == "123456789"
    assert config.api_secret == "test-secret"
