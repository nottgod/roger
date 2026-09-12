# Ledgerline — ICP

**This is a fictional example.** Ledgerline sells reconciliation software to finance teams at
fintechs. Nothing here is real: it exists so you can see the shape of a context pack before
writing your own. Copy this folder, rename it, and replace every table.

> **The `.M` sections are read at runtime** by `score.mjs`. Edit a table and the scoring
> changes — no code involved. Prose outside those tables is for you, not for the machine.

## What we sell

Reconciliation software for finance teams at fintechs and marketplaces. We replace the
spreadsheet that three people maintain by hand at month close.

## 3.2.M. Numbers

| key | value |
| --- | --- |
| headcount_min | 20 |
| headcount_max | 400 |
| budget_floor_usd_month | 1500 |
| gap_material_min | 2 |
| timing_forte_min | 1 |

## 3.3.M. Segment, cluster and approach

| slug | cluster | approach |
| --- | --- | --- |
| payments | Payment processors | Case |
| marketplaces | Marketplaces | Contextual |
| neobanks | Neobanks | Direto |
| lending | Lending platforms | Case |

## 3.4.M. Geography

| slug | decision | aliases |
| --- | --- | --- |
| united-states | accept | usa, us, united states |
| united-kingdom | accept | uk, united kingdom |
| germany | accept | germany, deutschland |
| netherlands | accept | netherlands, holland |
| singapore | accept | singapore |
| brazil | accept | brazil, brasil |

## 3.6.M. Not our market

| slug | label |
| --- | --- |
| pre-revenue | No revenue yet, nothing to reconcile |
| single-currency-local | One currency, one bank, no complexity |
| enterprise-bank | A bank with its own core team |
| agency | An agency reselling to someone else |

## 3.7.M. Timing signals

| key | label |
| --- | --- |
| recentFunding | Raised in the last 12 months |
| hiringForTheProblem | Hiring for the problem you solve |
| newLaunch | Launched or is about to launch something |
| pressCoverage | Got press or a partnership recently |

## 3.11.M. Gap signals

| key | label |
| --- | --- |
| noRecentActivity | Quiet in public for months |
| genericMessaging | Their messaging says nothing specific |
| founderInvisible | The person who owns the problem never appears |
| inconsistentStory | Site and founder tell different stories |
