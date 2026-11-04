from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from ct2_nllb_server.app import ServerSettings, create_app


class FakeEngine:
    model_id = "facebook/nllb-200-distilled-600M"
    device = "cpu"
    compute_type = "int8"

    def __init__(self) -> None:
        self.count_calls: list[tuple[str, str]] = []
        self.translate_calls: list[tuple[str, str, str]] = []
        self.token_counts: dict[str, int] = {}
        self.translate_started = threading.Event()
        self.translate_release = threading.Event()
        self.fail_translate = False
        self.closed = False

    def count_tokens(self, text: str, source_lang: str) -> int:
        self.count_calls.append((source_lang, text))
        if text in self.token_counts:
            return self.token_counts[text]
        return len(text.split()) + 2

    def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        self.translate_calls.append((source_lang, target_lang, text))
        self.translate_started.set()
        if self.fail_translate:
            raise RuntimeError("native failure")
        if not self.translate_release.is_set():
            self.translate_release.wait(timeout=2)
        return f"{target_lang}:{text}"

    def close(self) -> None:
        self.closed = True


def make_client(
    engine: FakeEngine | None = None,
    deadline_seconds: float = 30.0,
) -> tuple[TestClient, FakeEngine]:
    fake = engine or FakeEngine()
    app = create_app(
        engine_factory=lambda: fake,
        settings=ServerSettings(
            model_dir=Path("unused"),
            deadline_seconds=deadline_seconds,
        ),
    )
    return TestClient(app), fake


def request_body(**overrides: Any) -> dict[str, Any]:
    body = {
        "model": FakeEngine.model_id,
        "text": "Hello world",
        "source_lang": "eng_Latn",
        "target_lang": "tur_Latn",
    }
    body.update(overrides)
    return body


def test_health_has_exact_shape_and_reports_only_folder_basename() -> None:
    client, _engine = make_client()
    with client:
        response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["model"] == FakeEngine.model_id
    assert payload["device"] == "cpu"
    assert payload["compute_type"] == "int8"
    assert payload["max_input_tokens"] == 512
    assert payload["model_dir"] == "unused"


def test_health_reports_folder_basename_not_absolute_path(tmp_path: Path) -> None:
    engine = FakeEngine()
    model_dir = tmp_path / "private-user" / "My NLLB Model"
    engine.model_dir = model_dir
    client, _engine = make_client(engine)
    with client:
        response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["model_dir"] == "My NLLB Model"
    assert str(tmp_path) not in str(payload["model_dir"])


def test_health_is_not_ready_before_model_load() -> None:
    client, _engine = make_client()
    response = client.get("/health")
    assert response.status_code == 503
    assert response.json() == {"detail": "Model not loaded"}


def test_translate_returns_translated_text() -> None:
    client, engine = make_client()
    engine.translate_release.set()
    with client:
        response = client.post("/translate", json=request_body())
    assert response.status_code == 200
    assert response.json() == {"translatedText": "tur_Latn:Hello world"}
    assert engine.translate_calls == [
        ("eng_Latn", "tur_Latn", "Hello world")
    ]


