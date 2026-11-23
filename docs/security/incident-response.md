# Security and DDoS incident response

## Detection and severity

Prometheus alerts should page the on-call when `ddos_events_total` spikes, `http_requests_in_flight` remains saturated, or 5xx/429 ratios exceed the service-level objective. A **critical** event is confirmed service unavailability, credential exposure, active exploitation, or a critical OWASP/Cargo advisory. **High** is exploitable unauthorized access or sustained regional/IP abuse. Medium and low findings are tracked in the next remediation window.

## First 15 minutes

The on-call acknowledges the alert, records the incident start time and affected routes, and preserves request, edge, application, and CI reports. Enable the Cloudflare emergency rate-limit rule, Bot Fight Mode or managed challenge, and the configured high-risk country block. If the origin is still saturated, restrict ingress to the edge network and scale the application service. Do not disable authentication or logging to restore availability.

## Containment and recovery

Rotate any exposed credentials, invalidate affected API keys, and deploy the smallest reviewed mitigation. Capture the Terraform plan and security workflow artifacts. Validate `/health`, `/ready`, representative read and mutation flows, Redis health, and contract RPC connectivity before removing emergency controls. Keep a timeline of decisions, commands, alert links, and owners.

## Post-incident

Within two business days, document root cause, attack indicators, false positives, customer impact, time to detect, time to contain, and permanent controls. Add regression tests, update edge rules and Terraform variables, and review the playbook with the service owner. Never commit tokens, CAPTCHA secrets, state files, or customer request bodies.

## Security CI policy

Every pull request runs dependency review, npm audit, Cargo audit/deny, contract tests, and OWASP ZAP baseline testing. HIGH and CRITICAL findings fail the check; MEDIUM and LOW findings are retained in artifacts and triaged. A release cannot proceed while a failing security job is unresolved or explicitly risk-accepted by the security owner.
