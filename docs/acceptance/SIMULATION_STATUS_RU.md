# Статус программной готовности

Дата среза: 2026-07-27.

## Решение

Статус `SIMULATION READY` присваивается только после успешного integrated
Compose-прогона, миграции пустой БД, 100 ускоренных виртуальных поездок,
failure-suite и visual QA. Наличие исходников само по себе статус не присваивает.
`LAUNCH READY`, `MVP COMPLETE` и `MARKET VALIDATED` не присвоены.

Базовые проверки из предыдущего абзаца завершены 2026-07-27: полный
Compose-стек поднят, миграции пустой PostgreSQL выполнены, regression,
failure-suite и visual QA пройдены. `/v1/public/status` пока сохраняет
`SIMULATION_CANDIDATE`, потому что интеграционная evidence-матрица ниже ещё не
закрыта полностью. Значение `SIMULATION_READY` требует закрытия оставшихся
пунктов и явного `SIMULATION_VERIFIED=true`.

## Реализовано программно

- monorepo, strict TypeScript, общие команды, OpenAPI и контракты;
- versioned ride/car state machines, FIFO queue, offers и 5 WebRTC attempts;
- append-only ledger, lots, idempotency и SQL immutability trigger;
- Nest/Fastify API, Stripe raw-body intake, dedupe, BullMQ worker и DLQ;
- edge safety gate, SQLite WAL outbox и operator stop;
- пользовательский/операторский UI по семи референсам;
- Compose для PostgreSQL, Redis, TURN, MediaMTX, Mailpit и observability;
- отдельный fork Tether Rally с историей/MIT attribution, UART v1,
  Pi/timing simulators, native/ESP32-C3 environments;
- Terraform staging/production, CI, security scanning, threat model и runbooks;
- production startup guard против mock/simulator providers.
- детерминированный regression из 100 ускоренных виртуальных поездок и
  программное применение всех 15 failure scenarios.
- PlatformIO native 4/4, ESP32-C3 debug/release build и Python protocol pytest;
- NVENC 720p60 smoke benchmark на локальной RTX 3050.
- Terraform 1.15.8 `fmt`/`validate` с зафиксированными provider checksums;
- production dependency audit без известных уязвимостей.
- Playwright Chromium visual QA на всех семи исходных viewport и mobile
  contract: 8 применимых тестов `PASS`, 10 намеренных viewport-skip;
  P0/P1/P2 отсутствуют.
- полный Docker Compose `core/sim/obs`: 13 долгоживущих сервисов запущены без
  restart loop, migration job завершён с exit code 0; PostgreSQL/Redis,
  API/worker/web и Mailpit healthy;
- на чистой PostgreSQL применены `0001_simulation_core.sql` и
  `0002_ledger_immutability.sql`; web, API ready, OpenAPI JSON, edge ready,
  Mailpit, Prometheus и Grafana отвечают HTTP 200.

## Требует дополнительного подтверждения

- Redis/BullMQ webhook path, edge reconnect/outbox replay и TURN relay;
- k6 load и integrated повтор всех 15 scenario-controller режимов через HTTP;
- container build/Trivy, CodeQL/Semgrep/gitleaks/SBOM;
- реальный Cloud SQL restore drill с измеренными RPO/RTO.

## Решение по аппаратным и юридическим воротам

По решению владельца от 2026-07-25 аппаратные ворота получили
`WAIVED_FOR_SIMULATION`, а юридические — `OWNER_ACCEPTED_DEFERRED`. Они закрыты
как блокеры только для внутреннего статуса `SIMULATION READY`, но не считаются
фактически пройденными.

Это решение не разрешает реальный автомобиль, live-платежи, публичную
трансляцию, приз или обработку реальных пользовательских данных и не позволяет
присвоить `MVP COMPLETE` либо `LAUNCH READY`. Полная диспозиция и обязательные
ограничения зафиксированы в
[`GATE_DISPOSITION_2026-07-25_RU.md`](GATE_DISPOSITION_2026-07-25_RU.md).
