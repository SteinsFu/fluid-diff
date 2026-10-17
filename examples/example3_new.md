# Job Queue with Priorities

A small in-process job queue with retries. Jobs run on a fixed pool
of workers, and each worker pulls the highest-priority job as soon as it is free.
Failed jobs go back to the queue until they run out of attempts, then
they land in the dead-letter list for manual review.

## Features

- Fixed worker pool
- Priority levels
- Retries with backoff
- Dead-letter list

## Settings

| Name | Default | Meaning |
| --- | --- | --- |
| `workers` | 8 | Number of workers |
| `retries` | 3 | Attempts before dead-letter |
| `backoff` | 1s | Delay before the first retry |

![Icon](../images/icon.png)

## Usage

Create a queue, then push jobs onto it.

```python
q = JobQueue(workers=8)
q.push(send_email, priority=1)
```

Higher numbers run first.

## License

MIT
