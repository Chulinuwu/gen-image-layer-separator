from __future__ import annotations

from app.utils.ai_logger import extract_output_block


def test_extractor_returns_content_after_output_marker():
    resp = "## THINK\n- point 1\n- point 2\n\n## OUTPUT\nthe final answer here"
    assert extract_output_block(resp) == "the final answer here"


def test_extractor_graceful_when_no_marker():
    resp = "just a paragraph without any headers"
    assert extract_output_block(resp) == "just a paragraph without any headers"


def test_extractor_strips_think_only_response():
    resp = "## THINK\n- only reasoning\n- no output marker\n\nthe answer follows after blank line"
    out = extract_output_block(resp)
    assert "the answer follows" in out
    assert "only reasoning" not in out


def test_extractor_handles_colon_or_newline_after_marker():
    resp1 = "## THINK\nx\n\n## OUTPUT:\nanswer"
    resp2 = "## THINK\nx\n\n## OUTPUT\n\nanswer"
    assert extract_output_block(resp1) == "answer"
    assert extract_output_block(resp2) == "answer"
