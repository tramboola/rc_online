# GCP deployment

Create separate staging and production projects, copy the appropriate
`infra/terraform/environments/*.tfvars.example`, and provide only non-secret
project metadata to Terraform. Secrets and restricted Stripe credentials are
created in Secret Manager outside state.

CI authenticates through GitHub OIDC and a repository/branch-limited Workload
Identity Provider. Build immutable images in Artifact Registry, run the
migration Cloud Run Job, verify it, then release web/API/worker revisions.
Worker uses instance-based billing with a minimum instance; web/API use
request-based billing. Cloud Run uses Direct VPC egress for Memorystore and
Cloud SQL private connectivity.

The included Terraform prepares services, network, database, Redis, identities,
Cloud Run, migration job, and Cloud Armor. A production HTTPS load balancer,
managed certificate, CDN hostname, and DNS records must be added only after the
real domain is selected and ownership validated.
