"""Pure decisions only. No PM2 RPC, filesystem mutation or HTTP client.

A future adapter must recapture/validate evidence under journal serialization
immediately before any mutation. An old decision object is not an authority.
"""
from dataclasses import dataclass
import math


@dataclass(frozen=True)
class App:
    app_id: int
    config: str
    pid: int
    start: int
    status: str


def recovery(before, now, intent, *, continuous_lease, same_daemon, same_release, original_absent):
    if not continuous_lease: return 'HOLD_EXCLUSION_GAP'
    if not same_daemon or not same_release: return 'HOLD_GLOBAL_IDENTITY_CHANGED'
    if (before.app_id, before.config) != (now.app_id, now.config): return 'HOLD_APP_IDENTITY_CHANGED'
    if before.status != 'online': return 'NO_ACTION_BASELINE_NOT_ONLINE'
    if now.status == 'online':
        if (now.pid, now.start) == (before.pid, before.start): return 'NO_ACTION_ORIGINAL_RUNNING'
        if intent == 'START_PENDING': return 'OBSERVE_START_OUTCOME'
        return 'HOLD_UNEXPECTED_INSTANCE'
    if intent == 'START_PENDING': return 'HOLD_START_OUTCOME_UNCERTAIN'
    if (intent in ('STOP_PENDING', 'STOP_CONFIRMED') and now.status == 'stopped'
            and now.pid == 0 and original_absent): return 'ELIGIBLE_RETAINED_START_NOT_EXECUTED'
    return 'HOLD_STOP_PROVENANCE_UNCERTAIN'


@dataclass(frozen=True)
class Health:
    pid: int
    start: int
    restarts: int
    pm_uptime: int  # PM2 launch timestamp, constant through an observation.
    uptime_ms: int  # Independently computed current age, must advance.
    status: str = 'online'

    def signature(self):
        return (self.pid, self.start, self.restarts, self.pm_uptime)

    def valid(self):
        return (self.status == 'online' and all(type(n) is int for n in
                (self.pid, self.start, self.restarts, self.pm_uptime, self.uptime_ms))
                and self.pid > 0 and self.start > 0 and self.restarts >= 0
                and self.pm_uptime > 0 and self.uptime_ms >= 0)


class Stability:
    """Sampled operational equivalence, not API functionality or message delivery.

All times are local monotonic samples. Missing/late/changed samples fail this
observation attempt permanently; starting a new attempt is a caller decision.
"""
    def __init__(self, expected_http, baseline_api, baseline_wa, *, window=75, max_gap=5):
        if expected_http not in ((401, 'Unauthorized'), (503, 'API REST deshabilitada')):
            raise ValueError('NO_SOURCE_GROUNDED_HTTP_BASELINE')
        if (not math.isfinite(window) or not math.isfinite(max_gap)
                or window < 75 or max_gap <= 0 or max_gap > 5):
            raise ValueError('WEAK_OBSERVATION_WINDOW')
        self.http = expected_http
        if not baseline_api.valid() or not baseline_wa.valid():
            raise ValueError('INVALID_PROCESS_BASELINE')
        self.expected = (baseline_api.signature(), baseline_wa.signature())
        self.previous = (baseline_api, baseline_wa)
        self.initial = None
        self.window, self.max_gap = window, max_gap
        self.first = self.last = None
        self.failed = False

    def sample(self, at, api, wa, http, *, api_listener_owned, wa_connection_confirmed):
        # PID/start/restart counter/launch timestamp must remain fixed; age advances.
        bad = (self.failed or not math.isfinite(at) or at < 0 or not api.valid() or not wa.valid()
               or (api.signature(), wa.signature()) != self.expected or http != self.http
               or not api_listener_owned or not wa_connection_confirmed
               or (self.last is not None and (at <= self.last or at - self.last > self.max_gap)))
        if self.last is not None:
            elapsed_ms = (at - self.last) * 1000
            for current, prior in zip((api, wa), self.previous):
                if current.uptime_ms <= prior.uptime_ms:
                    bad = True
                if abs((current.uptime_ms - prior.uptime_ms) - elapsed_ms) > 1000:
                    bad = True
            total_ms = (at - self.first) * 1000
            for current, initial in zip((api, wa), self.initial):
                # One bounded measurement allowance for the whole attempt,
                # never a fresh allowance at every sample.
                if abs((current.uptime_ms - initial.uptime_ms) - total_ms) > 1000:
                    bad = True
        if bad:
            self.failed = True
            return 'HOLD_OBSERVATION_FAILED'
        if self.first is None:
            self.first = at
            self.initial = (api, wa)
        self.last = at
        self.previous = (api, wa)
        if at - self.first >= self.window and min(api.uptime_ms, wa.uptime_ms) < self.window * 1000:
            self.failed = True
            return 'HOLD_UPTIME_SHORTER_THAN_WINDOW'
        return 'OPERATIONAL_EQUIVALENCE_SAMPLED' if at - self.first >= self.window else 'OBSERVING'
