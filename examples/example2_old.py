"""Lightweight background job queue with retries and priorities."""

import heapq
import itertools
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

DEFAULT_MAX_RETRIES = 3
DEFAULT_BACKOFF_SECONDS = 0.5


class JobStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass(order=True)
class Job:
    priority: int
    seq: int
    name: str = field(compare=False)
    func: Callable[..., Any] = field(compare=False)
    args: tuple = field(default=(), compare=False)
    kwargs: dict = field(default_factory=dict, compare=False)
    max_retries: int = field(default=DEFAULT_MAX_RETRIES, compare=False)
    attempts: int = field(default=0, compare=False)
    status: JobStatus = field(default=JobStatus.PENDING, compare=False)
    result: Any = field(default=None, compare=False)
    error: Optional[str] = field(default=None, compare=False)


class JobQueue:
    def __init__(self, backoff_seconds: float = DEFAULT_BACKOFF_SECONDS):
        self._heap: List[Job] = []
        self._counter = itertools.count()
        self._history: Dict[str, Job] = {}
        self.backoff_seconds = backoff_seconds

    def submit(self, name: str, func: Callable[..., Any], *args,
               priority: int = 10, max_retries: int = DEFAULT_MAX_RETRIES,
               **kwargs) -> Job:
        if name in self._history:
            raise ValueError(f"Job '{name}' already submitted")

        job = Job(priority, next(self._counter), name, func, args, kwargs, max_retries)
        heapq.heappush(self._heap, job)
        self._history[name] = job
        logger.info("Submitted job %s (priority=%d)", name, priority)
        return job

    def __len__(self) -> int:
        return len(self._heap)

    def _run_once(self, job: Job) -> bool:
        job.status = JobStatus.RUNNING
        job.attempts += 1
        try:
            job.result = job.func(*job.args, **job.kwargs)
        except Exception as exc:
            job.error = f"{type(exc).__name__}: {exc}"
            logger.warning("Job %s failed (attempt %d): %s", job.name, job.attempts, job.error)
            return False

        job.status = JobStatus.SUCCEEDED
        job.error = None
        return True

    def run_next(self) -> Optional[Job]:
        if not self._heap:
            return None

        job = heapq.heappop(self._heap)
        while not self._run_once(job):
            if job.attempts > job.max_retries:
                job.status = JobStatus.FAILED
                logger.error("Job %s gave up after %d attempts", job.name, job.attempts)
                break
            time.sleep(self.backoff_seconds * job.attempts)

        return job

    def run_all(self) -> List[Job]:
        finished = []
        while self._heap:
            finished.append(self.run_next())
        return finished

    def get(self, name: str) -> Optional[Job]:
        return self._history.get(name)

    def summary(self) -> Dict[str, int]:
        counts = {status.value: 0 for status in JobStatus}
        for job in self._history.values():
            counts[job.status.value] += 1
        return counts


# ---- demo tasks ----

def send_welcome_email(user_email: str) -> str:
    if "@" not in user_email:
        raise ValueError("invalid email")
    return f"email sent to {user_email}"


def resize_image(path: str, width: int, height: int) -> str:
    return f"{path} resized to {width}x{height}"


_flaky_calls = {"count": 0}

def flaky_sync() -> str:
    _flaky_calls["count"] += 1
    if _flaky_calls["count"] < 3:
        raise ConnectionError("upstream timeout")
    return "sync complete"


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    queue = JobQueue(backoff_seconds=0.1)
    queue.submit("welcome", send_welcome_email, "alice@example.com", priority=1)
    queue.submit("thumbnail", resize_image, "cat.png", 128, 128)
    queue.submit("sync", flaky_sync, priority=5)
    queue.submit("bad-email", send_welcome_email, "not-an-email", max_retries=1)

    for job in queue.run_all():
        print(f"{job.name:<10} {job.status.value:<10} {job.result or job.error}")

    print("Summary:", queue.summary())


if __name__ == "__main__":
    main()
