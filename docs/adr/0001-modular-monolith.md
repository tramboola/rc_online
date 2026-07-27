# ADR 0001: Modular monolith before service extraction

Status: accepted, 2026-07-25.

Web, API, worker, and edge are independently deployable, while business
contracts, ledger rules, and state machines remain versioned workspace
packages. This keeps transactions and invariants reviewable during the first
site launch. Extraction is justified only by measured scaling, isolation, or
ownership pressure.
