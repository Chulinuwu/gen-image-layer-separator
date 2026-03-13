import os
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    port: int = 5001
    google_service_account_type: str = "service_account"
    google_service_account_project_id: str = ""
    google_service_account_private_key_id: str = ""
    google_service_account_private_key: str = ""
    google_service_account_client_email: str = ""
    google_service_account_client_id: str = ""
    google_cloud_location: str = "global"
    gemini_image_endpoint: str = "gemini-3.1-flash-image-preview"
    gemini_image_endpoint_2: str = "gemini-3-pro-image-preview"
    gemini_image_endpoint_3: str = "gemini-2.5-flash-image"
    gemini_text_endpoint: str = "gemini-2.5-pro"
    gemini_model_endpoint: str = "gemini-3-flash-preview"
    gemini_model_endpoint_2: str = ""
    imagen_edit_endpoint: str = "imagen-3.0-capability-001"
    gemini_diecut_endpoint: str = "gemini-3-pro-image-preview"
    gemini_embedding_endpoint: str = "gemini-embedding-001"

    # ML Models
    rmbg_model_name: str = "briaai/RMBG-2.0"
    hf_token: str = ""

    # Processing
    image_max_width: int = 1500
    image_quality: int = 90
    rmbg_model_size: int = 1024
    retry_count: int = 3
    retry_delay: float = 2.0
    refinement_max_iterations: int = 1

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
