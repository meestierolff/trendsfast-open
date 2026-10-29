# Changelog

## 0.1.1 (2026-10-29)

- Published from GitHub Actions with an npm provenance statement, which n8n requires before it verifies a community node. The node is unchanged.

## 0.1.0 (2026-10-29)

First version, published from a maintainer's machine and so without provenance.

- TrendsFast node, usable as an AI agent tool:
  - Product: Run for a saved brand context (Customers 10, Trending 25, Competitors 30, Formats 20, Search 35 credits), or for a website and description as a 3-credit niche read through the product's lens; Get Quote (free).
  - Global Trend: Query (1 credit). Question: Ask (5 credits).
  - Result: Get, Request: Get by Request ID, Account: Get Wallet, Get Context and Get History (all free).
- TrendsFast API credential: a project API key sent as a bearer token, tested on the free wallet read.
- Paid calls carry one request ID and a Max Credits cap; redirects are never followed and nothing resends a paid call.
- Two example workflows and an offline test suite checked against the TrendsFast V3 OpenAPI contract.
