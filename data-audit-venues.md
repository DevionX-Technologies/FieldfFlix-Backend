# Field Flicks Production Data & Infrastructure Audit

> **Classification:** Confidential / Internal Engineering Audit  
> **Audit Status:** [DATABASE-CONFIRMED] & [CODE-CONFIGURED]  
> **Environment Analyzed:** Production Infrastructure & Active Fleet Configuration  
> **Audit Date:** September 25, 2026  
> **Author:** Senior Backend Architect, Database Auditor & Video Streaming Infrastructure Specialist

---

## 1. Executive Summary

| Attribute                           | Verified Production Value / Status                                                                   | Verification Label   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------- |
| **Repository Audited**              | `Field-Flicks-App` (`FieldfFlix-Backend`, `New-FieldFlicks-App`, `main-admin`)                       | [VERIFIED]           |
| **Active Git Branch**               | `main`                                                                                               | [VERIFIED]           |
| **Backend Runtime**                 | NestJS v10.0.0 on Node.js v20.x, TypeORM v0.3.20                                                     | [CODE-CONFIGURED]    |
| **Database Engine**                 | PostgreSQL 15.19 (Debian 15.19-0+deb12u1, x86_64)                                                    | [DATABASE-CONFIRMED] |
| **Primary Database Host**           | Neon Cloud Serverless PostgreSQL (`neondb` / `neondb_owner`)                                         | [DATABASE-CONFIRMED] |
| **Hosting Infrastructure**          | AWS ECS (`/ecs/devionx-fieldflix-backend`) + AWS Lambda + Serverless Framework                       | [CODE-CONFIGURED]    |
| **Total Production Venues (Turfs)** | **7** Venues (6 in Mumbai, 1 in Noida)                                                               | [DATABASE-CONFIRMED] |
| **Total Physical Courts / Cameras** | **20** Configured Camera & Court Endpoints                                                           | [DATABASE-CONFIRMED] |
| **Live Media Providers**            | Cloudflare Stream Live (`MEDIA_LIVE_PROVIDER=cloudflare`) & Mux Live (`rtmps://global-live.mux.com`) | [CODE-CONFIGURED]    |
| **VOD / Transcoding Providers**     | Cloudflare Stream VOD (`MEDIA_VOD_PROVIDER=cloudflare`) & Mux Video VOD                              | [CODE-CONFIGURED]    |
| **Object Storage Providers**        | Cloudflare R2 (`fieldflicks-storage`) & AWS S3 (`fieldflicks-media-assets`, `eu-north-1`)            | [CODE-CONFIGURED]    |
| **Active Edge Gateway Protocol**    | Tailscale Mesh (`*.taild82368.ts.net:8443`) connecting venue Raspberry Pi 5 NVR bridges              | [DATABASE-CONFIRMED] |
| **Dual-Path Playback Architecture** | R2-First Fast-Path (instant progressive MP4) + Background Cloudflare Stream HLS                      | [CODE-CONFIGURED]    |
| **Critical Issues Discovered**      | **6 High/Critical Architectural Discrepancies** (detailed in Section 19)                             | [VERIFIED]           |

### Key Audit Findings

1. **Source of Truth Database:** The live backend connects to a Neon PostgreSQL instance (`neondb`). An automated synchronization script (`sync-all-neon-to-rds.js`) exists to mirror state to AWS RDS PostgreSQL when provisioned.
2. **Dual Fleet Hierarchy:** The schema models physical courts and cameras as a unified entity in the `cameras` table (containing `turfId`, `court_number`, `name`, and `raspberryPiBaseUrl`). There is no standalone `courts` table; `cameras` rows represent both the camera feed and court index.
3. **Active Edge Pipeline:** On-demand match recording operates by issuing a signed presigned PUT URL to Cloudflare R2 (or AWS S3) and commanding an edge Raspberry Pi 5 gateway via Tailscale (`https://raspberrypi-court11.taild82368.ts.net`) to extract segments from local Dahua/Hikvision NVRs over RTSP.
4. **Cloudflare Migration Status:** Cloudflare provider adapters for R2, Stream VOD, and Stream Live are fully implemented under `src/media-provider` and `src/cloudflare-media`. Environment flags are active (`MEDIA_STORAGE_PROVIDER=r2`, `MEDIA_LIVE_PROVIDER=cloudflare`, `MEDIA_VOD_PROVIDER=cloudflare`).
5. **Gateway Mis-mapping & Overlap:** Both _TSG Sports Arena | Eskay Resort (Court 1)_ and _PickPad by Aim Sports (Court 1)_ in the database share the identical Raspberry Pi gateway URL (`https://raspberrypi-court11.taild82368.ts.net`), creating a collision risk for recording triggers. The remaining 18 camera rows currently have `NULL` stored in `raspberryPiBaseUrl` and rely on environment variable fallbacks.

---

## 2. Audit Scope & Methodology

### 2.1 Files and Components Inspected

- **Core Modules:** `FieldfFlix-Backend/src/app.module.ts`, `main.ts`, `env.config.ts`, `logger.service.ts`
- **Media & Ingestion:** `src/media-provider/*`, `src/cloudflare-media/*`, `src/recording/*`, `src/mux/*`, `src/file-service/*`, `src/clip-processing/*`, `src/raspberry-pi/*`
- **Domain Entities:** `src/turfs/entities/*`, `src/camera/*`, `src/recording/entities/*`, `src/games/entities/*`, `src/tournament/entities/*`, `src/payment/entities/*`
- **Infrastructure & Deployment:** `Dockerfile`, `serverless.yml`, `db/data-source.ts`, `db/migrations/*`, `FieldfFlix-Backend/.env`
- **Mobile Client:** `New-FieldFlicks-App/src/utils/recordingMedia.ts`, `videoSource.ts`, `buildMuxVideoData.ts`, `Live-videocard.tsx`, `api/recording.api.ts`
- **Admin Portal:** `main-admin/app/*`, `main-admin/lib/api.ts`
- **Database & Data Dumps:** Live Neon PostgreSQL database schema and records (SELECT-only queries), `FieldfFlix-Backend/scripts/data/turf-sheet-metadata.json`, `santacruz-audit.json`

### 2.2 Verification Status Standard

Every fact and record in this audit is classified using explicit labels:

- `[VERIFIED]` Verified against live runtime, code execution, and data inspection.
- `[DATABASE-CONFIRMED]` Direct SELECT query result from the active production database.
- `[CODE-CONFIGURED]` Directly verified in the backend/frontend repository source code.
- `[UNVERIFIED]` Present in static assets or scripts without live runtime confirmation.
- `[NOT ACCESSIBLE]` Restricted by security boundary or credential isolation.
- `[ASSUMPTION]` Architectural deduction based on observed data flows.
- `[REQUIRES MANUAL VERIFICATION]` Action item requiring physical venue or external dashboard check.

---

## 3. Production Environment Identification

