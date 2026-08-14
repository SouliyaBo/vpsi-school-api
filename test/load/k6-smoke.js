/**
 * Load profile for the read paths that carry the real traffic.
 *
 * Run with k6 (https://k6.io):
 *
 *   k6 run test/load/k6-smoke.js
 *   BASE_URL=https://staging.example.com ADMIN_PASSWORD=… k6 run test/load/k6-smoke.js
 *
 * Deliberately read-only. Writes would need a reset between runs, and the
 * endpoints worth load-testing are the ones a whole school hits at once —
 * students checking results, teachers opening a grade-entry grid, guardians
 * reading announcements.
 *
 * The thresholds below are the pass criteria: k6 exits non-zero if any is
 * breached, so this can gate a deploy rather than just produce a report.
 */
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API = `${BASE_URL}/api`;
const ADMIN_USERNAME = __ENV.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'ChangeMe123';

const loginFailures = new Rate('login_failures');
const listLatency = new Trend('list_endpoint_latency', true);

export const options = {
  scenarios: {
    // A school's morning peak: everyone arrives within a few minutes.
    morning_peak: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 50 },
        { duration: '2m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '20s',
    },
  },
  thresholds: {
    // A p95 above 500 ms on a list endpoint usually means a missing index.
    'http_req_duration{kind:list}': ['p(95)<500'],
    // Authentication is deliberately slow (argon2), so it gets its own budget.
    'http_req_duration{kind:auth}': ['p(95)<1500'],
    http_req_failed: ['rate<0.01'],
    login_failures: ['rate<0.01'],
  },
};

/**
 * Logs in once per VU and reuses the token.
 *
 * Re-authenticating per iteration would measure argon2 rather than the
 * endpoints under test, and would drown the results in hashing time.
 */
export function setup() {
  const response = http.post(
    `${API}/auth/login`,
    JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { kind: 'auth' } },
  );

  if (response.status !== 200) {
    throw new Error(
      `Setup login failed (${response.status}). Seed the database and check ADMIN_PASSWORD. ` +
        `Body: ${response.body}`,
    );
  }

  const body = response.json();
  if (body.user.mustChangePassword) {
    throw new Error(
      'The admin account still requires a password change, so every request will 403. ' +
        'Change it first, then set ADMIN_PASSWORD.',
    );
  }

  return { token: body.tokens.accessToken };
}

export default function loadTest(data) {
  const params = {
    headers: { Authorization: `Bearer ${data.token}` },
    tags: { kind: 'list' },
  };

  group('master data (cached, should be fastest)', () => {
    const tree = http.get(`${API}/locations/tree`, params);
    check(tree, { 'locations tree 200': (r) => r.status === 200 });
    listLatency.add(tree.timings.duration);

    const subjects = http.get(`${API}/subjects?limit=50`, params);
    check(subjects, { 'subjects 200': (r) => r.status === 200 });
  });

  group('people search (text index)', () => {
    const students = http.get(`${API}/students?limit=20`, params);
    check(students, {
      'students 200': (r) => r.status === 200,
      'students paginated': (r) => r.json().meta !== undefined,
    });
    listLatency.add(students.timings.duration);

    // Lao-language search — the path most likely to miss an index.
    const search = http.get(`${API}/students?search=${encodeURIComponent('ນາງ')}&limit=20`, params);
    check(search, { 'student search 200': (r) => r.status === 200 });
    listLatency.add(search.timings.duration);
  });

  group('academic reads', () => {
    const classrooms = http.get(`${API}/classrooms?limit=20`, params);
    check(classrooms, { 'classrooms 200': (r) => r.status === 200 });

    const enrollments = http.get(`${API}/enrollments?limit=20`, params);
    check(enrollments, { 'enrollments 200': (r) => r.status === 200 });
    listLatency.add(enrollments.timings.duration);
  });

  group('communication feed', () => {
    const announcements = http.get(`${API}/announcements?limit=10`, params);
    check(announcements, { 'announcements 200': (r) => r.status === 200 });

    const notifications = http.get(`${API}/notifications/unread-count`, params);
    check(notifications, { 'unread count 200': (r) => r.status === 200 });
  });

  group('health (unauthenticated, must never be throttled)', () => {
    const health = http.get(`${BASE_URL}/health`, { tags: { kind: 'health' } });
    check(health, { 'health 200': (r) => r.status === 200 });
  });

  // Think time — without it this measures how fast k6 can loop, not how the
  // API behaves under realistic use.
  sleep(Math.random() * 2 + 1);
}

export function handleSummary(summary) {
  return {
    stdout: JSON.stringify(
      {
        requests: summary.metrics.http_reqs?.values?.count,
        failed_rate: summary.metrics.http_req_failed?.values?.rate,
        p95_ms: summary.metrics.http_req_duration?.values?.['p(95)'],
        p99_ms: summary.metrics.http_req_duration?.values?.['p(99)'],
      },
      null,
      2,
    ),
  };
}
