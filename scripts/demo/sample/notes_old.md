# Queue latency

Jobs leave the queue in **priority** order. The mean wait for a job of size $n$ is $n/(\mu-\lambda)$, while $\lambda < \mu$. A failed job waits a *fixed* `0.5` seconds. See the [runbook](https://example.com/queue).

> Keep the arrival rate under the service rate. A saturated queue never drains.

---

## Retries

A failed job waits `0.5` seconds, then tries again, up to 3 times.

- pending jobs stay in priority order
- a retry keeps its original priority

1. Mark the job `failed`.
2. Wait out the backoff.
3. Run it again, or drop it.

- [x] record the attempt
- [ ] page on the last failure

## Limits

| Name | Value | Meaning |
| --- | --- | --- |
| `QUEUE_LIMIT` | 1000 | jobs waiting |
| `POLL_INTERVAL` | `0.2` | seconds |
| `DEFAULT_MAX_RETRIES` | 3 | attempts |

![Jobs moving through the queue](queue.png)

Three stages, and a job only moves forward.

```python
def wait(n, lam, mu):
    return n / (mu - lam)
```

The mean wait is

$$
W(n) = \frac{n}{\mu - \lambda}
$$

## Variance

One more term falls out of the same model. With a fixed retry delay, the variance of the wait is

\[
\operatorname{Var}(W) = \frac{\lambda}{\mu^{2}(\mu - \lambda)}
\]