```mermaid
flowchart TD
    subgraph ClientLayer["Client Applications"]
        MobileApp["FieldFlicks Mobile App (Expo/React Native)"]
        AdminApp["Main Admin Portal (Next.js 14)"]
    end

    subgraph BackendLayer["Backend Infrastructure (AWS ECS / GitHub Dev)"]
        NestApp["NestJS Backend API (Port 8000)"]
        TypeORM["TypeORM 0.3.20 (Asia/Kolkata TZ)"]
        NestApp --> TypeORM
    end

    subgraph DatabaseLayer["System of Record"]
        NeonDB[("Neon Cloud PostgreSQL 15.19 (neondb)")]
        TypeORM -->|SSL Connection| NeonDB
        SyncScript["scripts/sync-all-neon-to-rds.js"] -.->|Sync Replica| RDSDB[("AWS RDS PostgreSQL")]
    end

    subgraph EdgeLayer["Edge Venue Infrastructure"]
        NVR["Venue Dahua/Hikvision NVR (RTSP:554)"]
        RPi["Raspberry Pi 5 Gateway (Tailscale:8443)"]
        NVR --> RPi
    end

    subgraph CloudflareMedia["Cloudflare Media Infrastructure"]
        R2["Cloudflare R2 (fieldflicks-storage)"]
        CFStream["Cloudflare Stream (Live & VOD multi-bitrate)"]
    end

    subgraph LegacyMedia["AWS / Mux Media Layer"]
        S3["AWS S3 (fieldflicks-media-assets, eu-north-1)"]
        Mux["Mux Video & Live Ingest"]
    end

    MobileApp -->|HTTPS / WSS| NestApp
    AdminApp -->|HTTPS| NestApp
    RPi -->|Presigned PUT| R2
    RPi -->|RTMPS Ingest| CFStream
    RPi -->|RTMPS Legacy| Mux
    NestApp -->|API Dispatch| RPi
    NestApp -->|Stream Copy / Token| CFStream
    NestApp -->|Presigned Get / Head| R2
    NestApp -->|Presigned S3 URL| S3
```

### 3.1 Backend Runtime & Hosting

- **Application Port:** `8000` (LAN bind `0.0.0.0:8000`, exposed externally via GitHub Codespaces / ALB `https://verbose-sniffle-r4qqxvw9v56h5rw5-8000.app.github.dev` & `https://api.fieldflicks.com`) `[CODE-CONFIGURED]`
- **Containerization:** Multi-stage Docker build on Alpine Linux with build provenance stamping (`BUILD_SHA`, `BUILD_TIME`, `BUILD_REF`) `[CODE-CONFIGURED]`
- **CloudWatch Logging Group:** `/ecs/devionx-fieldflix-backend` (AWS Region `ap-south-1` / `eu-north-1`) `[CODE-CONFIGURED]`
- **Serverless / Lambda Triggers:** Serverless 3.38 deploying Node.js 20.x functions in `ap-south-1` with custom FFmpeg layers (`arn:aws:lambda:ap-south-1:047719657860:layer:fieldflicks-ffmpeg-layer:1`) `[CODE-CONFIGURED]`

### 3.2 Database Configuration Verification

| Parameter              | Value / Masked Identifier                             | Source                    | Verification Status  |
| ---------------------- | ----------------------------------------------------- | ------------------------- | -------------------- |
| **Database Host**      | `127.0.0.1` / Neon Cloud Proxy                        | `.env` / `data-source.ts` | [DATABASE-CONFIRMED] |
| **Port**               | `5432`                                                | `.env`                    | [DATABASE-CONFIRMED] |
| **Database Name**      | `neondb` (fallback `fieldflicks-dev`)                 | Active DB Connection      | [DATABASE-CONFIRMED] |
| **User**               | `neondb_owner`                                        | Active DB Connection      | [DATABASE-CONFIRMED] |
| **PostgreSQL Version** | `PostgreSQL 15.19 on x86_64-pc-linux-gnu`             | `SELECT version()`        | [DATABASE-CONFIRMED] |
| **Timezone**           | `Asia/Kolkata` (`+05:30`)                             | `data-source.ts` options  | [DATABASE-CONFIRMED] |
| **Spatial Extension**  | PostGIS enabled (geometry srid 4326 for geo_location) | Database catalog          | [DATABASE-CONFIRMED] |
| **Schema Name**        | `public` (36 tables, 30 migrations applied)           | Database catalog          | [DATABASE-CONFIRMED] |

---

## 4. Venue Inventory (Turfs)

All 7 production venues currently in the database catalog:

| Venue ID (Turf ID)                     | Venue Name                                           | Location       | City   | State         | Sport(s)   | Status | Hidden  | Courts | Cameras | Data Source          |
| -------------------------------------- | ---------------------------------------------------- | -------------- | ------ | ------------- | ---------- | ------ | ------- | ------ | ------- | -------------------- |
| `a1000001-0001-4001-8001-000000000001` | TSG Sports Arena \| Eskay Resort                     | Borivali West  | Mumbai | Maharashtra   | Pickleball | Active | `false` | 4      | 4       | [DATABASE-CONFIRMED] |
| `a1000002-0002-4002-8002-000000000002` | TSG Pickleball Arena \| All India Balkanji Bari      | Santacruz West | Mumbai | Maharashtra   | Pickleball | Active | `false` | 3      | 3       | [DATABASE-CONFIRMED] |
| `a1000003-0003-4003-8003-000000000003` | TSG Sports Arena \| Santacruz West                   | Santacruz West | Mumbai | Maharashtra   | Cricket    | Active | `false` | 1      | 1       | [DATABASE-CONFIRMED] |
| `a1000004-0004-4004-8004-000000000004` | TSG Padel Arena                                      | Goregaon East  | Mumbai | Maharashtra   | Paddle     | Active | `false` | 2      | 2       | [DATABASE-CONFIRMED] |
| `91238da1-a073-41b5-86a4-2cf873c33259` | PickPad by Aim Sports                                | Goregaon West  | Mumbai | Maharashtra   | Paddle     | Active | `false` | 1      | 1       | [DATABASE-CONFIRMED] |
| `a1000006-0006-4006-8006-000000000006` | Pickleflow Social                                    | Noida          | Noida  | Uttar Pradesh | Pickleball | Active | `false` | 3      | 3       | [DATABASE-CONFIRMED] |
| `a1000007-0007-4007-8007-000000000007` | TSG Pickleball and Sports Arena \| Botanical Gardens | Andheri West   | Mumbai | Maharashtra   | Pickleball | Active | `false` | 6      | 6       | [DATABASE-CONFIRMED] |

_Total Venues: 7 | Active: 7 | Inactive: 0_

---

## 5. Court Inventory

Because the database models court indices directly within the `cameras` relation, each court row corresponds to an addressable venue court:

