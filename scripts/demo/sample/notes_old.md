# Queue latency

Jobs leave the queue in priority order. The mean wait for a job of size $n$ is

$$
W(n) = \frac{n}{\mu - \lambda}
$$

where $\lambda$ is the arrival rate and $\mu$ is the service rate. This holds while $\lambda < \mu$.

## Retries

A failed job waits `0.5` seconds, then tries again, up to 3 times.

- pending jobs stay in priority order
- a retry keeps its original priority
