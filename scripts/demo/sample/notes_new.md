# Queue latency

Jobs leave the queue in **priority** order. Failed jobs use ~~a fixed delay~~ exponential backoff.
The mean wait for a job of size $n$ is $n/(\mu-\lambda)$, while $\lambda < \mu$. See the [runbook](https://example.com/queue).

> Keep the arrival rate under the service rate. Backoff must not reorder the queue.

---

## Retries

A failed job waits $0.5 \cdot 2^{k}$ seconds on attempt $k$, then tries again until it succeeds or hits the retry limit.

- pending jobs stay in priority order
- a retry keeps its original priority
- backoff doubles after each failure

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
| `DEFAULT_MAX_RETRIES` | 5 | attempts |

![Jobs moving through the queue](queue.png)

Three stages, and a retry goes back to *wait*.

```python
def wait(n, lam, mu):
    return n / (mu - lam) + lam / (2 * mu * (mu - lam))
```

The mean wait is

$$
W(n) = \frac{n}{\mu - \lambda} + \frac{\lambda}{2\mu(\mu - \lambda)}
$$

## Variance

One more term falls out of the same model. With exponential backoff, the variance of the wait is

\[
\operatorname{Var}(W) = \frac{\lambda}{\mu^{2}(\mu - \lambda)} + \frac{1}{3\mu^{2}}
\]