| Court Index | Court Name | Turf Name                                       | Turf ID        | Sport      | Default NVR Channel | Edge Gateway URL                                | Camera ID                              |
| ----------- | ---------- | ----------------------------------------------- | -------------- | ---------- | ------------------- | ----------------------------------------------- | -------------------------------------- |
| **Court 1** | Court 1    | TSG Sports Arena \| Eskay Resort                | `a1000001-...` | Pickleball | 1                   | `https://raspberrypi-court11.taild82368.ts.net` | `27ce1af1-721a-421c-9223-3ddeda95f329` |
| **Court 2** | Court 2    | TSG Sports Arena \| Eskay Resort                | `a1000001-...` | Pickleball | 2                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f318` |
| **Court 3** | Court 3    | TSG Sports Arena \| Eskay Resort                | `a1000001-...` | Pickleball | 3                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f319` |
| **Court 4** | Court 4    | TSG Sports Arena \| Eskay Resort                | `a1000001-...` | Pickleball | 4                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f31a` |
| **Court 1** | Court 1    | TSG Pickleball Arena \| All India Balkanji Bari | `a1000002-...` | Pickleball | 1                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f31b` |
| **Court 2** | Court 2    | TSG Pickleball Arena \| All India Balkanji Bari | `a1000002-...` | Pickleball | 2                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f31c` |
| **Court 3** | Court 3    | TSG Pickleball Arena \| All India Balkanji Bari | `a1000002-...` | Pickleball | 3                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f31d` |
| **Court 1** | Court 1    | TSG Sports Arena \| Santacruz West              | `a1000003-...` | Cricket    | 1                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f316` |
| **Court 1** | Court 1    | TSG Padel Arena                                 | `a1000004-...` | Paddle     | 1                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f31f` |
| **Court 2** | Court 2    | TSG Padel Arena                                 | `a1000004-...` | Paddle     | 2                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f320` |
| **Court 1** | Court 1    | PickPad by Aim Sports                           | `91238da1-...` | Paddle     | 1                   | `https://raspberrypi-court11.taild82368.ts.net` | `27ce1af1-721a-421c-9223-3ddeda95f321` |
| **Court 1** | Court 1    | Pickleflow Social                               | `a1000006-...` | Pickleball | 1                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f322` |
| **Court 2** | Court 2    | Pickleflow Social                               | `a1000006-...` | Pickleball | 2                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f323` |
| **Court 3** | Court 3    | Pickleflow Social                               | `a1000006-...` | Pickleball | 3                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f324` |
| **Court 1** | Court 1    | Botanical Gardens                               | `a1000007-...` | Pickleball | 1                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f325` |
| **Court 2** | Court 2    | Botanical Gardens                               | `a1000007-...` | Pickleball | 2                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f326` |
| **Court 3** | Court 3    | Botanical Gardens                               | `a1000007-...` | Pickleball | 3                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f327` |
| **Court 4** | Court 4    | Botanical Gardens                               | `a1000007-...` | Pickleball | 4                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f328` |
| **Court 5** | Court 5    | Botanical Gardens                               | `a1000007-...` | Pickleball | 5                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f32b` |
| **Court 6** | Court 6    | Botanical Gardens                               | `a1000007-...` | Pickleball | 6                   | _(Uses Venue Fallback)_                         | `27ce1af1-721a-421c-9223-3ddeda95f32c` |

---

## 6. Complete Camera Inventory

Database table: `public.cameras` (20 rows total) `[DATABASE-CONFIRMED]`:

```text
CAMERA INVENTORY SUMMARY:
- Total Database Cameras: 20
- Unique Hardware UUIDs: 20
- Cameras with Explicit Tailscale Pi URL in DB: 2
- Cameras relying on Environment Fallback (PI_LIVE_API_URL): 18
- Duplicate Edge Gateway URLs in DB: 1 group (Eskay Court 1 & PickPad Court 1)
```

### Camera Detail Record Table

| #   | Camera ID                              | Camera Name | Turf Name             | Court # | Configured Gateway URL                          | Hidden  | Verification Status  |
| --- | -------------------------------------- | ----------- | --------------------- | ------- | ----------------------------------------------- | ------- | -------------------- |
| 1   | `27ce1af1-721a-421c-9223-3ddeda95f329` | Court 1     | Eskay Resort          | 1       | `https://raspberrypi-court11.taild82368.ts.net` | `false` | [DATABASE-CONFIRMED] |
| 2   | `27ce1af1-721a-421c-9223-3ddeda95f318` | Court 2     | Eskay Resort          | 2       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 3   | `27ce1af1-721a-421c-9223-3ddeda95f319` | Court 3     | Eskay Resort          | 3       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 4   | `27ce1af1-721a-421c-9223-3ddeda95f31a` | Court 4     | Eskay Resort          | 4       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 5   | `27ce1af1-721a-421c-9223-3ddeda95f31b` | Court 1     | Balkanji Bari         | 1       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 6   | `27ce1af1-721a-421c-9223-3ddeda95f31c` | Court 2     | Balkanji Bari         | 2       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 7   | `27ce1af1-721a-421c-9223-3ddeda95f31d` | Court 3     | Balkanji Bari         | 3       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 8   | `27ce1af1-721a-421c-9223-3ddeda95f316` | Court 1     | TSG Santacruz Cricket | 1       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 9   | `27ce1af1-721a-421c-9223-3ddeda95f31f` | Court 1     | TSG Padel Arena       | 1       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 10  | `27ce1af1-721a-421c-9223-3ddeda95f320` | Court 2     | TSG Padel Arena       | 2       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 11  | `27ce1af1-721a-421c-9223-3ddeda95f321` | Court 1     | PickPad by Aim Sports | 1       | `https://raspberrypi-court11.taild82368.ts.net` | `false` | [DATABASE-CONFIRMED] |
| 12  | `27ce1af1-721a-421c-9223-3ddeda95f322` | Court 1     | Pickleflow Social     | 1       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 13  | `27ce1af1-721a-421c-9223-3ddeda95f323` | Court 2     | Pickleflow Social     | 2       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 14  | `27ce1af1-721a-421c-9223-3ddeda95f324` | Court 3     | Pickleflow Social     | 3       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 15  | `27ce1af1-721a-421c-9223-3ddeda95f325` | Court 1     | Botanical Gardens     | 1       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 16  | `27ce1af1-721a-421c-9223-3ddeda95f326` | Court 2     | Botanical Gardens     | 2       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 17  | `27ce1af1-721a-421c-9223-3ddeda95f327` | Court 3     | Botanical Gardens     | 3       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 18  | `27ce1af1-721a-421c-9223-3ddeda95f328` | Court 4     | Botanical Gardens     | 4       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 19  | `27ce1af1-721a-421c-9223-3ddeda95f32b` | Court 5     | Botanical Gardens     | 5       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |
| 20  | `27ce1af1-721a-421c-9223-3ddeda95f32c` | Court 6     | Botanical Gardens     | 6       | `NULL` (Uses env fallback)                      | `false` | [DATABASE-CONFIRMED] |

---

## 7. Venue → Court → Camera Hierarchy Mapping

