#!/usr/bin/env python3
"""Deterministic, loopback-only API for real iOS UI tests.

Run ``python3 scripts/ios-ui-fixture.py --port 8001``. Control endpoints only
change this process's memory; API writes are acknowledged locally and discarded.
No request is forwarded, and no request body, header, or token is logged.
"""

import argparse
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import signal
import threading
from urllib.parse import parse_qs, urlsplit


SCENARIOS = frozenset((
    "down", "up", "unknown", "empty-history", "history-error", "stats-error", "all-error",
))
SAFE_QUERY_KEYS = frozenset(("days", "minDurationSec", "limit"))
BRIDGE_PATH = "/api/bridges/brickell"
METADATA = {
    "roadway": "US-1", "location": "Brickell Avenue", "county": "Miami-Dade",
    "direction": "N", "waterway": "Miami River", "lat": 25.770124, "lon": -80.190208,
}


def iso_date(value):
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


class FixtureState:
    def __init__(self):
        self.lock = threading.Lock()
        self.scenario = "down"
        self.base_time = datetime.now(timezone.utc)
        self.requests = []

    def change(self, scenario, reset=False):
        with self.lock:
            self.scenario = scenario
            if reset:
                self.base_time = datetime.now(timezone.utc)
                self.requests.clear()

    def audit(self):
        with self.lock:
            return [
                {"method": entry["method"], "path": entry["path"],
                 "query": {key: list(values) for key, values in entry["query"].items()}}
                for entry in self.requests
            ]

    def record_and_snapshot(self, method, path, query):
        # Only known numeric API query parameters belong in the request audit.
        # Device/activity payloads and authorization data are never retained.
        with self.lock:
            self.requests.append({
                "method": method, "path": path,
                "query": {key: values for key, values in parse_qs(query).items() if key in SAFE_QUERY_KEYS},
            })
            return self.scenario, self.base_time


def status_for(scenario):
    return {"up": "UP", "unknown": "UNKNOWN"}.get(scenario, "DOWN")


def state_payload(scenario, base_time):
    return {
        "pk": "BRICKELL",
        "status": status_for(scenario),
        "statusChangedAt": iso_date(base_time - timedelta(seconds=600)),
        "lastPolledAt": iso_date(base_time),
        "metadata": dict(METADATA),
        "nearbyAlerts": [],
    }


def stats_payload(scenario, base_time):
    status = status_for(scenario)
    return {
        "windowDays": 7,
        "opens": 43 if status == "UP" else 42,
        "avgOpenDurationSec": 420,
        "longestOpenDurationSec": 900,
        "currentStatus": status,
        "currentStatusSinceSec": 600,
        "predictedNextOpenAt": iso_date(base_time + timedelta(seconds=1800)) if status == "DOWN" else None,
        "predictedNextCloseAt": iso_date(base_time + timedelta(seconds=300)) if status == "UP" else None,
    }


def history_payload(scenario, base_time):
    status = status_for(scenario)
    previous = "UP" if status == "DOWN" else "DOWN"
    earlier = "DOWN" if previous == "UP" else "UP"
    previous_duration = 420 if previous == "UP" else 1800
    changed_at = base_time - timedelta(seconds=600)
    return [
        {"ts": iso_date(changed_at), "from": previous, "to": status,
         "durationOfPrevStateSec": previous_duration},
        {"ts": iso_date(changed_at - timedelta(seconds=previous_duration)),
         "from": earlier, "to": previous,
         "durationOfPrevStateSec": 420 if earlier == "UP" else 1800},
    ]


class FixtureHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # The default logger includes the full query string; silence it so a
        # test's device token can never end up in CI output.
        pass

    def send_json(self, status, payload):
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        self.route()

    def do_POST(self):
        self.route()

    def do_DELETE(self):
        self.route()

    def route(self):
        target = urlsplit(self.path)
        path = target.path
        fixture = self.server.fixture
        if path.startswith("/api/"):
            scenario, base_time = fixture.record_and_snapshot(self.command, path, target.query)
            if self.command in ("POST", "DELETE"):
                self.send_json(200, {})
            elif path not in (BRIDGE_PATH, BRIDGE_PATH + "/stats", BRIDGE_PATH + "/history"):
                self.send_json(404, {"error": "Not found"})
            elif scenario == "all-error":
                self.send_json(503, {"error": "Fixture API unavailable"})
            elif path == BRIDGE_PATH:
                self.send_json(200, state_payload(scenario, base_time))
            elif path == BRIDGE_PATH + "/stats":
                if scenario == "stats-error":
                    self.send_json(500, {"error": "Fixture statistics unavailable"})
                else:
                    self.send_json(200, stats_payload(scenario, base_time))
            elif path == BRIDGE_PATH + "/history":
                if scenario == "history-error":
                    self.send_json(500, {"error": "Fixture history unavailable"})
                else:
                    events = [] if scenario == "empty-history" else history_payload(scenario, base_time)
                    self.send_json(200, {"events": events})
            else:
                self.send_json(404, {"error": "Not found"})
        elif self.command == "GET" and path == "/__control/health":
            self.send_json(200, {"ok": True})
        elif self.command == "GET" and path == "/__control/requests":
            self.send_json(200, {"requests": fixture.audit()})
        elif self.command == "POST" and path in ("/__control/reset", "/__control/scenario"):
            self.change_scenario(path == "/__control/reset")
        else:
            self.send_json(404, {"error": "Not found"})

    def change_scenario(self, reset):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 4096:
                raise ValueError("Invalid control body length")
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            scenario = body.get("scenario") if isinstance(body, dict) else None
            if not isinstance(scenario, str) or scenario not in SCENARIOS:
                raise ValueError("Invalid fixture scenario")
        except (ValueError, UnicodeDecodeError):
            self.send_json(400, {"error": "Expected a JSON object with a valid scenario"})
            return
        self.server.fixture.change(scenario, reset=reset)
        self.send_json(200, {"ok": True})


def create_server(host="127.0.0.1", port=0):
    """Build an unstarted server; callers own serve_forever/shutdown/close."""
    if host != "127.0.0.1":
        raise ValueError("The UI fixture may only bind to 127.0.0.1")
    server = ThreadingHTTPServer((host, port), FixtureHandler)
    server.fixture = FixtureState()
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    with create_server(port=args.port) as server:
        def stop(signum, frame):
            # shutdown must run outside serve_forever's thread to avoid a
            # deadlock when SIGTERM arrives on the main thread.
            threading.Thread(target=server.shutdown, daemon=True).start()
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        server.serve_forever(poll_interval=0.1)


if __name__ == "__main__":
    main()
