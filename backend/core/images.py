import os
import cloudinary
import cloudinary.uploader
from dotenv import load_dotenv

current_dir = os.path.dirname(__file__)
env_path = os.path.join(os.path.dirname(current_dir), ".env")
load_dotenv(env_path)

cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
    secure=True
)

uploader = cloudinary.uploader