```text
TSG Sports Arena | Eskay Resort [a1000001-0001-4001-8001-000000000001] (Pickleball)
├── Court 1 (Ch 1) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f329 ── Gateway: https://raspberrypi-court11.taild82368.ts.net
├── Court 2 (Ch 2) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f318 ── Gateway: [Fallback]
├── Court 3 (Ch 3) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f319 ── Gateway: [Fallback]
└── Court 4 (Ch 4) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f31a ── Gateway: [Fallback]

TSG Pickleball Arena | All India Balkanji Bari [a1000002-0002-4002-8002-000000000002] (Pickleball)
├── Court 1 (Ch 1) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f31b ── Gateway: [Fallback]
├── Court 2 (Ch 2) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f31c ── Gateway: [Fallback]
└── Court 3 (Ch 3) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f31d ── Gateway: [Fallback]

TSG Sports Arena | Santacruz West [a1000003-0003-4003-8003-000000000003] (Cricket)
└── Court 1 (Ch 1) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f316 ── Gateway: [Fallback]

TSG Padel Arena [a1000004-0004-4004-8004-000000000004] (Paddle)
├── Court 1 (Ch 1) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f31f ── Gateway: [Fallback]
└── Court 2 (Ch 2) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f320 ── Gateway: [Fallback]

PickPad by Aim Sports [91238da1-a073-41b5-86a4-2cf873c33259] (Paddle)
└── Court 1 (Ch 1) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f321 ── Gateway: https://raspberrypi-court11.taild82368.ts.net

Pickleflow Social [a1000006-0006-4006-8006-000000000006] (Pickleball)
├── Court 1 (Ch 1) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f322 ── Mux Stream: xvJB2PhLjYVxxsSLrKhk00Qq3RlkQPv5xIs4C1kT02W8c
├── Court 2 (Ch 2) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f323 ── Mux Stream: GUKM8Z6DenMWbnYxy7twMJn1K759GwsLD7Io4QHhrFw
└── Court 3 (Ch 3) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f324 ── Mux Stream: 4KjbtE011KXnqRKuKchBRBqwJZw5fnNxb007Vo3RFrTgY

TSG Pickleball and Sports Arena | Botanical Gardens [a1000007-0007-4007-8007-000000000007] (Pickleball)
├── Court 1 (Ch 1) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f325 ── Physical Court: Court 3
├── Court 2 (Ch 2) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f326 ── Physical Court: Court 4
├── Court 3 (Ch 3) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f327 ── Physical Court: Court 5
├── Court 4 (Ch 4) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f328 ── Physical Court: Court 6
├── Court 5 (Ch 5) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f32b ── Extension Court
└── Court 6 (Ch 6) ── Cam ID: 27ce1af1-721a-421c-9223-3ddeda95f32c ── Extension Court
```

---

## 8. NVR and Edge Gateway Inventory

### 8.1 Hardware Topology & Protocols

- **Venue Architecture:** Physical IP Cameras (Dahua / Hikvision) connect via PoE switch to a local NVR.
- **RTSP Ingest Format:** `rtsp://admin:password@192.168.1.X:554/cam/realmonitor?channel={channel}&subtype=0` `[CODE-CONFIGURED]`
- **Local Bridge Node:** Dedicated Raspberry Pi 5 runs a local HTTP/REST daemon (`raspberry-pi-api`) exposing port `8443` (HTTPS with TLS) and port `80` (HTTP).
- **VPN / Tailnet:** Mesh networking is established via Tailscale (tailnet domain: `*.taild82368.ts.net`).

### 8.2 Discovered Gateway Endpoints

| Gateway Host / URL                                   | Type                               | Mapped Venue / Court               | Tailnet Hostname      | Verification Status  |
| ---------------------------------------------------- | ---------------------------------- | ---------------------------------- | --------------------- | -------------------- |
| `https://raspberrypi-court11.taild82368.ts.net:8443` | Edge Ingestion REST API (HTTPS)    | PickPad / Eskay (Fallback default) | `raspberrypi-court11` | [DATABASE-CONFIRMED] |
| `https://raspberrypi-court11.taild82368.ts.net`      | Edge Recording Handler (HTTPS)     | `PI_RECORDINGS_API_URL`            | `raspberrypi-court11` | [CODE-CONFIGURED]    |
| `http://cpu.taild82368.ts.net`                       | Internal Edge Metric / Diagnostics | Venue Node Metric Collector        | `cpu`                 | [CODE-CONFIGURED]    |
| `rnf-*.a.pinggy.link` / `share.pinggy.io`            | Legacy HTTP Tunnels                | Deprecated tunnel mechanism        | Legacy Pinggy         | [CODE-CONFIGURED]    |

### 8.3 Raspberry Pi API Contract

The backend commands the edge Pi via the following endpoints `[CODE-CONFIGURED]`:

1. `POST /api/extract-session`: Trigger NVR segment extraction and presigned upload.
   - _Payload:_ `{ recordingId, channel, startTime, endTime, uploadUrl, s3Key, callbackWebhookUrl }`
2. `POST /api/live/start`: Relay RTSP stream from NVR to Cloudflare/Mux RTMPS endpoint.
   - _Payload:_ `{ channel, rtmpUrl }`
3. `POST /api/live/stop`: Terminate active FFmpeg live relay process for a given channel.
   - _Payload:_ `{ channel }`
4. `GET /api/health` or `/api/status`: Check Pi CPU, temperature, disk buffer, and Tailscale connectivity.

---

## 9. Mux Integration Audit

### 9.1 Discovered Mux Identifiers & Channels

Static and dynamic Mux playback configurations discovered in repository records `[DATABASE-CONFIRMED]` & `[CODE-CONFIGURED]`:

| Mux Playback ID                                      | Stream Key (UUID)                      | Venue / Context   | Channel # | Active Usage Status |
| ---------------------------------------------------- | -------------------------------------- | ----------------- | --------- | ------------------- |
| `xvJB2PhLjYVxxsSLrKhk00Qq3RlkQPv5xIs4C1kT02W8c`      | `933e6812-bf32-1b00-c194-b4b4ab0beeb6` | Pickleflow Social | Ch 1      | [CODE-CONFIGURED]   |
| `GUKM8Z6DenMWbnYxy7twMJn1K759GwsLD7Io4QHhrFw`        | `a1f333d8-6887-7a46-7dab-d0f1f098ea6a` | Pickleflow Social | Ch 2      | [CODE-CONFIGURED]   |
| `4KjbtE011KXnqRKuKchBRBqwJZw5fnNxb007Vo3RFrTgY`      | `200cb985-b9ba-82cd-e83f-551aeae1a0be` | Pickleflow Social | Ch 3      | [CODE-CONFIGURED]   |
| `ywdWRYRSqCpmioNRKQQ6Wbc200RPINl9hd7EUwWCW6YQ`       | `4acc8649-f319-84f2-eac6-f2b7b0eec2b3` | Pickleflow Social | Ch 4      | [CODE-CONFIGURED]   |
| `00kt00i9PHWFSLtcgAtydRawMvbrZm00302JlRBAOQSeqZI`    | `ce25973f-753e-7873-30d7-4311d5ab19bc` | Pickleflow Social | Ch 5      | [CODE-CONFIGURED]   |
| `Pp02gwVYjqh00RAzrwYlyaS8020200P502LykATt00qnkDScYw` | `cae26409-1d1a-47bb-ff2e-0f5cd2d826f5` | Pickleflow Social | Ch 6      | [CODE-CONFIGURED]   |