def test_health_reports_family_and_language_pairs() -> None:
    engine = FakeEngine()
    engine.family = "marian"
    engine.adapter = SimpleNamespace(
        language_pairs=lambda: [["eng_Latn", "tur_Latn"]]
    )
    client, _engine = make_client(engine)
    with client:
        response = client.get("/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["family"] == "marian"
    assert payload["language_pairs"] == [["eng_Latn", "tur_Latn"]]


def test_unsupported_pair_is_422_with_supported_pairs() -> None:
    engine = FakeEngine()
    engine.adapter = SimpleNamespace(
        supports=lambda source, target: (source, target)
        == ("eng_Latn", "tur_Latn"),
        language_pairs=lambda: [["eng_Latn", "tur_Latn"]],
    )
    client, _engine = make_client(engine)
    with client:
        response = client.post(
            "/translate",
            json=request_body(source_lang="tur_Latn", target_lang="eng_Latn"),
        )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert "eng_Latn -> tur_Latn" in detail
    assert engine.translate_calls == []


def test_model_mismatch_is_404_and_never_runs_inference() -> None:
    client, engine = make_client()
    with client:
        response = client.post(
            "/translate",
            json=request_body(model="facebook/other-model"),
        )
    assert response.status_code == 404
    assert "does not match the loaded model" in response.json()["detail"]
    assert engine.translate_calls == []


def test_blank_text_is_422() -> None:
    client, engine = make_client()
    with client:
        response = client.post("/translate", json=request_body(text="   "))
    assert response.status_code == 422
    assert response.json()["detail"] == "Text must not be blank."
    assert engine.count_calls == []


def test_unknown_language_is_422_without_fallback() -> None:
    client, engine = make_client()
    with client:
        response = client.post(
            "/translate",
            json=request_body(source_lang="xx_YY"),
        )
    assert response.status_code == 422
    assert "Unsupported source language code" in response.json()["detail"]
    assert engine.count_calls == []


def test_token_limit_includes_special_tokens_and_does_not_truncate() -> None:
    client, engine = make_client()
    engine.token_counts["too long"] = 513
    with client:
        response = client.post("/translate", json=request_body(text="too long"))
    assert response.status_code == 422
    assert "513 tokens" in response.json()["detail"]
    assert "limit is 512" in response.json()["detail"]
    assert engine.translate_calls == []


def test_same_language_returns_input_without_native_inference() -> None:
    client, engine = make_client()
    with client:
        response = client.post(
            "/translate",
            json=request_body(source_lang="eng_Latn", target_lang="eng_Latn"),
        )
    assert response.status_code == 200
    assert response.json() == {"translatedText": "Hello world"}
    assert engine.translate_calls == []


def test_requires_json_content_type() -> None:
    client, _engine = make_client()
    with client:
        response = client.post(
            "/translate",
            content='{"text":"hello"}',
            headers={"content-type": "text/plain"},
        )
    assert response.status_code == 422
    assert response.json() == {
        "detail": "Content-Type must be application/json"
    }


def test_inference_failure_is_500() -> None:
    client, engine = make_client()
    engine.fail_translate = True
    engine.translate_release.set()
    with client:
        response = client.post("/translate", json=request_body())
    assert response.status_code == 500
    assert response.json() == {"detail": "Inference failed."}


def test_overall_deadline_returns_504() -> None:
    client, engine = make_client(deadline_seconds=0.15)
    started = time.monotonic()
    with client:
        response = client.post("/translate", json=request_body())
        elapsed = time.monotonic() - started
    assert response.status_code == 504
    assert "deadline" in response.json()["detail"].lower()
    assert elapsed < 2
    engine.translate_release.set()
    # Give the executor callback a moment to release the serialization lock.
    time.sleep(0.05)


def test_cors_allows_chrome_extension_origin() -> None:
    client, _engine = make_client()
    origin = "chrome-extension://abcdefghijklmnop"
    with client:
        response = client.options(
            "/translate",
            headers={
                "origin": origin,
                "access-control-request-method": "POST",
                "access-control-request-headers": "content-type",
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_cors_rejects_non_extension_origin() -> None:
    client, _engine = make_client()
    with client:
        response = client.options(
            "/translate",
            headers={
                "origin": "https://example.com",
                "access-control-request-method": "POST",
                "access-control-request-headers": "content-type",
            },
        )
    assert "access-control-allow-origin" not in response.headers


def test_different_source_languages_are_serialized() -> None:
    """A second request cannot mutate tokenizer.src_lang mid-inference."""
    engine = FakeEngine()
    engine.translate_release.set()
    client, _engine = make_client(engine)
    barrier = threading.Event()
    started_sources: list[str] = []
    original_translate = engine.translate

    def blocking_translate(text: str, source: str, target: str) -> str:
        started_sources.append(source)
        if not barrier.is_set():
            engine.translate_started.set()
            barrier.wait(timeout=2)
        return original_translate(text, source, target)

    engine.translate = blocking_translate  # type: ignore[method-assign]

    with client:
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(
                client.post,
                "/translate",
                json=request_body(
                    source_lang="eng_Latn",
                    target_lang="tur_Latn",
                    text="first",
                ),
            )
            assert engine.translate_started.wait(timeout=2)
            second = pool.submit(
                client.post,
                "/translate",
                json=request_body(
                    source_lang="tur_Latn",
                    target_lang="eng_Latn",
                    text="second",
                ),
            )
            time.sleep(0.1)
            assert started_sources == ["eng_Latn"]
            barrier.set()
            responses = [first.result(timeout=5), second.result(timeout=5)]

    assert [response.status_code for response in responses] == [200, 200]
    assert [call[0] for call in engine.count_calls] == [
        "eng_Latn",
        "tur_Latn",
    ]
    assert [call[0] for call in engine.translate_calls] == [
        "eng_Latn",
        "tur_Latn",
    ]


def test_language_table_is_the_first_release_set() -> None:
    from ct2_nllb_server.languages import SUPPORTED_LANGUAGES

    assert len(SUPPORTED_LANGUAGES) == 14
    assert SUPPORTED_LANGUAGES["eng_Latn"] == "English"
    assert SUPPORTED_LANGUAGES["tur_Latn"] == "Turkish"
    assert SUPPORTED_LANGUAGES["zho_Hans"] == "Chinese"
