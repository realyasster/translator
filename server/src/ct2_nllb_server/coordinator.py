"""Inference coordination: one native inference at a time with a deadline."""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable

from .engine import InputTooLongError
from .languages import MAX_INPUT_TOKENS

logger = logging.getLogger(__name__)


class InferenceDeadlineExceeded(TimeoutError):
    """The request exhausted its overall deadline."""


class RequestExpiredError(InferenceDeadlineExceeded):
    """The client disconnected or the deadline elapsed before inference."""


@dataclass(frozen=True)
class TranslationOutcome:
    translated_text: str
    input_tokens: int
    same_language: bool


class InferenceCoordinator:
    """Serializes tokenizer mutation and native inference behind one lock.

    Native CTranslate2 inference cannot be cancelled once it has started. When
    a request times out, the lock is released only after the native future
    finishes, so a second request can never mutate ``tokenizer.src_lang`` while
    native inference is still running.
    """

    def __init__(
        self,
        engine: Any,
        deadline_seconds: float = 30.0,
        max_input_tokens: int = MAX_INPUT_TOKENS,
    ) -> None:
        if deadline_seconds <= 0:
            raise ValueError("deadline_seconds must be positive")
        self._engine = engine
        self._deadline_seconds = float(deadline_seconds)
        self._max_input_tokens = int(max_input_tokens)
        self._lock = asyncio.Lock()
        self._active_inference = False
        self._executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="ct2-nllb",
        )

    async def translate(
        self,
        request: Any,
        text: str,
        source_lang: str,
        target_lang: str,
    ) -> TranslationOutcome:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._deadline_seconds

        await self._ensure_active(request, deadline)

        try:
            await asyncio.wait_for(
                self._lock.acquire(),
                timeout=self._remaining(deadline),
            )
        except asyncio.TimeoutError as exc:
            raise InferenceDeadlineExceeded(
                "Timed out while waiting for the local translation worker."
            ) from exc

        release_pending = False
        try:
            await self._ensure_active(request, deadline)
            remaining = self._remaining(deadline)
            if remaining <= 0:
                raise InferenceDeadlineExceeded(
                    "The request deadline expired before inference started."
                )

            future = loop.run_in_executor(
                self._executor,
                self._run_worker,
                text,
                source_lang,
                target_lang,
            )
            self._active_inference = True
            future.add_done_callback(self._clear_active)
            try:
                return await asyncio.wait_for(
                    asyncio.shield(future),
                    timeout=remaining,
                )
            except asyncio.TimeoutError as exc:
                release_pending = True
                self._release_when_done(future)
                raise InferenceDeadlineExceeded(
                    "The translation exceeded the "
                    f"{self._deadline_seconds:g} second deadline. "
                    "Native inference may continue briefly."
                ) from exc
            except asyncio.CancelledError:
                release_pending = True
                self._release_when_done(future)
                raise
            except BaseException:
                if not future.done():
                    release_pending = True
                    self._release_when_done(future)
                raise
        finally:
            if not release_pending:
                self._lock.release()

    def _run_worker(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
    ) -> TranslationOutcome:
        token_count = self._engine.count_tokens(text, source_lang)
        if token_count > self._max_input_tokens:
            raise InputTooLongError(token_count, self._max_input_tokens)
        if source_lang == target_lang:
            return TranslationOutcome(
                translated_text=text,
                input_tokens=token_count,
                same_language=True,
            )
        translated = self._engine.translate(text, source_lang, target_lang)
        if not isinstance(translated, str) or not translated.strip():
            raise RuntimeError("The inference engine returned an empty translation.")
        return TranslationOutcome(
            translated_text=translated,
            input_tokens=token_count,
            same_language=False,
        )

    def _release_when_done(self, future: asyncio.Future[Any]) -> None:
        def release(done: asyncio.Future[Any]) -> None:
            # Retrieve a late exception so asyncio does not warn about it.
            if not done.cancelled():
                try:
                    done.exception()
                except Exception:
                    pass
            self._lock.release()

        future.add_done_callback(release)

    def _clear_active(self, _future: asyncio.Future[Any]) -> None:
        self._active_inference = False

    @property
    def has_active_inference(self) -> bool:
        return self._active_inference

    async def _ensure_active(self, request: Any, deadline: float) -> None:
        if self._remaining(deadline) <= 0:
            raise RequestExpiredError(
                "The request deadline expired before inference started."
            )
        is_disconnected: Callable[[], Any] = getattr(
            request, "is_disconnected", None
        )
        if is_disconnected is not None:
            try:
                if await is_disconnected():
                    raise RequestExpiredError(
                        "The client disconnected before inference started."
                    )
            except RequestExpiredError:
                raise
            except Exception:
                # A transport that cannot answer the disconnect check should
                # not turn a valid request into a server error.
                logger.debug("disconnect check failed", exc_info=True)

    @staticmethod
    def _remaining(deadline: float) -> float:
        return max(0.0, deadline - asyncio.get_running_loop().time())

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)