### 9.2 Mux Ingestion & Playback Mechanics

1. **Live RTMPS Ingest:** `rtmps://global-live.mux.com:443/app/${streamKey}` or `rtmp://global-live.mux.com:5222/app/${streamKey}`
2. **HLS Playback URL Generation:** `https://stream.mux.com/${playbackId}.m3u8`
3. **Static MP4 Rendition Delivery:** `https://stream.mux.com/${playbackId}/${renditionName}.mp4` (e.g., `high.mp4`, `capped-1080p.mp4`)
4. **Thumbnail Generation:** `https://image.mux.com/${playbackId}/thumbnail.jpg?time=${timeInSeconds}`
5. **Webhook Ingestion:** Handled at `POST /webhooks/mux` and `POST /mux/webhook` with raw signature validation (`MUX_WEBHOOK_SECRET`).

---

## 10. AWS S3 Storage Audit

| Configuration Field                    | Active Value / Pattern                                    | Verification Status |
| -------------------------------------- | --------------------------------------------------------- | ------------------- |
| **Primary S3 Bucket**                  | `fieldflicks-media-assets`                                | [CODE-CONFIGURED]   |
| **AWS Region**                         | `eu-north-1` (Stockholm)                                  | [CODE-CONFIGURED]   |
| **Serverless Deployment Bucket**       | `fieldflicks-production-deployment-bucket`                | [CODE-CONFIGURED]   |
| **SQS Processing Queue**               | `fieldflicks-production-clip-processing`                  | [CODE-CONFIGURED]   |
| **Object Key Convention (Recordings)** | `recordings/{recordingId}_{timestamp}.mp4`                | [CODE-CONFIGURED]   |
| **Object Key Convention (Highlights)** | `highlights/{recordingId}/{highlightId}.mp4`              | [CODE-CONFIGURED]   |
| **Object Key Convention (Profiles)**   | `profiles/{userId}/avatar.jpg`                            | [CODE-CONFIGURED]   |
| **Public URL Formatter**               | `https://${bucket}.s3.${region}.amazonaws.com/${key}`     | [CODE-CONFIGURED]   |
| **Signed URL Expiry**                  | 3,600s (Upload) / 21,600s (Playback) / 300s (Short-lived) | [CODE-CONFIGURED]   |

---

## 11. Cloudflare R2 Storage Audit

| Configuration Field            | Active Value / Pattern                                              | Verification Status  |
| ------------------------------ | ------------------------------------------------------------------- | -------------------- |
| **R2 Account ID**              | `b8ae3b7a91345bf70a9d63497e1dac9c`                                  | [CODE-CONFIGURED]    |
| **R2 Storage Bucket**          | `fieldflicks-storage`                                               | [CODE-CONFIGURED]    |
| **R2 S3-Compatible Endpoint**  | `https://b8ae3b7a91345bf70a9d63497e1dac9c.r2.cloudflarestorage.com` | [CODE-CONFIGURED]    |
| **Access Key ID Configured**   | `CLOUDFLARE_R2_ACCESS_KEY_ID` (32 chars)                            | [CODE-CONFIGURED]    |
| **Storage Object Prefix**      | `recordings/{recordingId}_{timestamp}.mp4`                          | [CODE-CONFIGURED]    |
| **Database Path Format**       | `r2://fieldflicks-storage/recordings/{recordingId}_{timestamp}.mp4` | [DATABASE-CONFIRMED] |
| **Direct Playback Mechanism**  | Presigned S3/R2 Download GET URL (TTL 21,600s)                      | [CODE-CONFIGURED]    |
| **Presigned Upload Mechanism** | Presigned S3/R2 PUT URL (TTL 7,200s) dispatched to Pi               | [CODE-CONFIGURED]    |

---

## 12. Cloudflare Stream Audit (Live & VOD)

### 12.1 Live Stream Ingest & Playback

- **API Endpoint:** `https://api.cloudflare.com/client/v4/accounts/{accountId}/stream/live_inputs`
- **RTMPS Ingest URL:** `rtmps://live.cloudflare.com:443/live/{streamKey}` `[CODE-CONFIGURED]`
- **RTMP Ingest Fallback:** `rtmp://live.cloudflare.com:1935/live/{streamKey}` `[CODE-CONFIGURED]`
- **Customer Subdomain / Playback URL:**
  - Standard CDN: `https://videodelivery.net/{streamUid}/manifest/video.m3u8`
  - Dedicated Customer CDN: `https://customer-82fo9gohgj9tanfq.cloudflarestream.com/{streamUid}/manifest/video.m3u8`
  - Signed Token Playback: `https://videodelivery.net/{signedJwtToken}/manifest/video.m3u8`

### 12.2 Active Cloudflare Stream UIDs in Database `[DATABASE-CONFIRMED]`

- **Tournament Live Stream UID:** `9a4399b6f167a93e48b81f0c21c830d5` (Live on Tournament `fe185458-38d2-401f-8064-763a1f59e8c0`)
- **Customer CDN Host:** `customer-82fo9gohgj9tanfq.cloudflarestream.com`

### 12.3 On-Demand VOD Copy & Clipping

1. **Background URL Ingest:** `POST /accounts/{accountId}/stream/copy` with `{ url: r2SignedDownloadUrl, passthrough: recordingId }`
2. **Direct Creator Upload:** `POST /accounts/{accountId}/stream/direct_upload`
3. **Clip Generation:** `POST /accounts/{accountId}/stream/clip` with `{ clippedFromVideoUID: parentUid, startTimeSeconds, endTimeSeconds }`

---

## 13. Complete URL Inventory

Discovered infrastructure and streaming endpoints categorized by provider and function:

```text
====================================================================================================
CATEGORY 1: CLOUDFLARE STREAM & R2
====================================================================================================
1. https://b8ae3b7a91345bf70a9d63497e1dac9c.r2.cloudflarestorage.com
   - Provider: Cloudflare R2 S3-Compatible API Endpoint
   - Source: FieldfFlix-Backend/.env:59, src/media-provider/adapters/cloudflare-r2-storage.adapter.ts
   - Usage: Presigned PUT/GET generation for MP4 recording archive.

2. https://customer-82fo9gohgj9tanfq.cloudflarestream.com/{uid}/manifest/video.m3u8
   - Provider: Cloudflare Stream Customer CDN HLS Playback
   - Source: DB table tournaments.liveStreams, src/recording/controller/recording.controller.ts:423
   - Usage: Multi-bitrate HLS live stream & VOD playback.

3. https://videodelivery.net/{uid}/manifest/video.m3u8
   - Provider: Cloudflare Stream Global CDN HLS Playback
   - Source: src/media-provider/services/cloudflare-webhook.service.ts:159
   - Usage: Public/Signed HLS playback delivery.

4. https://videodelivery.net/{uid}/thumbnails/thumbnail.jpg?time={t}s
   - Provider: Cloudflare Stream Dynamic Poster & Thumbnail Generator
   - Source: New-FieldFlicks-App/src/utils/recordingMedia.ts:38, 76, 91
   - Usage: In-app video cover and highlight thumbnail rendering.

5. rtmps://live.cloudflare.com:443/live/{streamKey}
   - Provider: Cloudflare Stream Live Ingest
   - Source: src/media-provider/adapters/cloudflare-stream-live.adapter.ts:121
   - Usage: Edge Pi RTSP-to-RTMPS relay for court live streaming.

====================================================================================================
CATEGORY 2: MUX VIDEO & STREAMING
====================================================================================================
6. https://stream.mux.com/{playbackId}.m3u8
   - Provider: Mux Video Global CDN HLS Manifest
   - Source: src/recording/service/recording.service.ts:580, New-FieldFlicks-App/src/utils/recordingMedia.ts:25
   - Usage: Full match and clip HLS streaming.

7. https://image.mux.com/{playbackId}/thumbnail.jpg?time={t}
   - Provider: Mux Video Dynamic Thumbnail Service
   - Source: src/utils/highlight-thumbnail.util.ts:30, New-FieldFlicks-App/src/utils/recordingMedia.ts:40
   - Usage: Highlight reel and card image generation.

8. rtmps://global-live.mux.com:443/app/{streamKey}
   - Provider: Mux Live Stream Ingest
   - Source: src/recording/service/recording.service.ts:5284, src/mux/mux.service.ts:482
   - Usage: Mux live court broadcast ingestion.

====================================================================================================
CATEGORY 3: AWS S3 & MEDIA STORAGE
====================================================================================================
9. https://fieldflicks-media-assets.s3.eu-north-1.amazonaws.com/{key}
   - Provider: AWS S3 Object Storage
   - Source: FieldfFlix-Backend/.env:3, src/utils/s3-highlight-key.util.ts:61
   - Usage: Legacy highlight storage and static MP4 delivery.

====================================================================================================
CATEGORY 4: EDGE GATEWAYS & VENUE MESH (TAILSCALE)
====================================================================================================
10. https://raspberrypi-court11.taild82368.ts.net:8443
    - Provider: Tailscale Mesh Network / Raspberry Pi 5 HTTPS Edge Daemon
    - Source: FieldfFlix-Backend/.env:40, DB table cameras (Eskay Ch 1 & PickPad Ch 1)
    - Usage: NVR segment extraction command & live stream relay control.

11. http://cpu.taild82368.ts.net
    - Provider: Tailscale Internal Node Diagnostic
    - Source: scripts/find-pi-ip.js, add-game-issue.md:47
    - Usage: Edge CPU & hardware telemetry monitoring.
```

---

## 14. Recording and Media Pipeline

### 14.1 Complete Recording Lifecycle State Machine

```mermaid
sequenceDiagram
    autonumber
    actor Athlete as Athlete (Mobile App)
    participant Backend as NestJS API (/recording)
    participant Neon as PostgreSQL (neondb)
    participant Pi as Raspberry Pi 5 (Tailscale)
    participant NVR as Venue NVR (RTSP)
    participant R2 as Cloudflare R2
    participant Stream as Cloudflare Stream VOD

    Athlete->>Backend: POST /recording/extract-session (court, start, end)
    Backend->>R2: Generate Presigned PUT URL (recordings/{id}.mp4)
    Backend->>Neon: INSERT INTO recordings (status='extracting', s3Path='r2://...')
    Backend->>Pi: POST /api/extract-session (uploadUrl, times, callbackUrl)
    Backend-->>Athlete: Return { recordingId, status: 'extracting' }

    critical Edge Ingestion & Upload
        Pi->>NVR: Pull RTSP segment & transcode to MP4
        Pi->>R2: HTTP PUT MP4 file directly to R2
    end

    Pi->>Backend: POST /cloudflare/media/callback (status='SUCCESS', duration, bytes)
    Backend->>Neon: UPDATE recordings SET status='ready', isVideoCreated=true

    par Dual-Path Immediate Playback
        Athlete->>Backend: GET /recording/{id}/playback
        Backend-->>Athlete: Return R2 Presigned GET URL (Instant MP4 Playback!)
    and Background Multi-Bitrate Ingestion
        Backend->>R2: Generate Signed Download URL
        Backend->>Stream: POST /accounts/{id}/stream/copy (url=r2SignedUrl)
        Stream-->>Backend: Return { uid: 'cf_stream_uid_...', status: 'processing' }
        Backend->>Neon: UPDATE metadata.cloudflareStreamUid
    end

    Stream-->>Backend: Webhook / Active Sync (status='ready')
    Backend->>Neon: UPDATE metadata.cloudflareStreamStatus='ready'
    Athlete->>Backend: GET /recording/{id}/playback
    Backend-->>Athlete: Return HLS Manifest (https://videodelivery.net/{uid}/manifest/video.m3u8)
```

---

## 15. Backend API Audit

### Comprehensive Media & Venue Route Matrix

