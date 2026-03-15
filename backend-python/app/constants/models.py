from __future__ import annotations

from google.genai import types as genai_types

from app.config import get_settings as _get_app_settings

SAFETY_OFF = [
    genai_types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
    genai_types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
    genai_types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
    genai_types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
]


def get_text_model() -> str:
    s = _get_app_settings()
    return s.gemini_model_endpoint_2 or s.gemini_model_endpoint or "gemini-3-flash-preview"


def get_text_model_best() -> str:
    s = _get_app_settings()
    return s.gemini_text_endpoint or s.gemini_model_endpoint or "gemini-2.5-flash"
