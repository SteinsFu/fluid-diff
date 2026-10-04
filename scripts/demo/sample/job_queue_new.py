"""In-process job queue.

Jobs run in priority order. Failed jobs are retried with
exponential backoff until they reach their retry limit.
"""

import heapq
import itertools
import logging
import threading
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
    CANCELLED = "cancelled"


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
    created_at: float = field(default_factory=time.time, compare=False)
    finished_at: Optional[float] = field(default=None, compare=False)

    def describe(self) -> str:
        return f"{self.name:<10} {self.status.value:<10} {self.result or self.error}"


class JobQueue:
    def __init__(self, backoff_seconds: float = DEFAULT_BACKOFF_SECONDS):
        self._heap: List[Job] = []
        self._counter = itertools.count()
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()
        self.backoff_seconds = backoff_seconds

    def submit(self, name: str, func: Callable[..., Any], *args,
               priority: int = 10, **kwargs) -> Job:
        if name in self._jobs:
            raise ValueError(f"Job '{name}' already submitted")

        job = Job(priority, next(self._counter), name, func, args, kwargs)
        with self._lock:
            heapq.heappush(self._heap, job)
            self._jobs[name] = job
        logger.info("Submitted job %s (priority=%d)", name, priority)
        return job

    def cancel(self, name: str) -> bool:
        job = self._jobs.get(name)
        if job is None or job not in self._heap:
            return False
        self._heap.remove(job)
        heapq.heapify(self._heap)
        job.status = JobStatus.CANCELLED
        return True

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
        with self._lock:
            if not self._heap:
                return None
            job = heapq.heappop(self._heap)

        for attempt in range(1, job.max_retries + 2):
            if self._run_once(job):
                break
            if attempt > job.max_retries:
                job.status = JobStatus.FAILED
                logger.error("Job %s exhausted %d retries", job.name, job.max_retries)
                break
            time.sleep(min(self.backoff_seconds * 2 ** (attempt - 1), 30.0))

        job.finished_at = time.time()
        return job

    def drain(self, timeout: float) -> List[Job]:
        deadline = time.monotonic() + timeout
        finished = []
        while self._heap and time.monotonic() < deadline:
            finished.append(self.run_next())
        if self._heap:
            logger.warning("%d jobs left after drain", len(self._heap))
        return finished

    def run_all(self) -> List[Job]:
        finished = []
        while self._heap:
            finished.append(self.run_next())
        return finished

    def summary(self) -> Dict[str, int]:
        counts = {status.value: 0 for status in JobStatus}
        for job in self._jobs.values():
            counts[job.status.value] += 1
        return counts


# ---- demo tasks ----

def send_email(address: str) -> str:
    if "@" not in address:
        raise ValueError("invalid address")
    return f"sent to {address}"


def resize_image(path: str, size: int) -> str:
    return f"{path} -> {size}px"


_calls = {"sync": 0}

def flaky_sync() -> str:
    _calls["sync"] += 1
    if _calls["sync"] < 3:
        raise ConnectionError("upstream timeout")
    return "synced"


def rotate_keys(service: str, keep: int = 2) -> str:
    return f"rotated keys for {service}, kept {keep}"


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    queue = JobQueue(backoff_seconds=0.1)
    queue.submit("welcome", send_email, "alice@example.com", priority=1)
    queue.submit("thumb", resize_image, "cat.png", 128)
    queue.submit("sync", flaky_sync, priority=5)
    queue.submit("bad-email", send_email, "nobody")
    queue.submit("keys", rotate_keys, "billing", keep=3)
    queue.cancel("keys")

    for job in queue.run_all():
        print(job.describe())

    print("Summary:", queue.summary())


if __name__ == "__main__":
    main()