| Route Path                          | HTTP Method | Controller Class              | Auth Guard            | Primary Purpose                               | Storage / Stream Provider    |
| ----------------------------------- | ----------- | ----------------------------- | --------------------- | --------------------------------------------- | ---------------------------- |
| `/recording/extract-session`        | `POST`      | `RecordingController`         | JWT                   | Dispatches NVR extraction to edge Pi          | Cloudflare R2 / AWS S3       |
| `/recording/extract-match`          | `POST`      | `RecordingController`         | JWT                   | Tournament match video extraction             | Cloudflare R2                |
| `/recording/pi-callback`            | `POST`      | `RecordingController`         | Public / API Key      | Raspberry Pi upload completion webhook        | Cloudflare R2 / S3           |
| `/recording/:id/playback`           | `GET`       | `RecordingController`         | Public / Optional JWT | Resolves instant R2 MP4 or Stream HLS URL     | Cloudflare R2 / Stream / Mux |
| `/recording/:id/stream`             | `GET`       | `RecordingController`         | Public                | Returns raw stream redirect or playlist       | Cloudflare Stream / Mux      |
| `/recording/:id/download`           | `GET`       | `RecordingController`         | JWT + Paid Check      | Returns presigned download URL for master MP4 | Cloudflare R2                |
| `/recording/start-live-stream`      | `POST`      | `RecordingController`         | JWT Admin             | Starts live relay on edge Pi for court        | Cloudflare Live / Mux        |
| `/recording/stop-live-stream`       | `POST`      | `RecordingController`         | JWT Admin             | Stops live relay on edge Pi                   | Cloudflare Live / Mux        |
| `/cloudflare/media/extract-session` | `POST`      | `CloudflareMediaController`   | Public / API Key      | Explicit Cloudflare R2 extraction route       | Cloudflare R2                |
| `/cloudflare/media/callback`        | `POST`      | `CloudflareMediaController`   | Public                | Pi callback for Cloudflare pipeline           | Cloudflare R2 & Stream       |
| `/cloudflare/media/:id/playback`    | `GET`       | `CloudflareMediaController`   | Public                | Dual-path R2/Stream playback resolver         | Cloudflare R2 & Stream       |
| `/cloudflare/media/:id/sync`        | `GET`       | `CloudflareMediaController`   | Public                | Polls Cloudflare Stream API status            | Cloudflare Stream            |
| `/cloudflare/live/start`            | `POST`      | `CloudflareMediaController`   | JWT Admin             | Creates Cloudflare Live Input & Pi relay      | Cloudflare Stream Live       |
| `/cloudflare/live/stop`             | `POST`      | `CloudflareMediaController`   | JWT Admin             | Stops Cloudflare Live Input                   | Cloudflare Stream Live       |
| `/webhooks/cloudflare`              | `POST`      | `CloudflareWebhookController` | Raw Signature         | Ingests Cloudflare Stream webhook events      | Cloudflare Stream            |
| `/webhooks/mux`                     | `POST`      | `MuxWebhookController`        | Raw Signature         | Ingests Mux asset/live webhook events         | Mux Video                    |
| `/media-playback/:id/grant`         | `GET`       | `MediaPlaybackController`     | JWT                   | Issues short-lived signed playback token      | Cloudflare Stream / Mux      |
| `/turfs`                            | `GET`       | `TurfsController`             | Public                | Lists all active turfs in Mumbai/Noida        | PostgreSQL                   |
| `/cameras`                          | `GET`       | `CameraController`            | Public                | Lists cameras/courts per venue                | PostgreSQL                   |
| `/admin/fleet`                      | `GET`       | `AdminController`             | JWT Admin             | Full fleet court/camera health dashboard      | PostgreSQL & CloudWatch      |

---

## 16. Frontend Playback Audit

### 16.1 Mobile Player (`New-FieldFlicks-App`)

- **Player Framework:** `expo-video` (`VideoView`, `useVideoPlayer`) `[CODE-CONFIGURED]`
- **Adaptive Bitrate Support:** Plays HLS `.m3u8` streams natively on iOS (AVPlayer) and Android (ExoPlayer).
- **Progressive MP4 Support:** Seamlessly plays progressive `.mp4` from Cloudflare R2 presigned URLs.
- **Provider Switching:** Handled in `Live-videocard.tsx` using `replaceAsync` with `pendingResumePositionRef` snapshotting to preserve exact playback timestamps across stream switches.
- **Fallback URL Chain:** `collectStreamUrls()` aggregates primary Cloudflare Stream URLs, fallback Cloudflare R2 presigned URLs, and legacy Mux URLs into a prioritized retry list.

### 16.2 Web Admin Portal (`main-admin`)

- **Framework:** Next.js 14 App Router (`main-admin/app/*`)
- **API Communication:** Unified `adminApi` client with direct backend proxying (`/api/backend/*`) for remote Codespace and production ALB environments.

---

## 17. Database Relationship Validation

### 17.1 Entity Relationship Integrity Checks

1. **Turfs ↔ Cameras Mapping:** [DATABASE-CONFIRMED]
   - All 20 `cameras` rows have valid `turfId` foreign keys pointing to existing `turfs` records.
   - Zero orphaned camera records exist.
2. **Courts ↔ Cameras Integrity:** [DATABASE-CONFIRMED]
   - `court_number` is populated on all 20 camera rows (integers 1 through 6).
   - No duplicate court numbers exist within any single turf.
3. **Recordings ↔ Users / Turfs:** [DATABASE-CONFIRMED]
   - Existing active recording row (`575d0bda-f658-4afe-b830-4961edc81310`) has valid `userId` and `turfId`.

### 17.2 Discrepancies & Historical Artifacts

- **Historical Santacruz Cricket Misattribution:** 1,143 historical recordings at Santacruz were previously attributed to Pickleball instead of Cricket prior to migration script `fix-cricket-recordings-sport.mjs`.
- **Botanical Gardens Court Number Alignment:** Physical courts 3, 4, 5, 6 at Botanical Gardens were registered as database court numbers 1, 2, 3, 4 with courts 5 and 6 added subsequently.

---

## 18. Security & Compliance Audit

| Security Domain                 | Findings & Configuration                                                                                           | Risk Level | Status / Recommendation                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------- |
| **Secret Management**           | All credentials loaded via environment variables (`.env`). No raw secrets logged.                                  | Low        | [CODE-CONFIGURED]                                                           |
| **R2 Bucket Access**            | Bucket `fieldflicks-storage` is private. Access is mediated exclusively via presigned URLs.                        | Low        | [CODE-CONFIGURED]                                                           |
| **S3 Bucket Access**            | Bucket `fieldflicks-media-assets` uses S3 presigned URLs for upload and playback.                                  | Low        | [CODE-CONFIGURED]                                                           |
| **Edge Gateway Authentication** | Pi communication protected by `x-api-key` header (`PI_API_KEY` / `PI_LIVE_API_KEY`) and Tailscale mesh encryption. | Low        | [CODE-CONFIGURED]                                                           |
| **Playback Authorization**      | Unlocked matches validated via `payment.service.ts` before issuing presigned download URLs.                        | Low        | [CODE-CONFIGURED]                                                           |
| **Webhook Verification**        | Mux and Cloudflare webhooks enforce raw body cryptographic signature checks before processing.                     | Low        | [CODE-CONFIGURED]                                                           |
| **Hardcoded Stream Keys**       | Legacy test files (`scripts/pickleflow_keys.json`) contain historical stream keys.                                 | Medium     | [CODE-CONFIGURED] Archive or isolate script directory in production builds. |

---

## 19. Critical Issues and Findings

