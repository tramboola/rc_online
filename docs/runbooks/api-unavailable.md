# Runbook: API unavailable

1. Stop new queue offers; do not terminate active edge-controlled rides.
2. Check Cloud Run health, request errors, database connections, Redis, and the
   most recent migration job using the alert correlation window.
3. If the latest revision is faulty, route traffic to the previous compatible
   revision. Never automatically roll back an already-applied irreversible
   migration.
4. If Cloud SQL is unavailable, keep the site in safe degraded mode and follow
   the documented HA/PITR recovery test.
5. Record the incident, start/end times, affected rides, compensations, and
   evidence links.
