# Queue latency

Jobs leave the queue in priority order. Failed jobs use exponential backoff.
The mean wait for a job of size $n$ is

$$
W(n) = \frac{n}{\mu - \lambda} + \frac{\lambda}{2\mu(\mu - \lambda)}
$$

where $\lambda$ is the arrival rate and $\mu$ is the service rate. This holds while $\lambda < \mu$.

## Retries

A failed job waits $0.5 \cdot 2^{k}$ seconds on attempt $k$, then tries again until
it succeeds or hits the retry limit.

- pending jobs stay in priority order
- a retry keeps its original priority
- backoff doubles after each failure

The variance of the wait is

\[
\operatorname{Var}(W) = \frac{\lambda}{\mu^{2}(\mu - \lambda)}
\]