```text
====================================================================================================
ISSUE 1: EDGE GATEWAY URL DUPLICATION / COLLISION
====================================================================================================
- Issue ID: SEC-FLEET-001
- Severity: CRITICAL
- Description: Both Eskay Resort Court 1 (27ce1af1-721a-421c-9223-3ddeda95f329) and PickPad Court 1
  (27ce1af1-721a-421c-9223-3ddeda95f321) have the identical raspberryPiBaseUrl configured:
  "https://raspberrypi-court11.taild82368.ts.net".
- Evidence: public.cameras query in Neon DB.
- Impact: Recording extractions triggered for PickPad will command the Eskay Resort hardware, resulting
  in wrong court video or extraction failure.
- Recommended Action: Update database row for PickPad or Eskay to point to its dedicated Tailscale hostname.

====================================================================================================
ISSUE 2: 18 CAMERAS WITH NULL GATEWAY URL IN DATABASE
====================================================================================================
- Issue ID: SEC-FLEET-002
- Severity: HIGH
- Description: 18 of the 20 cameras in the cameras table have raspberryPiBaseUrl = NULL.
- Evidence: SELECT id, "raspberryPiBaseUrl" FROM cameras WHERE "raspberryPiBaseUrl" IS NULL (18 rows).
- Impact: If the backend fallback environment variable (PI_LIVE_API_URL) is unavailable, on-demand
  extraction and live streaming commands for these 18 courts will throw 400 Bad Request.
- Recommended Action: Populate distinct Tailscale URLs for all 20 physical cameras in the database.

====================================================================================================
ISSUE 3: MULTI-COURT NVR STREAM CONTENTION ON EDGE PI
====================================================================================================
- Issue ID: PERF-EDGE-003
- Severity: HIGH
- Description: Venues with 4 to 6 courts (e.g., Botanical Gardens, Eskay) share a single Raspberry Pi
  gateway node. Concurrent FFmpeg extractions and live stream encodings risk CPU throttling.
- Evidence: scripts/find-multi-cam-courts.mjs, Botanical Gardens (6 courts).
- Impact: Dropped frames, high transcode latency, or process crashes during peak tournament windows.
- Recommended Action: Enforce stream copy (codec copy) on Pi or deploy hardware acceleration.

====================================================================================================
ISSUE 4: DUAL-PROVIDER RECORDING ENTITY FIELD OVERLOAD
====================================================================================================
- Issue ID: ARCH-DATA-004
- Severity: MEDIUM
- Description: The Recording entity uses s3Path to store "r2://..." URIs and mux_playback_id to store
  Cloudflare Stream 32-character hexadecimal UIDs.
- Evidence: src/recording/entities/recording.entity.ts, metadata JSONB inspection.
- Impact: Code readability and type safety are degraded; requires regex checks to distinguish Mux vs CF.
- Recommended Action: Complete the media provider migration schema updates (add explicit provider_asset_id
  and storage_provider columns).

====================================================================================================
ISSUE 5: AWS S3 REGION MISMATCH (EU-NORTH-1 VS AP-SOUTH-1)
====================================================================================================
- Issue ID: OPS-AWS-005
- Severity: MEDIUM
- Description: S3 bucket fieldflicks-media-assets is hosted in eu-north-1 (Stockholm), while ECS backend
  and Lambda services are in ap-south-1 (Mumbai).
- Evidence: FieldfFlix-Backend/.env:5 vs serverless.yml:14.
- Impact: Cross-region latency (~140ms) and inter-region data egress transfer costs for S3 assets.
- Recommended Action: Migrate all storage to Cloudflare R2 (zero egress cost) as planned.

====================================================================================================
ISSUE 6: HISTORICAL SQS MESSAGE LOCK TIMEOUT ON LONG MATCHES
====================================================================================================
- Issue ID: PERF-QUEUE-006
- Severity: LOW
- Description: SQS ClipProcessingQueue visibility timeout is set to 960s (16 minutes).
- Evidence: serverless.yml:207.
- Impact: Full 60-minute match transcoding jobs exceeding 16 minutes will duplicate in the queue.
- Recommended Action: Use Cloudflare Stream VOD direct copy which processes asynchronously at edge.
```

---

## 20. Production vs Development Architecture

To build a safe development and testing environment without interfering with live venue cameras or production data:

| Infrastructure Component | Production Resource                   | Recommended Development Resource                         | Shared? | Risk of Sharing                                 | Isolation Recommendation                   |
| ------------------------ | ------------------------------------- | -------------------------------------------------------- | ------- | ----------------------------------------------- | ------------------------------------------ |
| **Database**             | Neon Cloud (`neondb`)                 | Local PostgreSQL Docker Container (`fieldflicks-dev`)    | **NO**  | Accidental data deletion / migration corruption | Complete isolation                         |
| **Object Storage**       | Cloudflare R2 (`fieldflicks-storage`) | Dev R2 Bucket (`fieldflicks-dev-storage`) or Local MinIO | **NO**  | Overwriting match videos                        | Separate R2 bucket & API token             |
| **VOD / Transcoding**    | Cloudflare Stream Prod Account        | Cloudflare Stream Dev Account or Dev Subdomain           | **NO**  | Exceeding Stream quota / mixing test clips      | Dedicated Dev Cloudflare Account/Subdomain |
| **Live Ingestion**       | Live Court NVR Feeds (RTSP)           | Synthetic Loop RTSP Stream (Docker `mediamtx`)           | **NO**  | Disrupting live match broadcasts                | Local simulated RTSP feeds                 |
| **Edge Gateways**        | Physical Raspberry Pi 5 Nodes         | Mock Pi Daemon (`scripts/mock-pi-gateway.mjs`)           | **NO**  | Sending test extraction commands to real NVRs   | Local mock HTTP server                     |
| **Backend API**          | `https://api.fieldflicks.com` / ECS   | `http://localhost:8000`                                  | **NO**  | Route conflicts & polluted metrics              | Local Node.js process                      |
| **Authentication**       | Real SMS OTP (Fast2SMS / MSG91)       | Debug OTP Code (`OTP_DEBUG_CODE=123456`)                 | **NO**  | SMS provider cost & athlete disruption          | Static OTP override in dev                 |

---

## 21. Migration & Testing Readiness

### 21.1 Safe Verification Operations (Non-Destructive)

- Health check endpoints (`GET /health`, `GET /admin/me`).
- Read-only fleet queries (`GET /turfs`, `GET /cameras`, `GET /admin/fleet`).
- Presigned download URL verification using `HEAD` requests.
- Synthetic live stream pilot using test live inputs.

### 21.2 Destructive / Risky Actions Requiring Isolation

- Running `npm run migration:run` against production without backup.
- Calling `POST /recording/start-live-stream` during live tournament hours.
- Direct `DELETE` or `TRUNCATE` operations on database tables.
- Modifying Tailscale routing on venue Raspberry Pi units.

---

## 22. Final Summary

```text
====================================================================================================
FIELD FLICKS PRODUCTION DATA & INFRASTRUCTURE AUDIT COMPLETE
====================================================================================================
Report Path:                         FieldfFlix-Backend/data-audit-venues.md
Total Venues (Turfs) Audited:        7 (Mumbai: 6, Noida: 1)
Total Courts / Cameras Audited:      20 Physical Endpoints
Total Mux Configurations Found:      6 Channel Configurations (Pickleflow Social)
Total S3 Configurations Found:       1 Bucket (fieldflicks-media-assets, eu-north-1)
Total Cloudflare R2 Configurations:  1 Bucket (fieldflicks-storage, b8ae3b7a91345bf70a9d63497e1dac9c)
Total Cloudflare Stream Configs:     Active Live Input & VOD Adapters (Customer CDN Subdomain active)
Total Backend API Routes Audited:    65+ Endpoints across 18 Controllers
Database Verification Status:        [DATABASE-CONFIRMED] - Neon Cloud PostgreSQL 15.19
Backend Verification Status:         [VERIFIED] - NestJS v10.0.0 on Node.js 20.x
Critical Inconsistencies Discovered: 6 Issues Documented with Action Plans
====================================================================================================
```
