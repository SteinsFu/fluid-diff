"""Simple background job queue."""

import heapq
import itertools
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

DEFAULT_MAX_RETRIES = 3
DEFAULT_BACKOFF_SECONDS = 0.5
QUEUE_LIMIT = 1000
POLL_INTERVAL = 0.2


class JobStatus:
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


@dataclass(order=True)
class Job:
    priority: int
    seq: int
    name: str = field(compare=False)
    func: Callable[..., Any] = field(compare=False)
    args: tuple = field(default=(), compare=False)
    kwargs: dict = field(default_factory=dict, compare=False)
    retries: int = field(default=DEFAULT_MAX_RETRIES, compare=False)
    attempts: int = field(default=0, compare=False)
    status: str = field(default=JobStatus.PENDING, compare=False)
    result: Any = field(default=None, compare=False)
    error: Optional[str] = field(default=None, compare=False)

    def describe(self) -> str:
        return f"{self.name} ({self.status})"

    def reset(self) -> None:
        self.attempts = 0
        self.status = JobStatus.PENDING
        self.result = None
        self.error = None


class JobQueue:
    def __init__(self):
        self._heap: List[Job] = []
        self._counter = itertools.count()
        self._jobs: Dict[str, Job] = {}

    def submit(self, name: str, func: Callable[..., Any], *args,
               priority: int = 10, **kwargs) -> Job:
        if len(self._heap) >= QUEUE_LIMIT:
            raise RuntimeError("queue is full")
        if name in self._jobs:
            raise ValueError(f"Job '{name}' already submitted")

        job = Job(priority, next(self._counter), name, func, args, kwargs)
        heapq.heappush(self._heap, job)
        self._jobs[name] = job
        logger.info("Submitted %s", name)
        return job

    def cancel(self, name: str) -> bool:
        job = self._jobs.get(name)
        if job is None or job not in self._heap:
            return False
        self._heap.remove(job)
        heapq.heapify(self._heap)
        job.status = JobStatus.FAILED
        job.error = "cancelled"
        return True

    def _run_once(self, job: Job) -> bool:
        job.status = JobStatus.RUNNING
        job.attempts += 1
        try:
            job.result = job.func(*job.args, **job.kwargs)
        except Exception as exc:
            job.error = str(exc)
            logger.warning("Job %s failed: %s", job.name, job.error)
            return False
        job.status = JobStatus.DONE
        return True

    def run_next(self) -> Optional[Job]:
        if not self._heap:
            return None
        job = heapq.heappop(self._heap)
        while not self._run_once(job):
            if job.attempts > job.retries:
                job.status = JobStatus.FAILED
                break
            time.sleep(DEFAULT_BACKOFF_SECONDS)
        return job

    def run_all(self) -> List[Job]:
        finished = []
        while self._heap:
            finished.append(self.run_next())
        return finished

    def pending(self) -> int:
        return len(self._heap)

    def summary(self) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for job in self._jobs.values():
            counts[job.status] = counts.get(job.status, 0) + 1
        return counts

    def purge(self) -> int:
        removed = 0
        for name, job in list(self._jobs.items()):
            if job.status in (JobStatus.DONE, JobStatus.FAILED):
                del self._jobs[name]
                removed += 1
        logger.info("Purged %d jobs", removed)
        return removed


# ---- demo tasks ----

def send_email(address: str) -> str:
    if "@" not in address:
        raise ValueError("invalid address")
    return f"sent to {address}"


def resize_image(path: str, size: int) -> str:
    return f"{path} -> {size}px"


def compress_logs(folder: str) -> str:
    return f"compressed {folder}"


_calls = {"sync": 0}

def flaky_sync() -> str:
    _calls["sync"] += 1
    if _calls["sync"] < 3:
        raise ConnectionError("timeout")
    return "synced"


def main():
    logging.basicConfig(level=logging.INFO)

    queue = JobQueue()
    queue.submit("welcome", send_email, "alice@example.com", priority=1)
    queue.submit("thumb", resize_image, "cat.png", 128)
    queue.submit("logs", compress_logs, "/var/log/app")
    queue.submit("sync", flaky_sync, priority=5)
    queue.submit("bad-email", send_email, "nobody")

    for job in queue.run_all():
        print(job.describe())

    print("Summary:", queue.summary())


if __name__ == "__main__":
    main()
