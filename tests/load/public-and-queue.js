import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    public_pages: {
      executor: "shared-iterations",
      vus: 50,
      iterations: 1000,
      exec: "publicPages",
    },
    queue_accounts: {
      executor: "shared-iterations",
      vus: 100,
      iterations: 1000,
      exec: "queueAccounts",
      startTime: "5s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
  },
};

const web = __ENV.WEB_ORIGIN || "http://localhost:3000";
const api = __ENV.API_ORIGIN || "http://localhost:3001";

export function publicPages() {
  const response = http.get(`${web}/leaderboard`);
  check(response, { "public page 200": (result) => result.status === 200 });
  sleep(0.05);
}

export function queueAccounts() {
  const response = http.post(
    `${api}/v1/queue`,
    JSON.stringify({ preflightId: `load-${__VU}-${__ITER}` }),
    { headers: { "Content-Type": "application/json" } },
  );
  check(response, {
    "queue accepted or duplicate": (result) =>
      result.status === 200 || result.status === 201 || result.status === 409,
  });
}
